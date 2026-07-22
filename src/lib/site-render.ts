// Turns a SiteDocument + resolved theme + live gym data into the HTML
// a visitor (or a search crawler) actually sees. Pure and
// dependency-free, mirroring src/lib/email/render.ts's role — this is
// what both the public /api/site/[...path] function and the in-app editor
// preview call, so "what you see while editing" and "what ships" are
// the same code path, not two renderers that can drift apart.
//
// Unlike email HTML, this isn't constrained to inline styles for client
// compatibility — colours/type come from CSS custom properties set once
// from the theme, not repeated on every element.

import { contrastRatio } from './brand-derivation';
import type { BrandTheme } from './brand-themes';
import { formatMoney } from './coach-earnings';
import type {
  AboutBlock,
  ContactBlock,
  GalleryBlock,
  HeroBlock,
  LocationBlock,
  PricingBlock,
  ScheduleBlock,
  SiteBlock,
  TeamBlock,
  TestimonialsBlock,
} from './site-blocks';

export type ScheduleSession = {
  sessionId: string;
  startsAt: string;
  durationMinutes: number;
  classTypeName: string | null;
  classTypeColor: string | null;
  coachName: string | null;
};

export type PublicPlan = {
  planId: string;
  name: string;
  kind: string;
  creditCount: number | null;
  monthlyPriceCents: number | null;
};

export type TeamMember = {
  profileId: string;
  fullName: string;
  avatarUrl: string | null;
};

export type SiteRenderContext = {
  slug: string;
  gymName: string;
  gymLogoUrl: string | null;
  gymCurrency: string;
  theme: BrandTheme; // already composed with the gym's brand colour
  schedule: ScheduleSession[];
  plans: PublicPlan[];
  team: TeamMember[];
  // The schedule block's reference "today" — the caller's own idea of
  // "now" at the moment it ran the schedule query, so the 7-day grid's
  // first column and "next up" wording ("today" vs a weekday name)
  // line up with whichever sessions actually came back.
  now: string;
  // The join CTA links here rather than staying same-origin: on a
  // custom domain a relative /join/<slug> would land on the Expo app
  // shell at that origin, where Supabase auth confirmation emails
  // (emailRedirectTo = window.location.origin) silently fall back to
  // the Site URL because arbitrary gym domains can't be allowlisted.
  platformOrigin: string;
  // Needed only to render the contact block's working submit — the
  // anon key is a public, RLS-enforced credential, safe to embed the
  // same way every client build already does.
  supabaseUrl: string;
  supabaseAnonKey: string;
  // Required, not optional: forces every call site (the public route
  // and the staff editor) to make an explicit, compiler-checked call
  // rather than silently defaulting to safe. When true, editable text
  // fields get data-field/contenteditable markers, a canvas-sync
  // bridge script, and the contact block's live lead-capture script is
  // suppressed (see renderContact) — never true on the public path.
  editable: boolean;
  // Optional, unlike the fields above — every existing call site
  // (every test, every single-page site rendered before multi-page
  // nav existed) keeps rendering exactly as before when these are
  // omitted: the header shows no nav, and <title> is just the gym
  // name. Only set once a document actually HAS more than one page —
  // omitted or a single-page `pages` array both render the same
  // nav-less header.
  pages?: { slug: string; title: string; metaDescription?: string }[];
  // Which of `pages` is the one being rendered — drives the nav's
  // active/aria-current state and, for a non-home page, the <title>.
  // Ignored when `pages` is omitted.
  activePageSlug?: string;
  // Independent of `editable`: the read-only staff "Preview" toggle
  // renders with editable false (so it's byte-identical to the public
  // route) but still runs inside the builder, where a nav-link click
  // must switch the active page in-app rather than navigating the
  // iframe to the live public URL. Never set on the public path.
  previewNav?: boolean;
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}

// Defence-in-depth against a hostile URL surviving into a rendered
// attribute. Write-time validation (save_gym_website, migration 0157) is
// the primary gate, but rows predating it — or any future write path that
// bypasses the RPC — must not be able to inject `javascript:`/`data:` here.
//
// safeHref preserves same-page fragments and relative paths (they carry no
// scheme, so they're never dangerous) and allows only http(s)/mailto among
// schemed URLs. Browsers strip TAB/LF/CR when resolving a scheme, so
// "java\nscript:..." executes — the scheme test runs against a
// control-char-stripped copy to catch that, then the original is returned
// unchanged when it passes.
function safeHref(href: string): string {
  const trimmed = href.trim();
  const scheme = trimmed.replace(/[\u0000-\u0020]/g, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(scheme) && !/^(https?:|mailto:)/i.test(scheme)) {
    return '';
  }
  return trimmed;
}

// Stricter form for <img src> / CSS url(): images in this app are always
// absolute http(s) URLs (Supabase Storage public URLs or Pexels), so
// anything else — including relative paths, mailto, and every dangerous
// scheme — resolves to empty and the caller renders the no-image fallback.
function safeImageUrl(url: string): string {
  const trimmed = url.trim();
  const cleaned = trimmed.replace(/[\u0000-\u0020]/g, '');
  return /^https?:\/\//i.test(cleaned) ? trimmed : '';
}

// Marks an element as an on-canvas-editable field, addressed by
// `<blockId>:<field>` (or `<blockId>:quotes:<itemId>:<field>` for
// testimonial quotes) — see site-canvas-sync.ts for the matching
// parser/whitelist on the receiving end. A no-op when not editable, so
// every call site is byte-identical on the public path by construction.
//
// Every editable field is rich-text-capable (data-rich="true") — the
// canvas bridge script's floating bold/italic/underline toolbar reads
// this attribute to know to capture innerHTML instead of innerText.
// The content itself must be run through sanitizeRichText, not
// escapeHtml, at every call site — this only controls the DOM
// attribute, not what's actually safe to render.
function fieldAttrs(ctx: SiteRenderContext, path: string, opts?: { multiline?: boolean }): string {
  if (!ctx.editable) return '';
  return ` data-field="${escapeAttr(path)}" contenteditable="true" data-rich="true"${
    opts?.multiline ? ' data-multiline="true"' : ''
  }`;
}

const RICH_TEXT_TAGS = ['b', 'i', 'u'];

// Bold/italic/underline only, no attributes — escapes everything, then
// re-opens exactly six literal tag strings. Anything else (a raw
// <script>, an attribute-bearing <b style=...>, a <b> written straight
// into the DB bypassing the client's own controlled formatting) stays
// inert escaped text; there is no way for arbitrary markup to survive
// this, since only an exact match on the fully-escaped literal is ever
// un-escaped. No DOM/parser dependency, so it runs the same way in the
// browser preview and the Vercel Node function that serves the public
// route.
function sanitizeRichText(raw: string): string {
  let out = escapeHtml(raw);
  for (const tag of RICH_TEXT_TAGS) {
    out = out.replace(new RegExp(`&lt;${tag}&gt;`, 'gi'), `<${tag}>`);
    out = out.replace(new RegExp(`&lt;/${tag}&gt;`, 'gi'), `</${tag}>`);
  }
  return out;
}

const RADIUS_PX: Record<BrandTheme['shape']['buttonRadius'], number> = {
  square: 0,
  rounded: 10,
  pill: 999,
};

function themeStyleBlock(theme: BrandTheme, editable: boolean): string {
  const t = theme.typography;
  const editableCss = editable
    ? `
[contenteditable]{outline:none;border-radius:4px;transition:box-shadow .1s;}
[contenteditable]:hover{box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);}
[contenteditable]:focus{box-shadow:0 0 0 2px var(--accent);}
[contenteditable]:empty::before{content:attr(data-placeholder);color:var(--muted-text);}
.tp-selected{box-shadow:0 0 0 2px var(--accent);}
.tp-rt-toolbar{position:absolute;display:none;gap:2px;background:#1F2937;border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:1000;}
.tp-rt-toolbar button{width:26px;height:26px;border:none;background:transparent;color:#E5E7EB;border-radius:5px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.tp-rt-toolbar button:hover{background:#374151;}`
    : '';
  // The accent doubles as link/eyebrow TEXT, which needs 4.5:1 — and that
  // text appears on BOTH the page background and card surfaces, so it must
  // clear the bar against each. A colour that only clears the 3:1 fill
  // floor (or clears one surface but not the other) falls back to body
  // text for those roles; the fill itself keeps the accent.
  const accentInk =
    contrastRatio(theme.palette.accent, theme.palette.background) >= 4.5 &&
    contrastRatio(theme.palette.accent, theme.palette.surface) >= 4.5
      ? theme.palette.accent
      : theme.palette.text;
  return `:root{
  --bg:${theme.palette.background};
  --surface:${theme.palette.surface};
  --text:${theme.palette.text};
  --muted:${theme.palette.muted};
  --muted-text:${theme.palette.mutedText};
  --accent:${theme.palette.accent};
  --accent-ink:${accentInk};
  --accent-text:${theme.palette.accentText};
  --font:${t.fontFamily};
  --heading-weight:${t.headingWeight};
  --heading-transform:${t.headingTransform};
  --heading-spacing:${t.headingLetterSpacing}px;
  --radius:${RADIUS_PX[theme.shape.buttonRadius]}px;
}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.55;}
h1,h2,h3{font-weight:var(--heading-weight);text-transform:var(--heading-transform);letter-spacing:var(--heading-spacing);margin:0 0 12px;}
a{color:var(--accent-ink);}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,.btn:focus-visible{outline:2px solid var(--text);outline-offset:2px;}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
.skip-link{position:absolute;left:-9999px;top:0;z-index:10;background:var(--surface);color:var(--text);padding:10px 16px;border-radius:0 0 8px 0;}
.skip-link:focus{left:0;}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px;}
.sec{padding:56px 0;border-bottom:1px solid color-mix(in srgb, var(--muted) 40%, transparent);}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:8px;}
.btn{display:inline-block;font-weight:700;padding:14px 26px;border-radius:var(--radius);text-decoration:none;background:var(--accent);color:var(--accent-text);border:none;font-size:15px;cursor:pointer;}
.btn-ghost{display:inline-block;font-weight:700;padding:14px 26px;border-radius:var(--radius);text-decoration:none;background:transparent;color:var(--text);border:1px solid var(--muted);font-size:15px;}
.card{background:var(--surface);border-radius:var(--radius);padding:22px;}
.grid{display:grid;gap:16px;}
@media(min-width:640px){.grid-2{grid-template-columns:1fr 1fr;}.grid-3{grid-template-columns:repeat(3,1fr);}}
input,textarea{width:100%;padding:12px 14px;border-radius:calc(var(--radius) / 2);border:1px solid var(--muted);background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;}
.hero-bg{position:relative;padding:96px 0;text-align:center;}
.hero-bg.has-img{background-size:cover;background-position:center;}
.hero-bg.has-img::before{content:"";position:absolute;inset:0;background:color-mix(in srgb, var(--bg) 55%, transparent);}
.hero-bg:not(.has-img){background:radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--accent) 12%, var(--bg)), var(--bg) 60%);}
.hero-inner{position:relative;max-width:640px;margin:0 auto;}
.hero-inner p{max-width:52ch;margin:0 auto 26px;font-size:17px;}
.hero-side-text p{margin:0 0 26px;font-size:17px;}
.hero-side{display:grid;gap:32px;align-items:center;padding:72px 0;}
@media(min-width:720px){.hero-side{grid-template-columns:1fr 1fr;}}
.hero-side img{width:100%;border-radius:var(--radius);}
.about-grid{display:grid;gap:32px;align-items:center;}
@media(min-width:640px){.about-grid.side{grid-template-columns:1fr 1fr;}}
.about-grid img{width:100%;border-radius:var(--radius);}
.site-header{background:var(--surface);border-bottom:1px solid color-mix(in srgb, var(--muted) 40%, transparent);}
.site-header .wrap{display:flex;align-items:center;gap:10px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap;}
.site-header img{height:32px;width:auto;display:block;}
.site-header span{font-weight:700;font-size:16px;letter-spacing:.01em;}
.site-nav{margin-left:auto;display:flex;flex-wrap:wrap;gap:2px;}
.site-nav-link{padding:7px 12px;border-radius:var(--radius);font-size:13px;font-weight:600;color:var(--text);text-decoration:none;}
.site-nav-link:hover{background:color-mix(in srgb, var(--muted) 30%, transparent);}
.site-nav-link.is-active{color:var(--accent-ink);background:color-mix(in srgb, var(--accent) 12%, transparent);}
.site-footer{background:var(--surface);border-top:1px solid color-mix(in srgb, var(--muted) 40%, transparent);margin-top:8px;}
.site-footer .wrap{display:flex;align-items:center;gap:12px;padding-top:20px;padding-bottom:20px;flex-wrap:wrap;}
.site-footer-brand{font-size:13px;font-weight:600;color:var(--muted-text);text-decoration:none;}
.site-footer-brand:hover{color:var(--text);}
.site-footer-links{margin-left:auto;display:flex;gap:16px;}
.site-footer-links a{font-size:13px;color:var(--muted-text);text-decoration:none;}
.site-footer-links a:hover{color:var(--text);}
.sched-head-row{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:4px;}
.sched-stat{font-size:12px;color:var(--muted-text);font-variant-numeric:tabular-nums;padding-bottom:3px;}
.sched-stat b{color:var(--text);font-weight:700;}
.sched-next{margin-top:16px;display:flex;align-items:center;gap:10px;background:color-mix(in srgb, var(--accent) 12%, var(--surface));border:1px solid color-mix(in srgb, var(--accent) 30%, transparent);border-radius:var(--radius);padding:10px 14px;}
.sched-next-dot{flex-shrink:0;width:8px;height:8px;border-radius:50%;background:var(--accent);animation:sched-pulse 2.2s ease-out infinite;}
@media(prefers-reduced-motion:reduce){.sched-next-dot{animation:none;}}
@keyframes sched-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent);}70%{box-shadow:0 0 0 7px color-mix(in srgb, var(--accent) 0%, transparent);}100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);}}
.sched-next-label{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-ink);margin-right:2px;}
.sched-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-top:16px;}
@media(max-width:760px){.sched-grid{grid-template-columns:repeat(7,minmax(120px,1fr));overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:6px;}.sched-col{scroll-snap-align:start;}}
.sched-col{background:var(--surface);border:1px solid color-mix(in srgb, var(--muted) 45%, transparent);border-top:2px solid transparent;border-radius:var(--radius);padding:12px 9px;display:flex;flex-direction:column;gap:8px;}
.sched-col.is-today{border-top-color:var(--accent);background:color-mix(in srgb, var(--accent) 6%, var(--surface));}
.sched-col-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;}
.sched-day-name{display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-text);}
.sched-col.is-today .sched-day-name{color:var(--accent-ink);}
.sched-day-date{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;}
.sched-col.is-today .sched-day-date{color:var(--accent-ink);}
.sched-today-chip{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:var(--accent);color:var(--accent-text);border-radius:var(--radius);padding:2px 6px;align-self:flex-start;}
.sched-ticket{border-radius:var(--radius);background:color-mix(in srgb, var(--dot) 11%, var(--surface));border-left:3px solid var(--dot);padding:6px 8px 7px;}
.sched-ticket-time{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.3;}
.sched-ticket-name{font-size:11.5px;line-height:1.35;margin-top:1px;}
.sched-ticket-coach{display:flex;align-items:center;gap:5px;margin-top:5px;}
.sched-coach-dot{flex-shrink:0;width:15px;height:15px;border-radius:50%;background:var(--accent);color:var(--accent-text);font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;}
.sched-coach-name{font-size:10.5px;color:var(--muted-text);}
.sched-empty{flex:1;display:flex;align-items:center;justify-content:center;border:1px dashed color-mix(in srgb, var(--muted) 70%, transparent);border-radius:var(--radius);font-size:10.5px;color:var(--muted-text);text-transform:uppercase;letter-spacing:.05em;padding:14px 4px;min-height:64px;}
.plan-price{font-size:32px;font-weight:800;}
.quote-mark{font-size:32px;color:var(--accent);line-height:.4;display:block;margin-bottom:6px;}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
.gallery-grid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:calc(var(--radius) / 2);}
.team-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:20px;}
.team-card{text-align:center;}
.team-avatar{width:96px;height:96px;border-radius:50%;object-fit:cover;margin:0 auto 10px;display:block;}
.team-initials{width:96px;height:96px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;background:var(--accent);color:var(--accent-text);}
.team-name{font-weight:700;font-size:14px;}${editableCss}`;
}

// Renders nothing for a single-page site (the common case today) — only
// shows up once a gym has actually added a second page. The hrefs are
// PATH-absolute (no origin), unlike the hero CTA / footer legal links: the
// `/site/:slug/:page` rewrites in vercel.json are host-agnostic, so a
// path like /site/<slug>/schedule resolves to this same renderer on the
// platform origin AND on a connected custom domain. Keeping the origin off
// is what lets a custom-domain visitor move between pages without being
// bounced back to app.jointemple.io. In editor/preview mode ctx.slug is
// still used, but the canvas/preview scripts intercept the click via
// data-page-slug before the href ever navigates.
function renderSiteNav(ctx: SiteRenderContext): string {
  if (!ctx.pages || ctx.pages.length <= 1) return '';
  const activeSlug = ctx.activePageSlug ?? '';
  const links = ctx.pages
    .map((p) => {
      const isActive = p.slug === activeSlug;
      const path = p.slug
        ? `/site/${encodeURIComponent(ctx.slug)}/${encodeURIComponent(p.slug)}`
        : `/site/${encodeURIComponent(ctx.slug)}`;
      // data-page-slug is inert on the public render (the href is what
      // navigates there); the editable-canvas bridge script reads it to
      // switch the editor's active page instead of navigating the iframe.
      return `<a class="site-nav-link${isActive ? ' is-active' : ''}" href="${escapeAttr(path)}" data-page-slug="${escapeAttr(p.slug)}"${
        isActive ? ' aria-current="page"' : ''
      }>${escapeHtml(p.title)}</a>`;
    })
    .join('');
  return `<nav class="site-nav" aria-label="Site pages">${links}</nav>`;
}

function renderSiteHeader(ctx: SiteRenderContext): string {
  const brand = ctx.gymLogoUrl
    ? `<img src="${escapeAttr(ctx.gymLogoUrl)}" alt="${escapeAttr(ctx.gymName)}" />`
    : `<span>${escapeHtml(ctx.gymName)}</span>`;
  return `<header class="site-header"><div class="wrap">${brand}${renderSiteNav(ctx)}</div></header>`;
}

// Platform footer every published gym site carries: a "Powered by Temple"
// backlink plus the platform's legal pages. Links are absolute to the
// platform origin so they resolve from a connected custom domain too
// (middleware only rewrites that domain's bare root to the renderer).
function renderSiteFooter(ctx: SiteRenderContext): string {
  const home = escapeAttr(ctx.platformOrigin);
  const terms = escapeAttr(`${ctx.platformOrigin}/terms`);
  const privacy = escapeAttr(`${ctx.platformOrigin}/privacy`);
  return `<footer class="site-footer"><div class="wrap"><a class="site-footer-brand" href="${home}">Powered by Temple</a><nav class="site-footer-links"><a href="${privacy}">Privacy</a><a href="${terms}">Terms</a></nav></div></footer>`;
}

// `headlineTag`: only the FIRST hero on the page renders an <h1> —
// a second hero demotes to a visually-identical <h2> so the document
// keeps exactly one h1 (renderSiteHtml decides which is first).
function renderHero(
  b: HeroBlock,
  ctx: SiteRenderContext,
  headlineTag: 'h1' | 'h2' = 'h1',
): string {
  const ctaHref =
    b.ctaTarget === 'contact'
      ? '#contact'
      : `${ctx.platformOrigin}/join/${encodeURIComponent(ctx.slug)}`;
  const cta = `<a class="btn" href="${escapeAttr(safeHref(ctaHref))}"${fieldAttrs(ctx, `${b.id}:ctaLabel`)}>${sanitizeRichText(b.ctaLabel)}</a>`;
  const eyebrow = `<div class="eyebrow">${escapeHtml(ctx.gymName)}</div>`;
  const headline = `<${headlineTag} style="font-size:clamp(32px,6vw,56px);"${fieldAttrs(ctx, `${b.id}:headline`)}>${sanitizeRichText(b.headline)}</${headlineTag}>`;
  // Editable mode always emits the <p>, even empty, so there's a node
  // to click into — the public path keeps the "omit when empty" today.
  const subheadline = ctx.editable
    ? `<p data-placeholder="Subheadline"${fieldAttrs(ctx, `${b.id}:subheadline`)}>${sanitizeRichText(b.subheadline)}</p>`
    : b.subheadline
      ? `<p>${sanitizeRichText(b.subheadline)}</p>`
      : '';

  const imageUrl = safeImageUrl(b.imageUrl);
  if (b.layout === 'side') {
    const text = `<div class="hero-side-text">${eyebrow}${headline}${subheadline}${cta}</div>`;
    const image = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(ctx.gymName)}" />`
      : `<div class="card" style="aspect-ratio:4/3;"></div>`;
    return `<section class="sec"><div class="wrap hero-side">${text}${image}</div></section>`;
  }

  const bgStyle = imageUrl
    ? `background-image:linear-gradient(color-mix(in srgb, var(--bg) 55%, transparent), color-mix(in srgb, var(--bg) 55%, transparent)), url('${escapeAttr(imageUrl)}');`
    : '';
  return `<section class="hero-bg${imageUrl ? ' has-img' : ''}" style="${bgStyle}"><div class="wrap hero-inner">${eyebrow}${headline}${subheadline}${cta}</div></section>`;
}

function renderAbout(b: AboutBlock, ctx: SiteRenderContext): string {
  const text = `<div><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2><p style="white-space:pre-line;"${fieldAttrs(ctx, `${b.id}:body`, { multiline: true })}>${sanitizeRichText(b.body)}</p></div>`;
  const aboutImg = safeImageUrl(b.imageUrl);
  const img = aboutImg
    ? `<img src="${escapeAttr(aboutImg)}" alt="${escapeAttr(b.heading)}" />`
    : '';
  if (b.layout === 'none' || !img) {
    return `<section class="sec"><div class="wrap" style="max-width:720px;">${text}</div></section>`;
  }
  const order = b.layout === 'image-right' ? [text, img] : [img, text];
  return `<section class="sec"><div class="wrap about-grid side">${order.join('')}</div></section>`;
}

// A deliberate per-theme style choice, not the visitor's browser
// locale — tight 24h reads tactical for the intense themes (Forged,
// Ringside), 12h lowercase reads calm/welcoming for the boutique and
// coaching ones (Daybreak, Baseline). See BrandTheme.typography.timeFormat.
function fmtSessionTime(iso: string, format: BrandTheme['typography']['timeFormat']): string {
  const d = new Date(iso);
  const hours24 = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  if (format === '24h') {
    return `${hours24.toString().padStart(2, '0')}:${minutes}`;
  }
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${minutes}${hours24 < 12 ? 'am' : 'pm'}`;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// First + last initial, matching the Team block's own avatar-initials
// pattern (renderTeam) so the schedule reuses the same visual language
// rather than inventing a second one. Falls back to the first two
// letters of a single-word name.
function coachInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

type ScheduleDay = { date: Date; sessions: ScheduleSession[] };

// Buckets sessions into 7 calendar-day columns starting at ctx.now's
// local midnight, so a day with zero sessions still gets a column
// (rendered as "Closed") instead of silently vanishing from the grid —
// the caller's query already limits `sessions` to roughly this window,
// this just gives every day in it a slot even when empty.
function buildScheduleWeek(nowIso: string, sessions: ScheduleSession[]): ScheduleDay[] {
  const start = new Date(nowIso);
  start.setHours(0, 0, 0, 0);
  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, i) => ({
    date: new Date(start.getTime() + i * 86_400_000),
    sessions: [],
  }));
  for (const s of sessions) {
    const idx = Math.floor((new Date(s.startsAt).getTime() - start.getTime()) / 86_400_000);
    if (idx >= 0 && idx < 7) days[idx]!.sessions.push(s);
  }
  return days;
}

function renderScheduleTicket(s: ScheduleSession, format: BrandTheme['typography']['timeFormat']): string {
  const dot = s.classTypeColor ? escapeAttr(s.classTypeColor) : 'var(--accent)';
  const coach = s.coachName
    ? `<div class="sched-ticket-coach"><span class="sched-coach-dot">${escapeHtml(
        coachInitials(s.coachName),
      )}</span><span class="sched-coach-name">${escapeHtml(s.coachName)}</span></div>`
    : '';
  return `<div class="sched-ticket" style="--dot:${dot};"><div class="sched-ticket-time">${fmtSessionTime(
    s.startsAt,
    format,
  )}</div><div class="sched-ticket-name">${escapeHtml(s.classTypeName ?? 'Class')}</div>${coach}</div>`;
}

// The single most useful fact before scanning a 7-day grid: what's
// next, when, with whom. ctx.schedule is already ordered by starts_at
// ascending and pre-filtered to upcoming sessions by both callers'
// queries, so the first entry (if any) IS the next class — no
// re-filtering needed here.
function renderScheduleNextUp(
  next: ScheduleSession,
  today: Date,
  format: BrandTheme['typography']['timeFormat'],
): string {
  const at = new Date(next.startsAt);
  const isToday =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  const when = isToday ? 'today' : WEEKDAY_LONG[at.getDay()];
  const withCoach = next.coachName ? ` with ${escapeHtml(next.coachName)}` : '';
  return `<div class="sched-next"><span class="sched-next-dot" aria-hidden="true"></span><span><span class="sched-next-label">Next up</span>${escapeHtml(
    next.classTypeName ?? 'Class',
  )} ${when} at ${fmtSessionTime(next.startsAt, format)}${withCoach}</span></div>`;
}

function renderSchedule(b: ScheduleBlock, ctx: SiteRenderContext): string {
  if (ctx.schedule.length === 0) {
    return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2><p style="color:var(--muted-text);">Check back soon for the full schedule.</p></div></section>`;
  }
  const format = ctx.theme.typography.timeFormat;
  const week = buildScheduleWeek(ctx.now, ctx.schedule);
  const coachCount = new Set(ctx.schedule.map((s) => s.coachName).filter(Boolean)).size;

  const cols = week
    .map((day, i) => {
      const isToday = i === 0;
      const chip = isToday ? '<span class="sched-today-chip">Today</span>' : '';
      const head = `<div class="sched-col-head"><div><span class="sched-day-name">${
        WEEKDAY_SHORT[day.date.getDay()]
      }</span><span class="sched-day-date">${day.date.getDate()}</span></div>${chip}</div>`;
      const body =
        day.sessions.length === 0
          ? '<div class="sched-empty">Closed</div>'
          : day.sessions.map((s) => renderScheduleTicket(s, format)).join('');
      return `<div class="sched-col${isToday ? ' is-today' : ''}">${head}${body}</div>`;
    })
    .join('');

  const classWord = ctx.schedule.length === 1 ? 'class' : 'classes';
  const coachWord = coachCount === 1 ? 'coach' : 'coaches';
  const stat = `<span class="sched-stat"><b>${ctx.schedule.length}</b> ${classWord} · <b>${coachCount}</b> ${coachWord} this week</span>`;
  const nextUp = renderScheduleNextUp(ctx.schedule[0]!, week[0]!.date, format);

  return `<section class="sec"><div class="wrap"><div class="sched-head-row"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2>${stat}</div>${nextUp}<div class="sched-grid">${cols}</div></div></section>`;
}

function fmtPlanPrice(p: PublicPlan, currency: string): string {
  if (p.monthlyPriceCents == null) return 'Contact us';
  const price = formatMoney(p.monthlyPriceCents, currency);
  if (p.kind === 'unlimited' || p.kind === 'programming_only') return `${price}<span style="font-size:14px;font-weight:400;color:var(--muted-text);">/month</span>`;
  if (p.kind === 'credit_pack') return price;
  return `${price}<span style="font-size:14px;font-weight:400;color:var(--muted-text);">/period</span>`;
}

function renderPricing(b: PricingBlock, ctx: SiteRenderContext): string {
  const hidden = new Set(b.hiddenPlanIds);
  const visible = ctx.plans.filter((p) => !hidden.has(p.planId));
  if (visible.length === 0) {
    return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2><p style="color:var(--muted-text);">Get in touch for membership options.</p></div></section>`;
  }
  const cards = visible
    .map(
      (p) =>
        `<div class="card"><div style="font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:.03em;">${escapeHtml(
          p.name,
        )}</div><div class="plan-price">${fmtPlanPrice(p, ctx.gymCurrency)}</div></div>`,
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2><div class="grid grid-3">${cards}</div></div></section>`;
}

function renderTestimonials(b: TestimonialsBlock, ctx: SiteRenderContext): string {
  // Editable mode keeps the section (and its editable heading) even
  // with zero quotes, rather than hiding the whole section — that
  // would leave no canvas node to click before the first quote exists.
  if (b.quotes.length === 0 && !ctx.editable) return '';
  const cards = b.quotes
    .map(
      (q) =>
        `<div class="card"><span class="quote-mark">&ldquo;</span><p${fieldAttrs(ctx, `${b.id}:quotes:${q.id}:quote`, { multiline: true })}>${sanitizeRichText(
          q.quote,
        )}</p><div style="font-weight:700;font-size:13px;color:var(--muted-text);"${fieldAttrs(ctx, `${b.id}:quotes:${q.id}:name`)}>${sanitizeRichText(
          q.name,
        )}</div></div>`,
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2><div class="grid grid-3">${cards}</div></div></section>`;
}

function renderGallery(b: GalleryBlock, ctx: SiteRenderContext): string {
  if (b.images.length === 0 && !ctx.editable) return '';
  const imgs = b.images
    .map((img) => {
      const url = safeImageUrl(img.url);
      return url
        ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(img.alt)}" loading="lazy" />`
        : `<div class="card" style="aspect-ratio:1/1;"></div>`;
    })
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2><div class="gallery-grid">${imgs}</div></div></section>`;
}

function renderLocation(b: LocationBlock, ctx: SiteRenderContext): string {
  const address = ctx.editable
    ? `<p data-placeholder="Address"${fieldAttrs(ctx, `${b.id}:address`)}>${sanitizeRichText(b.address)}</p>`
    : b.address
      ? `<p>${sanitizeRichText(b.address)}</p>`
      : '';
  const hours = ctx.editable
    ? `<p style="color:var(--muted-text);white-space:pre-line;" data-placeholder="Hours"${fieldAttrs(ctx, `${b.id}:hours`, { multiline: true })}>${sanitizeRichText(b.hours)}</p>`
    : b.hours
      ? `<p style="color:var(--muted-text);white-space:pre-line;">${sanitizeRichText(b.hours)}</p>`
      : '';
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2>
${address}
${hours}
</div></section>`;
}

function renderContact(b: ContactBlock, ctx: SiteRenderContext): string {
  // Vanilla-JS submit straight to the existing capture_public_lead RPC
  // over Supabase's PostgREST endpoint — the anon key is a public,
  // RLS-enforced credential, the same one every client build embeds.
  // Suppressed entirely in editable mode: with allow-scripts on, this
  // would otherwise fire real network calls from inside a staff
  // member's editing session the moment they click "Send enquiry".
  const script = ctx.editable
    ? ''
    : `
<script>
(function(){
  var f = document.getElementById('temple-contact-form');
  if (!f) return;
  f.addEventListener('submit', function(e){
    e.preventDefault();
    var status = document.getElementById('temple-contact-status');
    var btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    fetch(${JSON.stringify(ctx.supabaseUrl)} + '/rest/v1/rpc/capture_public_lead', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ${JSON.stringify(ctx.supabaseAnonKey)},
        'Authorization': 'Bearer ' + ${JSON.stringify(ctx.supabaseAnonKey)}
      },
      body: JSON.stringify({
        p_slug: ${JSON.stringify(ctx.slug)},
        p_full_name: f.name.value,
        p_email: f.email.value,
        p_message: f.message.value
      })
    }).then(function(r){
      if (!r.ok) throw new Error('failed');
      status.textContent = "Thanks — we'll be in touch soon.";
      f.reset();
    }).catch(function(){
      status.textContent = 'Something went wrong — please try again.';
    }).finally(function(){ btn.disabled = false; });
  });
})();
</script>`;
  const subheading = ctx.editable
    ? `<p style="color:var(--muted-text);" data-placeholder="Subheading"${fieldAttrs(ctx, `${b.id}:subheading`, { multiline: true })}>${sanitizeRichText(b.subheading)}</p>`
    : b.subheading
      ? `<p style="color:var(--muted-text);">${sanitizeRichText(b.subheading)}</p>`
      : '';
  return `<section class="sec" id="contact"><div class="wrap" style="text-align:center;max-width:520px;">
<h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2>
${subheading}
<form id="temple-contact-form" style="text-align:left;display:flex;flex-direction:column;gap:10px;margin-top:20px;">
  <label class="sr-only" for="temple-contact-name">Name</label>
  <input id="temple-contact-name" name="name" placeholder="Name" autocomplete="name" required />
  <label class="sr-only" for="temple-contact-email">Email</label>
  <input id="temple-contact-email" name="email" type="email" placeholder="Email" autocomplete="email" required />
  <label class="sr-only" for="temple-contact-message">What are you looking to achieve?</label>
  <textarea id="temple-contact-message" name="message" placeholder="What are you looking to achieve?" rows="3"></textarea>
  <button type="submit" class="btn">Send enquiry</button>
  <p id="temple-contact-status" role="status" aria-live="polite" style="font-size:13px;color:var(--muted-text);min-height:18px;"></p>
</form>
</div></section>${script}`;
}

function teamInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function renderTeam(b: TeamBlock, ctx: SiteRenderContext): string {
  const hidden = new Set(b.hiddenMemberIds);
  const visible = ctx.team.filter((m) => !hidden.has(m.profileId));
  // Same "omit in public mode, keep the editable heading" convention
  // as testimonials/gallery — no client JS runs here, so the
  // no-avatarUrl fallback is a static initials circle, not an
  // onError-driven <img> the way Avatar.tsx's React fallback works.
  if (visible.length === 0 && !ctx.editable) return '';
  const cards = visible
    .map((m) => {
      const avatar = safeImageUrl(m.avatarUrl ?? '');
      const photo = avatar
        ? `<img class="team-avatar" src="${escapeAttr(avatar)}" alt="${escapeAttr(m.fullName)}" />`
        : `<div class="team-initials">${escapeHtml(teamInitial(m.fullName))}</div>`;
      return `<div class="team-card">${photo}<div class="team-name">${escapeHtml(m.fullName)}</div></div>`;
    })
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${sanitizeRichText(b.heading)}</h2><div class="team-grid">${cards}</div></div></section>`;
}

function renderBlock(
  block: SiteBlock,
  ctx: SiteRenderContext,
  isFirstHero: boolean,
): string {
  switch (block.type) {
    case 'hero':
      return renderHero(block, ctx, isFirstHero ? 'h1' : 'h2');
    case 'about':
      return renderAbout(block, ctx);
    case 'schedule':
      return renderSchedule(block, ctx);
    case 'pricing':
      return renderPricing(block, ctx);
    case 'testimonials':
      return renderTestimonials(block, ctx);
    case 'gallery':
      return renderGallery(block, ctx);
    case 'location':
      return renderLocation(block, ctx);
    case 'contact':
      return renderContact(block, ctx);
    case 'team':
      return renderTeam(block, ctx);
  }
}

// Runs inside the editable staff-preview iframe only (sandbox
// allow-scripts). Listens for keystrokes on [data-field] elements and
// reports them to the parent via postMessage; the parent is the only
// place field values are validated against the editable-field
// whitelist before being written into document state (site-canvas-sync.ts) —
// this script's job is purely to observe the DOM and forward it, not
// to decide what's writable.
const CANVAS_BRIDGE_SCRIPT = `
<script>
(function(){
  var SRC = 'temple-site-canvas';
  function post(msg){ window.parent.postMessage(Object.assign({ source: SRC }, msg), '*'); }

  document.addEventListener('input', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el) return;
    // Every field is rich-text-capable — innerHTML, not innerText, so
    // any <b>/<i>/<u> the formatting toolbar applied round-trips.
    // sanitizeRichText (site-render.ts) is what actually makes this
    // safe to store and re-render, not this capture step.
    post({ type: 'field-input', path: el.getAttribute('data-field'), value: el.innerHTML });
  });

  document.addEventListener('focusin', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el) return;
    post({ type: 'field-focus', path: el.getAttribute('data-field') });
  });

  document.addEventListener('keydown', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el) return;
    // Cmd/Ctrl + B/I/U — a keyboard-accessible equivalent to the floating
    // formatting toolbar, which is otherwise mouse/selection-only.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && el.getAttribute('data-rich') === 'true') {
      var k = e.key.toLowerCase();
      var cmd = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null;
      if (cmd) {
        e.preventDefault();
        document.execCommand('styleWithCSS', false, false);
        document.execCommand(cmd);
        post({ type: 'field-input', path: el.getAttribute('data-field'), value: el.innerHTML });
        return;
      }
    }
    if (e.key !== 'Enter') return;
    if (el.getAttribute('data-multiline') !== 'true') {
      e.preventDefault();
      el.blur();
    }
  });

  document.addEventListener('paste', function(e){
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // A real page navigation (join CTA, contact "Send enquiry") would
  // otherwise carry the editing iframe away from the editable canvas.
  // For the site's own page-nav links, forward the target page to the
  // parent so it can switch the editor's active page — clicking
  // "Schedule" in the preview then does the same thing as the top tab,
  // instead of doing nothing.
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.classList.contains('site-nav-link')) {
      post({ type: 'nav-page', slug: a.getAttribute('data-page-slug') || '' });
    }
  });
  document.addEventListener('submit', function(e){ e.preventDefault(); });

  window.addEventListener('message', function(e){
    if (e.source !== window.parent) return;
    var msg = e.data;
    if (!msg || msg.type !== 'select-block') return;
    var prev = document.querySelector('.tp-selected');
    if (prev) prev.classList.remove('tp-selected');
    if (msg.blockId) {
      var next = document.querySelector('[data-field^="' + msg.blockId + ':"]');
      if (next) {
        var section = next.closest('section');
        (section || next).classList.add('tp-selected');
      }
    }
  });

  // ---- rich-text formatting toolbar (bold/italic/underline only) ----
  // execCommand is deprecated-in-spirit but universally supported and,
  // with styleWithCSS forced off, reliably produces plain <b>/<i>/<u>
  // tags rather than inline styles — exactly what sanitizeRichText
  // (site-render.ts) allows through. Anything else it might produce in
  // an edge case still renders safely, just as inert escaped text.
  var toolbar = document.createElement('div');
  toolbar.className = 'tp-rt-toolbar';
  toolbar.innerHTML =
    '<button type="button" data-cmd="bold"><b>B</b></button>' +
    '<button type="button" data-cmd="italic"><i>I</i></button>' +
    '<button type="button" data-cmd="underline"><u>U</u></button>';
  document.body.appendChild(toolbar);
  var activeRichField = null;

  function hideToolbar(){ toolbar.style.display = 'none'; }

  function richFieldFor(node){
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return el && el.closest ? el.closest('[data-rich="true"]') : null;
  }

  document.addEventListener('selectionchange', function(){
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hideToolbar(); return; }
    var field = richFieldFor(sel.anchorNode);
    if (!field) { hideToolbar(); return; }
    activeRichField = field;
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    toolbar.style.display = 'flex';
    toolbar.style.top = (window.scrollY + rect.top - 40) + 'px';
    toolbar.style.left = (window.scrollX + rect.left + rect.width / 2 - toolbar.offsetWidth / 2) + 'px';
  });

  // Without this, the browser collapses the text selection before the
  // click handler runs — there'd be nothing left for execCommand to format.
  toolbar.addEventListener('mousedown', function(e){ e.preventDefault(); });

  toolbar.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('button[data-cmd]');
    if (!btn || !activeRichField) return;
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(btn.getAttribute('data-cmd'));
    post({ type: 'field-input', path: activeRichField.getAttribute('data-field'), value: activeRichField.innerHTML });
  });
})();
</script>`;

// Read-only counterpart to CANVAS_BRIDGE_SCRIPT's nav handling, for the
// staff "Preview" toggle (previewNav) — no contentEditable/rich-text
// wiring, since nothing here is ever editable, just the same
// site-nav-link interception so clicking "Schedule"/"Team"/"Pricing"
// switches the builder's active page instead of navigating the iframe
// to the live public URL (and dead-ending on whatever that route
// returns for an unsaved or nonexistent draft).
const NAV_INTERCEPT_SCRIPT = `
<script>
(function(){
  var SRC = 'temple-site-canvas';
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.classList.contains('site-nav-link')) {
      window.parent.postMessage({ source: SRC, type: 'nav-page', slug: a.getAttribute('data-page-slug') || '' }, '*');
    }
  });
  document.addEventListener('submit', function(e){ e.preventDefault(); });
})();
</script>`;

// Takes one page's blocks directly, not a whole (possibly multi-page)
// SiteDocument — the caller resolves which page to render (the staff
// editor's active page, or the page matching the public route's slug).
export function renderSiteHtml(blocks: SiteBlock[], ctx: SiteRenderContext): string {
  const header = renderSiteHeader(ctx);
  const firstHeroId = blocks.find((b) => b.type === 'hero')?.id;
  const blocksHtml = blocks
    .map((b) => renderBlock(b, ctx, b.id === firstHeroId))
    .join('');
  // A page with no hero would otherwise have no h1 at all — give it a
  // visually-hidden one so the outline starts at the right level.
  const fallbackH1 = firstHeroId
    ? ''
    : `<h1 class="sr-only">${escapeHtml(ctx.gymName)}</h1>`;
  const footer = renderSiteFooter(ctx);
  const body = `<a class="skip-link" href="#main">Skip to content</a>${header}<main id="main">${fallbackH1}${blocksHtml}</main>${footer}`;
  // Home (or a single-page site, or `pages` omitted entirely) keeps the
  // plain gym-name title every existing page already has; a non-home
  // page prefixes its own title so browser tabs/bookmarks/search
  // results can tell pages apart.
  const activePage = ctx.pages?.find((p) => p.slug === (ctx.activePageSlug ?? ''));
  const title =
    activePage && activePage.slug !== ''
      ? escapeHtml(`${activePage.title} — ${ctx.gymName}`)
      : escapeHtml(ctx.gymName);
  // Per-page meta description when the owner set one, else a gym-level
  // default. Drives both <meta name="description"> and og:description.
  const description = escapeAttr(
    activePage?.metaDescription?.trim()
      ? activePage.metaDescription.trim()
      : `${ctx.gymName} — book a class, see membership options and get in touch.`,
  );
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${ctx.gymLogoUrl ? `<meta property="og:image" content="${escapeAttr(ctx.gymLogoUrl)}">` : ''}
<style>${themeStyleBlock(ctx.theme, ctx.editable)}</style>
</head><body>${body}${
    ctx.editable ? CANVAS_BRIDGE_SCRIPT : ctx.previewNav ? NAV_INTERCEPT_SCRIPT : ''
  }</body></html>`;
}
