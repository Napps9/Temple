// Turns a SiteDocument + resolved theme + live gym data into the HTML
// a visitor (or a search crawler) actually sees. Pure and
// dependency-free, mirroring src/lib/email/render.ts's role — this is
// what both the public /api/site/[slug] function and the in-app editor
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
  SiteDocument,
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

function safeHref(href: string): string {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return '';
}

// Marks an element as an on-canvas-editable field, addressed by
// `<blockId>:<field>` (or `<blockId>:quotes:<itemId>:<field>` for
// testimonial quotes) — see site-canvas-sync.ts for the matching
// parser/whitelist on the receiving end. A no-op when not editable, so
// every call site is byte-identical on the public path by construction.
function fieldAttrs(ctx: SiteRenderContext, path: string, opts?: { multiline?: boolean }): string {
  if (!ctx.editable) return '';
  return ` data-field="${escapeAttr(path)}" contenteditable="true"${
    opts?.multiline ? ' data-multiline="true"' : ''
  }`;
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
.tp-selected{box-shadow:0 0 0 2px var(--accent);}`
    : '';
  // The accent doubles as link/eyebrow TEXT, which needs 4.5:1 — a
  // colour that only clears the 3:1 fill floor falls back to body text
  // for those roles (the fill keeps the accent).
  const accentInk =
    contrastRatio(theme.palette.accent, theme.palette.background) >= 4.5
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
.site-header .wrap{display:flex;align-items:center;gap:10px;padding-top:14px;padding-bottom:14px;}
.site-header img{height:32px;width:auto;display:block;}
.site-header span{font-weight:700;font-size:16px;letter-spacing:.01em;}
.sched-day{font-size:12px;font-weight:700;text-transform:uppercase;color:var(--accent-ink);margin:20px 0 8px;}
.sched-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid color-mix(in srgb, var(--muted) 40%, transparent);}
.sched-row:first-of-type{border-top:none;}
.sched-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle;}
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

function renderSiteHeader(ctx: SiteRenderContext): string {
  const brand = ctx.gymLogoUrl
    ? `<img src="${escapeAttr(ctx.gymLogoUrl)}" alt="${escapeAttr(ctx.gymName)}" />`
    : `<span>${escapeHtml(ctx.gymName)}</span>`;
  return `<header class="site-header"><div class="wrap">${brand}</div></header>`;
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
  const cta = `<a class="btn" href="${escapeAttr(ctaHref)}"${fieldAttrs(ctx, `${b.id}:ctaLabel`)}>${escapeHtml(b.ctaLabel)}</a>`;
  const eyebrow = `<div class="eyebrow">${escapeHtml(ctx.gymName)}</div>`;
  const headline = `<${headlineTag} style="font-size:clamp(32px,6vw,56px);"${fieldAttrs(ctx, `${b.id}:headline`)}>${escapeHtml(b.headline)}</${headlineTag}>`;
  // Editable mode always emits the <p>, even empty, so there's a node
  // to click into — the public path keeps the "omit when empty" today.
  const subheadline = ctx.editable
    ? `<p data-placeholder="Subheadline"${fieldAttrs(ctx, `${b.id}:subheadline`)}>${escapeHtml(b.subheadline)}</p>`
    : b.subheadline
      ? `<p>${escapeHtml(b.subheadline)}</p>`
      : '';

  if (b.layout === 'side') {
    const text = `<div class="hero-side-text">${eyebrow}${headline}${subheadline}${cta}</div>`;
    const image = b.imageUrl
      ? `<img src="${escapeAttr(b.imageUrl)}" alt="${escapeAttr(ctx.gymName)}" />`
      : `<div class="card" style="aspect-ratio:4/3;"></div>`;
    return `<section class="sec"><div class="wrap hero-side">${text}${image}</div></section>`;
  }

  const bgStyle = b.imageUrl
    ? `background-image:linear-gradient(color-mix(in srgb, var(--bg) 55%, transparent), color-mix(in srgb, var(--bg) 55%, transparent)), url('${escapeAttr(b.imageUrl)}');`
    : '';
  return `<section class="hero-bg${b.imageUrl ? ' has-img' : ''}" style="${bgStyle}"><div class="wrap hero-inner">${eyebrow}${headline}${subheadline}${cta}</div></section>`;
}

function renderAbout(b: AboutBlock, ctx: SiteRenderContext): string {
  const text = `<div><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2><p style="white-space:pre-line;"${fieldAttrs(ctx, `${b.id}:body`, { multiline: true })}>${escapeHtml(b.body)}</p></div>`;
  const img = b.imageUrl
    ? `<img src="${escapeAttr(b.imageUrl)}" alt="${escapeAttr(b.heading)}" />`
    : '';
  if (b.layout === 'none' || !img) {
    return `<section class="sec"><div class="wrap" style="max-width:720px;">${text}</div></section>`;
  }
  const order = b.layout === 'image-right' ? [text, img] : [img, text];
  return `<section class="sec"><div class="wrap about-grid side">${order.join('')}</div></section>`;
}

function fmtSessionDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
}
function fmtSessionTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function renderSchedule(b: ScheduleBlock, ctx: SiteRenderContext): string {
  if (ctx.schedule.length === 0) {
    return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2><p style="color:var(--muted-text);">Check back soon for the full schedule.</p></div></section>`;
  }
  const byDay = new Map<string, ScheduleSession[]>();
  for (const s of ctx.schedule) {
    const day = fmtSessionDay(s.startsAt);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(s);
  }
  const days = Array.from(byDay.entries())
    .map(
      ([day, sessions]) =>
        `<div class="sched-day">${escapeHtml(day)}</div>` +
        sessions
          .map((s) => {
            const dotColor = s.classTypeColor ? escapeAttr(s.classTypeColor) : 'var(--accent)';
            return `<div class="sched-row"><span><span class="sched-dot" style="background:${dotColor};"></span>${fmtSessionTime(
              s.startsAt,
            )} — ${escapeHtml(s.classTypeName ?? 'Class')}</span><span style="color:var(--muted-text);">${
              s.coachName ? escapeHtml(s.coachName) : ''
            }</span></div>`;
          })
          .join(''),
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2>${days}</div></section>`;
}

function fmtPlanPrice(p: PublicPlan, currency: string): string {
  if (p.monthlyPriceCents == null) return 'Contact us';
  const price = formatMoney(p.monthlyPriceCents, currency);
  if (p.kind === 'unlimited') return `${price}<span style="font-size:14px;font-weight:400;color:var(--muted-text);">/month</span>`;
  if (p.kind === 'credit_pack') return price;
  return `${price}<span style="font-size:14px;font-weight:400;color:var(--muted-text);">/period</span>`;
}

function renderPricing(b: PricingBlock, ctx: SiteRenderContext): string {
  const hidden = new Set(b.hiddenPlanIds);
  const visible = ctx.plans.filter((p) => !hidden.has(p.planId));
  if (visible.length === 0) {
    return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2><p style="color:var(--muted-text);">Get in touch for membership options.</p></div></section>`;
  }
  const cards = visible
    .map(
      (p) =>
        `<div class="card"><div style="font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:.03em;">${escapeHtml(
          p.name,
        )}</div><div class="plan-price">${fmtPlanPrice(p, ctx.gymCurrency)}</div></div>`,
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2><div class="grid grid-3">${cards}</div></div></section>`;
}

function renderTestimonials(b: TestimonialsBlock, ctx: SiteRenderContext): string {
  // Editable mode keeps the section (and its editable heading) even
  // with zero quotes, rather than hiding the whole section — that
  // would leave no canvas node to click before the first quote exists.
  if (b.quotes.length === 0 && !ctx.editable) return '';
  const cards = b.quotes
    .map(
      (q) =>
        `<div class="card"><span class="quote-mark">&ldquo;</span><p${fieldAttrs(ctx, `${b.id}:quotes:${q.id}:quote`, { multiline: true })}>${escapeHtml(
          q.quote,
        )}</p><div style="font-weight:700;font-size:13px;color:var(--muted-text);"${fieldAttrs(ctx, `${b.id}:quotes:${q.id}:name`)}>${escapeHtml(
          q.name,
        )}</div></div>`,
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2><div class="grid grid-3">${cards}</div></div></section>`;
}

function renderGallery(b: GalleryBlock, ctx: SiteRenderContext): string {
  if (b.images.length === 0 && !ctx.editable) return '';
  const imgs = b.images
    .map((img) => `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(img.alt)}" loading="lazy" />`)
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2><div class="gallery-grid">${imgs}</div></div></section>`;
}

function renderLocation(b: LocationBlock, ctx: SiteRenderContext): string {
  const address = ctx.editable
    ? `<p data-placeholder="Address"${fieldAttrs(ctx, `${b.id}:address`)}>${escapeHtml(b.address)}</p>`
    : b.address
      ? `<p>${escapeHtml(b.address)}</p>`
      : '';
  const hours = ctx.editable
    ? `<p style="color:var(--muted-text);white-space:pre-line;" data-placeholder="Hours"${fieldAttrs(ctx, `${b.id}:hours`, { multiline: true })}>${escapeHtml(b.hours)}</p>`
    : b.hours
      ? `<p style="color:var(--muted-text);white-space:pre-line;">${escapeHtml(b.hours)}</p>`
      : '';
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2>
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
    ? `<p style="color:var(--muted-text);" data-placeholder="Subheading"${fieldAttrs(ctx, `${b.id}:subheading`, { multiline: true })}>${escapeHtml(b.subheading)}</p>`
    : b.subheading
      ? `<p style="color:var(--muted-text);">${escapeHtml(b.subheading)}</p>`
      : '';
  return `<section class="sec" id="contact"><div class="wrap" style="text-align:center;max-width:520px;">
<h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2>
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
      const photo = m.avatarUrl
        ? `<img class="team-avatar" src="${escapeAttr(m.avatarUrl)}" alt="${escapeAttr(m.fullName)}" />`
        : `<div class="team-initials">${escapeHtml(teamInitial(m.fullName))}</div>`;
      return `<div class="team-card">${photo}<div class="team-name">${escapeHtml(m.fullName)}</div></div>`;
    })
    .join('');
  return `<section class="sec"><div class="wrap"><h2${fieldAttrs(ctx, `${b.id}:heading`)}>${escapeHtml(b.heading)}</h2><div class="team-grid">${cards}</div></div></section>`;
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
    post({ type: 'field-input', path: el.getAttribute('data-field'), value: el.innerText });
  });

  document.addEventListener('focusin', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el) return;
    post({ type: 'field-focus', path: el.getAttribute('data-field') });
  });

  document.addEventListener('blur', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el) return;
    el.innerText = el.innerText;
  }, true);

  document.addEventListener('keydown', function(e){
    var el = e.target.closest && e.target.closest('[data-field]');
    if (!el || e.key !== 'Enter') return;
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
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a');
    if (a) e.preventDefault();
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
})();
</script>`;

export function renderSiteHtml(doc: SiteDocument, ctx: SiteRenderContext): string {
  const header = renderSiteHeader(ctx);
  const firstHeroId = doc.blocks.find((b) => b.type === 'hero')?.id;
  const blocksHtml = doc.blocks
    .map((b) => renderBlock(b, ctx, b.id === firstHeroId))
    .join('');
  // A page with no hero would otherwise have no h1 at all — give it a
  // visually-hidden one so the outline starts at the right level.
  const fallbackH1 = firstHeroId
    ? ''
    : `<h1 class="sr-only">${escapeHtml(ctx.gymName)}</h1>`;
  const body = `<a class="skip-link" href="#main">Skip to content</a>${header}<main id="main">${fallbackH1}${blocksHtml}</main>`;
  const title = escapeHtml(ctx.gymName);
  const description = escapeAttr(
    `${ctx.gymName} — book a class, see membership options and get in touch.`,
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
</head><body>${body}${ctx.editable ? CANVAS_BRIDGE_SCRIPT : ''}</body></html>`;
}
