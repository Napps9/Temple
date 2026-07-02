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

export type SiteRenderContext = {
  slug: string;
  gymName: string;
  gymLogoUrl: string | null;
  gymCurrency: string;
  theme: BrandTheme; // already composed with the gym's brand colour
  schedule: ScheduleSession[];
  plans: PublicPlan[];
  // Needed only to render the contact block's working submit — the
  // anon key is a public, RLS-enforced credential, safe to embed the
  // same way every client build already does.
  supabaseUrl: string;
  supabaseAnonKey: string;
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

const RADIUS_PX: Record<BrandTheme['shape']['buttonRadius'], number> = {
  square: 0,
  rounded: 10,
  pill: 999,
};

function themeStyleBlock(theme: BrandTheme): string {
  const t = theme.typography;
  return `:root{
  --bg:${theme.palette.background};
  --surface:${theme.palette.surface};
  --text:${theme.palette.text};
  --muted:${theme.palette.muted};
  --accent:${theme.palette.accent};
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
a{color:var(--accent);}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px;}
.sec{padding:56px 0;border-bottom:1px solid color-mix(in srgb, var(--muted) 40%, transparent);}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;}
.btn{display:inline-block;font-weight:700;padding:14px 26px;border-radius:var(--radius);text-decoration:none;background:var(--accent);color:var(--accent-text);border:none;font-size:15px;cursor:pointer;}
.btn-ghost{display:inline-block;font-weight:700;padding:14px 26px;border-radius:var(--radius);text-decoration:none;background:transparent;color:var(--text);border:1px solid var(--muted);font-size:15px;}
.card{background:var(--surface);border-radius:var(--radius);padding:22px;}
.grid{display:grid;gap:16px;}
@media(min-width:640px){.grid-2{grid-template-columns:1fr 1fr;}.grid-3{grid-template-columns:repeat(3,1fr);}}
input,textarea{width:100%;padding:12px 14px;border-radius:calc(var(--radius) / 2);border:1px solid var(--muted);background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px;}
.hero-bg{position:relative;padding:96px 0;text-align:center;}
.hero-bg.has-img{background-size:cover;background-position:center;}
.hero-bg.has-img::before{content:"";position:absolute;inset:0;background:color-mix(in srgb, var(--bg) 55%, transparent);}
.hero-inner{position:relative;max-width:640px;margin:0 auto;}
.hero-inner p{max-width:52ch;margin:0 auto 26px;font-size:17px;}
.hero-side-text p{margin:0 0 26px;font-size:17px;}
.hero-side{display:grid;gap:32px;align-items:center;padding:72px 0;}
@media(min-width:720px){.hero-side{grid-template-columns:1fr 1fr;}}
.hero-side img{width:100%;border-radius:var(--radius);}
.about-grid{display:grid;gap:32px;align-items:center;}
@media(min-width:640px){.about-grid.side{grid-template-columns:1fr 1fr;}}
.about-grid img{width:100%;border-radius:var(--radius);}
.sched-day{font-size:12px;font-weight:700;text-transform:uppercase;color:var(--accent);margin:20px 0 8px;}
.sched-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid color-mix(in srgb, var(--muted) 40%, transparent);}
.sched-row:first-of-type{border-top:none;}
.plan-price{font-size:32px;font-weight:800;}
.quote-mark{font-size:32px;color:var(--accent);line-height:.4;display:block;margin-bottom:6px;}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
.gallery-grid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:calc(var(--radius) / 2);}`;
}

function renderHero(b: HeroBlock, ctx: SiteRenderContext): string {
  const ctaHref = b.ctaTarget === 'contact' ? '#contact' : `/join/${encodeURIComponent(ctx.slug)}`;
  const cta = `<a class="btn" href="${escapeAttr(ctaHref)}">${escapeHtml(b.ctaLabel)}</a>`;
  const eyebrow = `<div class="eyebrow">${escapeHtml(ctx.gymName)}</div>`;
  const headline = `<h1 style="font-size:clamp(32px,6vw,56px);">${escapeHtml(b.headline)}</h1>`;
  const subheadline = b.subheadline ? `<p>${escapeHtml(b.subheadline)}</p>` : '';

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

function renderAbout(b: AboutBlock): string {
  const text = `<div><h2>${escapeHtml(b.heading)}</h2><p style="white-space:pre-line;">${escapeHtml(b.body)}</p></div>`;
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
    return `<section class="sec"><div class="wrap"><h2>${escapeHtml(b.heading)}</h2><p style="color:var(--muted);">Check back soon for the full schedule.</p></div></section>`;
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
          .map(
            (s) =>
              `<div class="sched-row"><span>${fmtSessionTime(s.startsAt)} — ${escapeHtml(
                s.classTypeName ?? 'Class',
              )}</span><span style="color:var(--muted);">${
                s.coachName ? escapeHtml(s.coachName) : ''
              }</span></div>`,
          )
          .join(''),
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2>${escapeHtml(b.heading)}</h2>${days}</div></section>`;
}

function fmtPlanPrice(p: PublicPlan, currency: string): string {
  if (p.monthlyPriceCents == null) return 'Contact us';
  const price = formatMoney(p.monthlyPriceCents, currency);
  if (p.kind === 'unlimited') return `${price}<span style="font-size:14px;font-weight:400;color:var(--muted);">/month</span>`;
  if (p.kind === 'credit_pack') return price;
  return `${price}<span style="font-size:14px;font-weight:400;color:var(--muted);">/period</span>`;
}

function renderPricing(b: PricingBlock, ctx: SiteRenderContext): string {
  const hidden = new Set(b.hiddenPlanIds);
  const visible = ctx.plans.filter((p) => !hidden.has(p.planId));
  if (visible.length === 0) {
    return `<section class="sec"><div class="wrap"><h2>${escapeHtml(b.heading)}</h2><p style="color:var(--muted);">Get in touch for membership options.</p></div></section>`;
  }
  const cards = visible
    .map(
      (p) =>
        `<div class="card"><div style="font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:.03em;">${escapeHtml(
          p.name,
        )}</div><div class="plan-price">${fmtPlanPrice(p, ctx.gymCurrency)}</div></div>`,
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2>${escapeHtml(b.heading)}</h2><div class="grid grid-3">${cards}</div></div></section>`;
}

function renderTestimonials(b: TestimonialsBlock): string {
  if (b.quotes.length === 0) return '';
  const cards = b.quotes
    .map(
      (q) =>
        `<div class="card"><span class="quote-mark">&ldquo;</span><p>${escapeHtml(
          q.quote,
        )}</p><div style="font-weight:700;font-size:13px;color:var(--muted);">${escapeHtml(
          q.name,
        )}</div></div>`,
    )
    .join('');
  return `<section class="sec"><div class="wrap"><h2>${escapeHtml(b.heading)}</h2><div class="grid grid-3">${cards}</div></div></section>`;
}

function renderGallery(b: GalleryBlock): string {
  if (b.images.length === 0) return '';
  const imgs = b.images
    .map((img) => `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(img.alt)}" loading="lazy" />`)
    .join('');
  return `<section class="sec"><div class="wrap"><h2>${escapeHtml(b.heading)}</h2><div class="gallery-grid">${imgs}</div></div></section>`;
}

function renderLocation(b: LocationBlock): string {
  return `<section class="sec"><div class="wrap"><h2>${escapeHtml(b.heading)}</h2>
${b.address ? `<p>${escapeHtml(b.address)}</p>` : ''}
${b.hours ? `<p style="color:var(--muted);white-space:pre-line;">${escapeHtml(b.hours)}</p>` : ''}
</div></section>`;
}

function renderContact(b: ContactBlock, ctx: SiteRenderContext): string {
  // Vanilla-JS submit straight to the existing capture_public_lead RPC
  // over Supabase's PostgREST endpoint — the anon key is a public,
  // RLS-enforced credential, the same one every client build embeds.
  const script = `
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
  return `<section class="sec" id="contact"><div class="wrap" style="text-align:center;max-width:520px;">
<h2>${escapeHtml(b.heading)}</h2>
${b.subheading ? `<p style="color:var(--muted);">${escapeHtml(b.subheading)}</p>` : ''}
<form id="temple-contact-form" style="text-align:left;display:flex;flex-direction:column;gap:10px;margin-top:20px;">
  <input name="name" placeholder="Name" required />
  <input name="email" type="email" placeholder="Email" required />
  <textarea name="message" placeholder="What are you looking to achieve?" rows="3"></textarea>
  <button type="submit" class="btn">Send enquiry</button>
  <p id="temple-contact-status" style="font-size:13px;color:var(--muted);min-height:18px;"></p>
</form>
</div></section>${script}`;
}

function renderBlock(block: SiteBlock, ctx: SiteRenderContext): string {
  switch (block.type) {
    case 'hero':
      return renderHero(block, ctx);
    case 'about':
      return renderAbout(block);
    case 'schedule':
      return renderSchedule(block, ctx);
    case 'pricing':
      return renderPricing(block, ctx);
    case 'testimonials':
      return renderTestimonials(block);
    case 'gallery':
      return renderGallery(block);
    case 'location':
      return renderLocation(block);
    case 'contact':
      return renderContact(block, ctx);
  }
}

export function renderSiteHtml(doc: SiteDocument, ctx: SiteRenderContext): string {
  const body = doc.blocks.map((b) => renderBlock(b, ctx)).join('');
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
<style>${themeStyleBlock(ctx.theme)}</style>
</head><body>${body}</body></html>`;
}
