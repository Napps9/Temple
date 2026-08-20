// Builds the Temple redesign boards as static HTML; shot.mjs screenshots them.
// Second pass — rebuilt against actual screenshots of contra.com rather than
// from memory. Run: node build.mjs && node shot.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ icons */

const ICONS = {
  cal: '<rect x="3" y="5" width="18" height="16" rx="3.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  barbell: '<path d="M4 9v6M7 6.5v11M17 6.5v11M20 9v6M7 12h10"/>',
  trend: '<path d="M3 16.5l6-6 4 4 7.5-7.5"/><path d="M14.5 7h6v6"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  arrow: '<path d="M5 12h13"/><path d="M12.5 5.5L19 12l-6.5 6.5"/>',
  up: '<path d="M12 19.5V5"/><path d="M6 11l6-6 6 6"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3.4"/><path d="M2.5 10h19"/>',
  people:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.2 19.5a5.8 5.8 0 0 1 11.6 0"/><path d="M16.2 5.4a3.2 3.2 0 0 1 0 5.9"/><path d="M17.4 14.6a5.8 5.8 0 0 1 3.4 4.9"/>',
  person: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 5h11l-2 3.6 2 3.6h-11z"/>',
  doc: '<path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18"/><path d="M9 12.5h6M9 16h4"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  bell: '<path d="M6.2 9.5a5.8 5.8 0 0 1 11.6 0c0 4.7 1.9 5.8 1.9 5.8H4.3s1.9-1.1 1.9-5.8z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  chat: '<path d="M20 14.8a3 3 0 0 1-3 3H9.4L5 21v-3.6a3 3 0 0 1-1-2.6V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.6l1.5 2.5 2.9-.5.6 2.9 2.7 1.2-1.4 2.6 1.4 2.6-2.7 1.2-.6 2.9-2.9-.5L12 21.4l-1.5-2.5-2.9.5-.6-2.9-2.7-1.2L5.7 12 4.3 9.4l2.7-1.2.6-2.9 2.9.5z"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.2 2"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 20.5 20.5"/>',
  trophy:
    '<path d="M8 4h8v4.6a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.4A2.6 2.6 0 0 0 8 10.6M16 5.5h2.6A2.6 2.6 0 0 1 16 10.6"/><path d="M12 12.6v3.2M8.8 20h6.4l-.6-4H9.4z"/>',
  book: '<path d="M5 5.2A2.2 2.2 0 0 1 7.2 3H19v14.4H7.2A2.2 2.2 0 0 0 5 19.6z"/><path d="M5 19.6A1.6 1.6 0 0 1 6.6 18H19v3H6.6A1.6 1.6 0 0 1 5 19.6z"/>',
  body: '<circle cx="12" cy="4.4" r="2"/><path d="M12 7v7.2M12 7.6 7.2 9.4M12 7.6l4.8 1.8M12 14.2 9 20.4M12 14.2l3 6.2"/>',
  library: '<path d="M4 5h3.6v14H4zM9.6 5h3.6v14H9.6z"/><path d="M16.4 5.6l3.3 12.8-2.2.6-3.3-12.8z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m3.8 7 8.2 6 8.2-6"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
};

const sprite = () =>
  `<svg style="position:absolute;width:0;height:0" aria-hidden="true">${Object.entries(ICONS)
    .map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`)
    .join('')}</svg>`;

const ic = (n, s = 16, st = '') =>
  `<svg class="i" style="width:${s}px;height:${s}px;flex:none;${st}"><use href="#i-${n}"/></svg>`;
const icf = (n, s = 16, st = '') =>
  `<svg class="i i-fill" style="width:${s}px;height:${s}px;flex:none;${st}"><use href="#i-${n}"/></svg>`;

/* ------------------------------------------------------------------ marks */
/* The reference pairs a bold lowercase serif wordmark with one small, solid,
   abstract geometric glyph — no container tile, no pictorial detail. Four
   candidates in that register. */

const MARK = {
  // Straight lines only, and nothing that can be mistaken for a letterform —
  // the first attempt used a round arch, which read as a lowercase n sitting
  // next to a lowercase wordmark.
  portico: 'M3 6h42v7H3zM8.5 17h6.4v16H8.5zM20.8 17h6.4v16h-6.4zM33.1 17h6.4v16h-6.4zM3 36h42v7H3z',
  doorway: 'M6 44V9h36v35h-8.5V17.5h-19V44z',
  pediment: 'M24 4 45 20H3zM6 24h36v7H6zM3 36h42v7H3z',
  column: 'M13.5 5h21v6.4h-21zM18.6 14h10.8v21H18.6zM11.5 37.6h25V44h-25z',
};

const mark = (kind, size, color) =>
  `<svg viewBox="0 0 48 48" width="${size}" height="${size}" style="flex:none;display:block"><path fill="${color}" fill-rule="evenodd" d="${MARK[kind]}"/></svg>`;

// The glyph tiled faintly — the reference tiles tiny four-point stars into the
// corners of its hero.
function starfield(kind, color, opacity) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46"><g transform="translate(17.5 17.5) scale(0.229)"><path fill="${color}" fill-opacity="${opacity}" fill-rule="evenodd" d="${MARK[kind]}"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const wordmark = (size, color) =>
  `<span class="wordmark" style="font-size:${size}px;color:${color}">temple</span>`;

const lockup = (size, color) =>
  `<span class="row" style="gap:${Math.round(size * 0.34)}px">${mark('portico', Math.round(size * 0.92), color)}${wordmark(size, color)}</span>`;

/* --------------------------------------------------------------- fixtures */

const MEDIA = {
  owner:
    'radial-gradient(110% 80% at 80% 6%, #fcd34d 0%, rgba(252,211,77,0) 58%), linear-gradient(158deg, #f97316 0%, #7c2d12 100%)',
  strength:
    'radial-gradient(110% 80% at 24% 10%, #fda4af 0%, rgba(253,164,175,0) 58%), linear-gradient(150deg, #e11d48 0%, #4c0519 100%)',
};

const AV = (initials, size = 30) =>
  `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.37)}px">${initials}</div>`;

// Below 24px these stand in for photographs, so the initials come off.
const avstack = (list, size = 24, onMedia = false) =>
  `<div class="avstack ${size < 24 ? 'faces' : ''} ${onMedia ? 'on-media' : ''}">${list.map((i) => AV(i, size)).join('')}</div>`;

const orb = (size) => `<span class="orb" style="width:${size}px;height:${size}px;display:block"></span>`;

/* ----------------------------------------------------------- page scaffold */

function page({ title, sub, body, extraCss = '' }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="fonts.css">
<link rel="stylesheet" href="system.css">
<link rel="stylesheet" href="legacy.css">
<style>${extraCss}</style></head>
<body class="board">
${sprite()}
<div class="board-head">
  <h1 class="board-title">${title}</h1>
  <p class="board-sub">${sub}</p>
</div>
${body}
</body></html>`;
}

const statusbar = () => `
<div class="statusbar">
  <span class="num" style="font-size:14.5px">9:41</span>
  <span class="row" style="gap:5px;opacity:.85">
    <svg style="width:17px;height:11px" viewBox="0 0 17 11"><g fill="currentColor">
      <rect y="7" width="3" height="4" rx="1"/><rect x="4.3" y="5" width="3" height="6" rx="1"/>
      <rect x="8.6" y="2.6" width="3" height="8.4" rx="1"/><rect x="12.9" width="3" height="11" rx="1"/></g></svg>
    <svg style="width:15px;height:11px" viewBox="0 0 15 11"><path d="M7.5 9.4l2-2a2.9 2.9 0 0 0-4 0zM3.6 5.5a5.6 5.6 0 0 1 7.8 0l1.5-1.6a7.8 7.8 0 0 0-10.8 0z" fill="currentColor"/></svg>
    <svg style="width:24px;height:11px" viewBox="0 0 24 11"><rect x=".5" y=".5" width="19" height="10" rx="3" fill="none" stroke="currentColor" stroke-opacity=".4"/><rect x="2" y="2" width="15" height="7" rx="1.6" fill="currentColor"/><path d="M21 3.6v3.8a2 2 0 0 0 0-3.8z" fill="currentColor" fill-opacity=".5"/></svg>
  </span>
</div>`;

const phone = (inner, { dark = false, label = '', legacy = false } = {}) => `
<div class="frame-wrap">
  ${label ? `<div class="frame-label">${label}</div>` : ''}
  <div class="frame"><div class="screen ${legacy ? 'legacy' : 'app'} ${dark ? 'dark' : ''}"
      style="background:var(${legacy ? '--l-bg' : '--bg'});color:var(${legacy ? '--l-ink' : '--ink'})">
    ${statusbar()}${inner}
    <div class="homebar"><span></span></div>
  </div></div>
</div>`;

/* ------------------------------------------------------------- app pieces */

// Member top bar. Nav borrows the reference's feed filter row: the selected
// item is a soft tinted pill, the rest are plain grey icons.
const navChips = (items, active) =>
  items
    .map(
      ([k, i, l]) =>
        `<span class="chip ${active === k ? 'chip-on' : ''}" style="${active === k ? '' : 'border-color:transparent;background:transparent'}">${ic(i, 15)}${active === k ? l : ''}</span>`,
    )
    .join('');

const topbar = (active) => `
<div class="topbar">
  <div class="row g8 grow" style="min-width:0"><div class="gymtile">F</div></div>
  <div class="row g4">${navChips(
    [['programming', 'barbell', 'Programming'], ['book', 'cal', 'Book'], ['track', 'trend', 'Track']],
    active,
  )}</div>
  <div class="row g8 grow" style="justify-content:flex-end">${AV('an')}</div>
</div>`;

const staffTopbar = (active) => `
<div class="topbar">
  <div class="row g8 grow" style="min-width:0"><div class="gymtile">F</div></div>
  <div class="row g4">${navChips(
    [['timeline', 'chat', 'Timeline'], ['programming', 'barbell', ''], ['classes', 'cal', ''], ['manage', 'gear', '']],
    active,
  )}</div>
  <div class="row g6 grow" style="justify-content:flex-end">
    <span class="chip chip-sm">Staff</span>${AV('do')}
  </div>
</div>`;

const dayStrip = (sel = 3) =>
  `<div class="row g4" style="padding:2px 14px 12px">
    ${[['M', 18], ['T', 19], ['W', 20], ['T', 21], ['F', 22], ['S', 23], ['S', 24]]
      .map(
        ([d, n], i) =>
          `<div class="daycell ${i === sel ? 'on' : ''} ${i === 2 ? 'today' : ''}"><span class="d">${d}</span><span class="n">${n}</span></div>`,
      )
      .join('')}
  </div>`;

const filterRow = () => `
<div class="row g6 wrap" style="padding:0 16px 14px">
  <span class="chip chip-sm chip-on">All</span>
  <span class="chip chip-sm"><i class="dot" style="background:#e11d48"></i>Strength</span>
  <span class="chip chip-sm"><i class="dot" style="background:#6366f1"></i>Metcon</span>
  <span class="chip chip-sm"><i class="dot" style="background:#0f766e"></i>Open Gym</span>
</div>`;

function agendaRow({ time, dur, name, colour, coach, status, tone, action, who, rec }) {
  const toneStyle =
    tone === 'ok' ? 'color:var(--ok)' : tone === 'warn' ? 'color:var(--warn)' : 'color:var(--ink-3)';
  const cta =
    action === 'booked'
      ? `<span class="chip chip-sm chip-ok">${ic('check', 12)}Booked</span>`
      : action === 'waitlist'
        ? `<span class="chip chip-sm">Waitlist</span>`
        // Five rows, five identical actions: ink, not the brand colour. The
      // accent is saved for the one action a page exists for.
      : `<span class="btn btn-dark btn-sm">Book</span>`;
  return `
<div class="row g12" style="padding:0 16px 10px;align-items:stretch">
  <div style="width:44px;flex:none;padding-top:14px;text-align:right">
    <div class="num" style="font-size:14.5px">${time}</div>
    <div class="lbl" style="letter-spacing:.05em;font-size:10px;margin-top:2px">${dur}</div>
  </div>
  <div class="card grow" style="padding:12px 13px">
    <div class="row g8">
      <i class="dot" style="background:${colour}"></i>
      <span class="h3 grow trunc">${name}</span>
      ${rec ? `<span class="chip chip-sm chip-accent">${icf('spark', 11)}For you</span>` : ''}
      ${cta}
    </div>
    <div class="row between g8" style="margin-top:9px">
      <span class="small trunc" style="font-size:13px">
        ${coach ? `${coach} <span class="dim">·</span> ` : ''}<b style="${toneStyle}">${status}</b>
      </span>
      ${who ? avstack(who, 21) : ''}
    </div>
  </div>
</div>`;
}

/* ============================================================ 01 identity */

function identityBoard() {
  const swatch = (name, hex, note) => `
    <div class="stack g8" style="width:124px">
      <div style="height:60px;border-radius:12px;background:${hex};border:1px solid var(--line)"></div>
      <div class="stack g2">
        <span class="h3" style="font-size:13px">${name}</span>
        <span class="lbl" style="letter-spacing:.05em">${hex}</span>
        <span class="small" style="font-size:11.5px;line-height:1.35">${note}</span>
      </div>
    </div>`;

  const dir = (kind, name, blurb, rec) => `
  <div class="card" style="width:206px;padding:15px;${rec ? 'border-color:var(--ink)' : ''}">
    <div class="row between" style="height:22px">
      <span class="lbl">${rec ? 'Recommended' : 'Alternative'}</span>
      ${rec ? `<span class="badge" style="background:var(--ink);color:#fff">Pick this</span>` : ''}
    </div>
    <div class="row g14" style="margin-top:16px;align-items:flex-end;height:60px">
      ${mark(kind, 54, '#14161a')}${mark(kind, 25, '#14161a')}${mark(kind, 15, '#14161a')}
    </div>
    <div class="row g8" style="margin-top:16px">
      <span style="width:42px;height:42px;border-radius:11px;background:#14161a;display:flex;align-items:center;justify-content:center">${mark(kind, 22, '#ffffff')}</span>
      <span style="width:42px;height:42px;border-radius:11px;background:#f1f1f4;display:flex;align-items:center;justify-content:center">${mark(kind, 22, '#14161a')}</span>
      <span style="width:42px;height:42px;border-radius:11px;background:#c2410c;display:flex;align-items:center;justify-content:center">${mark(kind, 22, '#ffffff')}</span>
    </div>
    <div class="h2" style="margin-top:15px;font-size:17px">${name}</div>
    <div class="small" style="margin-top:5px;font-size:12.5px;line-height:1.4">${blurb}</div>
  </div>`;

  const body = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="row g24" style="align-items:stretch">
    <div class="card grow starfield" style="padding:34px 30px;background-image:${starfield('portico', '%2314161a', 0.09)};background-color:var(--surface)">
      <span class="lbl">The lockup</span>
      <div style="margin-top:22px">${lockup(40, '#14161a')}</div>
      <div class="small" style="margin-top:22px;font-size:12.5px;max-width:310px">
        A bold lowercase serif beside one solid geometric glyph — the same
        two-part construction the reference uses, and the opposite of an
        illustrated tile.
      </div>
    </div>
    <div class="card grow starfield" style="padding:34px 30px;background-color:#14161a;border-color:#14161a;background-image:${starfield('portico', '%23ffffff', 0.10)}">
      <span class="lbl" style="color:#6c727b">Reversed</span>
      <div style="margin-top:22px">${lockup(40, '#ffffff')}</div>
      <div class="small" style="margin-top:22px;font-size:12.5px;max-width:310px;color:#9aa0a9">
        The mark never sits in a coloured container and never takes a gym's
        brand colour. Inside a gym, the gym's own logo leads.
      </div>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <span class="lbl">Mark directions</span>
  <div class="row wrap" style="margin-top:14px;gap:14px;align-items:stretch">
    ${dir('portico', 'Portico', 'Entablature, three columns, plinth. The only one of the four that still reads as a building at 15px, and it cannot be mistaken for a letter.', true)}
    ${dir('doorway', 'Doorway', 'The gate, squared off. Simplest and boldest — and the most generic; plenty of products own a shape like this already.', false)}
    ${dir('pediment', 'Pediment', 'Roof over two courses of stone, no columns. The most abstract, and the closest in register to a compass-star.', false)}
    ${dir('column', 'Column', 'One column: capital, shaft, base. Quiet and distinctive, but slight enough that it disappears beside the wordmark.', false)}
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <div class="row g36" style="align-items:flex-start">
    <div class="stack g14" style="flex:1">
      <span class="lbl">Applied</span>
      <div class="row g14" style="align-items:flex-end">
        ${[[92, 21, '1024'], [56, 13, '180'], [36, 9, '64'], [20, 5, '32']]
          .map(
            ([s, r, l]) => `
          <div class="stack g8" style="align-items:center">
            <span style="width:${s}px;height:${s}px;border-radius:${r}px;background:#14161a;display:flex;align-items:center;justify-content:center">${mark('portico', Math.round(s * 0.52), '#ffffff')}</span>
            <span class="lbl" style="letter-spacing:.05em">${l}</span>
          </div>`,
          )
          .join('')}
        <div class="stack g8" style="align-items:center">
          <span style="width:36px;height:36px;border-radius:999px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;border:1px solid var(--line)">${mark('portico', 18, '#14161a')}</span>
          <span class="lbl" style="letter-spacing:.05em">avatar</span>
        </div>
      </div>
      <div class="small" style="max-width:400px;font-size:13px">
        One glyph, two fills, and the container is whatever it is sitting in.
        The gold and steel from today's logo stop being structure and become
        two of the grounds it can sit on.
      </div>
      <div class="row g8" style="margin-top:2px">
        ${['#14161a', '#3b6ba5', '#e8b620', '#c2410c']
          .map(
            (c) =>
              `<span style="width:42px;height:42px;border-radius:11px;background:${c};display:flex;align-items:center;justify-content:center">${mark('portico', 22, c === '#e8b620' ? '#14161a' : '#ffffff')}</span>`,
          )
          .join('')}
      </div>
    </div>

    <div class="stack g14" style="flex:1">
      <span class="lbl">Wordmark</span>
      <div class="card" style="padding:22px">
        <div class="stack" style="gap:18px">
          <div class="stack g6">
            ${wordmark(46, '#14161a')}
            <span class="small" style="font-size:12px">Fraunces 700 · opsz 144 · WONK on — logo only, never in the UI.</span>
          </div>
          <div class="rule"></div>
          <div class="stack g6">
            <span style="font-size:34px;font-weight:700;letter-spacing:-.035em;color:#14161a;line-height:1">Book a class</span>
            <span class="small" style="font-size:12px">Geist 700 — every heading, every number, every label.</span>
          </div>
        </div>
      </div>
      <div class="small" style="max-width:400px;font-size:13px">
        Lowercase, not caps. The serif carries all of the warmth in the brand
        so the product itself can stay completely neutral.
      </div>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <span class="lbl">Palette — cool and monochrome; colour arrives from content</span>
  <div class="row g14 wrap" style="margin-top:14px">
    ${swatch('Ink', '#14161A', 'Text, the mark, dark buttons')}
    ${swatch('Ground', '#F7F7F8', 'Behind the cards (was #F1F5F9)')}
    ${swatch('Surface', '#FFFFFF', 'Every card')}
    ${swatch('Line', '#E9E9EE', 'Every border')}
    ${swatch('Tint', '#F1F1F4', 'Selected pills, insets')}
    ${swatch('Muted', '#8B909A', 'Labels and meta')}
    ${swatch('Gym accent', '#C2410C', 'Runtime, per gym — one place at a time')}
  </div>
</div>`;

  return page({
    title: 'Identity — wordmark, mark, palette',
    sub: 'Rebuilt from the screenshots: a bold lowercase serif wordmark beside one small solid geometric glyph, on a cool monochrome palette. My first pass had an uppercase grotesque inside a rounded tile on warm cream — wrong on all three counts.',
    body,
  });
}

/* ================================================================ 02 type */

function typeBoard() {
  const controls = () => `
  <div class="card">
    <div class="row g10 wrap">
      <span class="btn btn-accent">Book</span>
      <span class="btn btn-dark">Post</span>
      <span class="btn btn-plain">Cancel</span>
      <span class="btn btn-soft">Waitlist</span>
    </div>
    <div class="row g8 wrap" style="margin-top:16px">
      <span class="chip chip-on">For you</span>
      <span class="chip">${ic('cal', 14)}Topics</span>
      <span class="chip chip-ok">${ic('check', 13)}Booked</span>
      <span class="chip chip-warn">3 spots left</span>
      <span class="chip chip-bad">Payment failed</span>
      <span class="chip chip-accent">${icf('spark', 12)}For you</span>
    </div>
    <div class="row g8 wrap" style="margin-top:16px;align-items:center">
      <span class="badge">Pro</span>
      <span class="badge">Coming soon</span>
      <span class="lbl">Section label</span>
      <span class="grow"></span>
      ${avstack(['dk', 'pr', 'mb', 'lk'], 22)}
    </div>
    <div class="stack g6" style="margin-top:16px">
      <div class="row between"><span class="small" style="font-size:12.5px">Setup</span><span class="small num" style="font-size:12.5px">60%</span></div>
      <div class="bar"><i style="width:60%"></i></div>
    </div>
    <div class="glow" style="margin-top:24px">
      <div class="field" style="min-height:52px">
        <span class="grow">Show me a member, change a class…</span>
        <span class="btn btn-dark btn-sm" style="padding-left:8px">${orb(18)}Let's go</span>
      </div>
    </div>
  </div>`;

  const body = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <span class="lbl">Two faces, and that is the whole system</span>
  <div class="row g16" style="margin-top:14px;align-items:stretch">
    <div class="card" style="flex:1;padding:24px">
      <span class="lbl">Wordmark only</span>
      <div style="margin-top:16px">${wordmark(54, '#14161a')}</div>
      <div class="row g10" style="margin-top:16px;align-items:baseline">
        <span class="wordmark" style="font-size:26px">temple</span>
        <span class="wordmark" style="font-size:18px">temple</span>
        <span class="wordmark" style="font-size:13px">temple</span>
      </div>
      <div class="small" style="margin-top:16px;font-size:13px">
        <b class="strong">Fraunces</b> — variable, free, with the WONK axis on
        for the splayed leg on the <i>r</i> and the curved tail on the
        <i>a</i>. It appears in exactly one place.
      </div>
    </div>
    <div class="card" style="flex:1.4;padding:24px">
      <span class="lbl">Everything else</span>
      <div style="font-size:44px;font-weight:700;letter-spacing:-.038em;line-height:1.02;margin-top:14px">Book a class</div>
      <div style="font-size:19px;color:var(--ink-2);margin-top:10px">Thursday 21 August · 18:00</div>
      <div class="small" style="margin-top:16px;font-size:13px">
        <b class="strong">Geist</b> — neutral, tight, nine weights. One family
        for headings, body, numbers and labels, so nothing decorative competes
        with the gym's own brand.
      </div>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>

  <span class="lbl">The scale</span>
  <div style="margin-top:8px">
    ${[
      ['Display', 'font-size:40px;font-weight:700;letter-spacing:-.038em', 'Geist 700 · 40/41 · −0.038em'],
      ['Page title', 'font-size:28px;font-weight:700;letter-spacing:-.032em', 'Geist 700 · 28/31 · −0.032em'],
      ['Card title', 'font-size:20px;font-weight:700;letter-spacing:-.026em', 'Geist 700 · 20/24 · −0.026em'],
      ['Row title', 'font-size:15.5px;font-weight:600;letter-spacing:-.014em', 'Geist 600 · 15.5/20'],
      ['Body', 'font-size:15px;color:var(--ink-2)', 'Geist 400 · 15/22'],
      ['Meta', 'font-size:13.5px;color:var(--ink-2)', 'Geist 400 · 13.5/19'],
    ]
      .map(
        ([l, css, spec]) => `
      <div class="row g16" style="align-items:baseline;padding:11px 0;border-bottom:1px solid var(--line)">
        <span class="lbl" style="width:92px;flex:none">${l}</span>
        <span style="${css};flex:1">The whiteboard, the front desk, the books</span>
        <span class="small" style="font-size:11.5px;width:200px;flex:none;text-align:right">${spec}</span>
      </div>`,
      )
      .join('')}
    <div class="row g16" style="align-items:baseline;padding:11px 0">
      <span class="lbl" style="width:92px;flex:none">Label</span>
      <span class="lbl" style="flex:1">The whiteboard, the front desk, the books</span>
      <span class="small" style="font-size:11.5px;width:200px;flex:none;text-align:right">Geist 600 · 11px · +0.09em · caps</span>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>

  <div class="row g24" style="align-items:flex-start">
    <div class="stack g14" style="flex:1"><span class="lbl">Controls</span>${controls()}</div>
    <div class="stack g14" style="flex:1">
      <span class="lbl">The same set in dark</span>
      <div class="app dark" style="background:var(--bg);border-radius:20px;padding:16px">${controls()}</div>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>

  <div class="row between" style="align-items:flex-end">
    <span class="lbl">Where the gym's colour is allowed to appear</span>
    <span class="small" style="font-size:12.5px">Everything not listed here stays monochrome</span>
  </div>
  <div class="row g14 wrap" style="margin-top:14px">
    ${[
      ['Logo tile', `<div class="gymtile" style="width:38px;height:38px;border-radius:11px;font-size:17px">F</div>`],
      ['The one primary action', `<span class="btn btn-accent btn-sm">Book</span>`],
      ['Class-type dots', `<span class="row g8"><i class="dot" style="background:#e11d48"></i><i class="dot" style="background:#6366f1"></i><i class="dot" style="background:#0f766e"></i></span>`],
      ['A member\u2019s own data', `<span class="row g2">${[0.25, 0.5, 1, 0.4, 1, 0.7].map((o) => `<i style="width:11px;height:11px;border-radius:3px;background:var(--accent);opacity:${o};display:block"></i>`).join('')}</span>`],
      ['The gym\u2019s photography', `<span style="width:86px;height:38px;border-radius:10px;display:block;background:${MEDIA.strength}"></span>`],
    ]
      .map(
        ([label, el]) => `
      <div class="card" style="flex:1;min-width:196px;padding:14px">
        <div style="height:40px;display:flex;align-items:center">${el}</div>
        <div class="small" style="margin-top:10px;font-size:12.5px">${label}</div>
      </div>`,
      )
      .join('')}
  </div>
  <div class="small" style="margin-top:14px;font-size:13px;max-width:780px">
    The reference keeps its primary button near-black and lets colour in only
    through content. Temple sells "make it look like your gym", so the accent
    keeps the primary action here — that is the one deliberate departure, and
    it is a single token if you would rather it were ink.
  </div>

  <div class="rule" style="margin:26px 0"></div>

  <span class="lbl">One system, five gyms</span>
  <div class="row g12 wrap" style="margin-top:14px">
    ${[
      ['#c2410c', 'Forge Barbell Club', 'F'],
      ['#3b6ba5', 'Southbank S&amp;C', 'S'],
      ['#0f766e', 'Grove Athletic', 'G'],
      ['#7c3aed', 'Nightshift Fitness', 'N'],
      ['#b91c1c', 'Harbour CrossFit', 'H'],
    ]
      .map(
        ([c, n, l]) => `
      <div class="card" style="flex:1;min-width:194px;padding:14px">
        <div class="row g10">
          <div class="gymtile" style="background:${c}">${l}</div>
          <span class="h3 trunc grow" style="font-size:13.5px">${n}</span>
        </div>
        <div class="row g6" style="margin-top:12px">
          <span class="btn btn-sm" style="background:${c};color:#fff">Book</span>
          <span class="chip chip-sm">${ic('cal', 12)}Thu</span>
        </div>
      </div>`,
      )
      .join('')}
  </div>
</div>`;

  return page({
    title: 'Type, controls, and where colour is allowed',
    sub: 'One serif for the wordmark, one sans for the entire product, and a control set with no shadows except on things that float. The selected state is a soft tint or a raised white card — never an ink fill, which is what I got wrong last time.',
    body,
  });
}

/* ============================================================= 03 landing */

function landingBoard() {
  const deck = () => `
  <div style="position:relative;height:404px">
    <div style="position:absolute;left:20px;right:0;top:22px;bottom:0;border-radius:16px;background:var(--surface-3)"></div>
    <div style="position:absolute;left:10px;right:10px;top:11px;bottom:11px;border-radius:16px;background:var(--surface-2);border:1px solid var(--line)"></div>
    <div class="media" style="position:absolute;left:0;right:20px;top:0;bottom:22px;background-image:${MEDIA.owner}">
      <div class="top">
        <span class="appicon">${ic('grid', 13)}</span>
        <span style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;opacity:.92">Owner</span>
        <span class="grow"></span>
        ${ic('arrow', 17, 'opacity:.9')}
      </div>
      <div style="font-size:27px;font-weight:700;letter-spacing:-.035em;line-height:1.06">
        The whiteboard,<br>the front desk,<br>the books — one app.
      </div>
      <div class="stack g6" style="margin-top:14px;font-size:12.5px;line-height:1.35;opacity:.92">
        ${[
          'Programming, schedules and bookings on one calendar',
          'Members, plans and comms in one place',
          "A public join link the moment you're ready",
          "Insights that tell you what's working",
          'Make it look like your gym, not a template',
        ]
          .map((b) => `<div class="row g8">${ic('check', 13, 'opacity:.8;margin-top:2px')}<span>${b}</span></div>`)
          .join('')}
      </div>
      <div class="row between g10" style="margin-top:16px">
        <span class="btn" style="background:#fff;color:#14161a;height:40px">Get set up</span>
        ${avstack(['dk', 'pr', 'mb'], 22, true)}
      </div>
    </div>
  </div>`;

  const screen = (dark) => `
<div class="scrollarea starfield" style="background-image:${starfield('portico', dark ? '%23ffffff' : '%2314161a', dark ? 0.10 : 0.09)}">
  <div class="row between" style="padding:6px 18px 0">
    ${lockup(20, dark ? '#f4f5f6' : '#14161a')}
    <span class="row g8">
      <span class="chip chip-sm">Log in</span>
      <span class="btn btn-dark btn-sm">Sign up</span>
    </span>
  </div>

  <div style="padding:30px 18px 18px;text-align:center">
    <div class="display" style="font-size:38px">Welcome to Temple</div>
    <div class="body" style="margin:12px auto 0;font-size:15px;max-width:300px">
      Pick how you'll use it — swipe through, you can always switch later.
    </div>
  </div>

  <div style="padding:0 18px">${deck()}</div>

  <div class="row g10" style="justify-content:center;padding:20px 0 0">
    <span class="chip" style="width:30px;padding:0;justify-content:center">${ic('left', 14)}</span>
    <span class="row g6">
      <i class="dot" style="width:8px;height:8px;background:var(--ink)"></i>
      <i class="dot" style="background:var(--line-strong)"></i>
      <i class="dot" style="background:var(--line-strong)"></i>
    </span>
    <span class="chip" style="width:30px;padding:0;justify-content:center">${ic('right', 14)}</span>
  </div>

  <div class="stack g8" style="align-items:center;padding:22px 18px 0">
    <span class="h3" style="font-size:14px">Already have an account? <span style="color:var(--link)">Sign in</span></span>
    <span class="small dim" style="font-size:11.5px;text-align:center;max-width:280px">
      By continuing you agree to the Terms and Privacy Policy.
    </span>
  </div>
</div>`;

  const body = `<div class="board-row">
  ${phone(screen(false), { label: 'Light' })}
  ${phone(screen(true), { dark: true, label: 'Dark' })}
</div>`;

  return page({
    title: 'Logged out — /get-started',
    sub: 'The reference sells with a full-bleed card: an image, white text over a scrim, a pill CTA and the faces of the people already there. The three paths become exactly that, on a white ground with the mark tiled faintly behind — instead of three gradient panels with icon bullets.',
    body,
  });
}

/* ================================================================ 04 book */

function bookBoard() {
  const rows = () => `
  ${agendaRow({ time: '06:00', dur: '60 min', name: 'Strength', colour: '#e11d48', coach: 'Dani Okafor', status: '8 spots left', tone: 'ok', who: ['jm', 'ro', 'ka'] })}
  ${agendaRow({ time: '07:15', dur: '45 min', name: 'Metcon', colour: '#6366f1', coach: 'Dani Okafor', status: 'You are in', tone: 'ok', action: 'booked', who: ['an', 'lk', 'tm', 'bh'] })}
  ${agendaRow({ time: '12:00', dur: '90 min', name: 'Open Gym', colour: '#0f766e', coach: null, status: '14 spots left', tone: 'ok', who: ['sw'] })}
  ${agendaRow({ time: '17:30', dur: '45 min', name: 'Metcon', colour: '#6366f1', coach: 'Priya Raman', status: '3 spots left', tone: 'warn', rec: true, who: ['lk', 'mb', 'ro'] })}
  ${agendaRow({ time: '18:45', dur: '60 min', name: 'Barbell Club', colour: '#7c3aed', coach: 'Marcus Bell', status: 'Full — 2 waiting', tone: 'dim', action: 'waitlist', who: ['tm', 'jm', 'ka', 'bh'] })}`;

  const nextCard = () => `
  <div style="padding:0 16px 14px">
    <div class="card" style="padding:13px 14px">
      <div class="row g10">
        <div class="stack g2 grow" style="min-width:0">
          <span class="lbl">Your next class</span>
          <span class="h3" style="margin-top:3px;font-size:16px">Thu 21 Aug at 18:00</span>
        </div>
        <span class="chip chip-sm"><i class="dot" style="background:#6366f1"></i>Metcon</span>
        ${ic('right', 15, 'color:var(--ink-3)')}
      </div>
    </div>
  </div>`;

  const screen = () => `
${topbar('book')}
<div class="scrollarea">
  ${dayStrip(3)}
  ${filterRow()}
  ${nextCard()}
  <div class="row between" style="padding:0 16px 10px">
    <span class="lbl">Thursday 21 August</span>
    <span class="small dim" style="font-size:12.5px">5 classes</span>
  </div>
  ${rows()}
</div>`;

  const body = `<div class="board-row">
  ${phone(screen(), { label: 'Light' })}
  ${phone(screen(), { dark: true, label: 'Dark' })}
</div>`;

  return page({
    title: 'Member — Book',
    sub: 'The timeline rail from my first pass is gone — that was Luma, not this. What replaces it is the reference\'s own move: the people already in the class, as an overlapping avatar stack on every row. It answers "should I go to this one" better than a spot count does, and Temple already has the data.',
    body,
  });
}

/* =============================================================== 05 track */

function trackBoard() {
  const heat = () => {
    const seed = [
      3, 0, 2, 0, 3, 1, 0, 2, 3, 0, 2, 0, 1, 0, 3, 2, 0, 3, 0, 2, 0,
      1, 3, 2, 0, 3, 0, 0, 2, 0, 3, 1, 2, 0, 0, 3, 2, 0, 3, 0, 1, 0,
      0, 3, 2, 0, 3, 0, 2, 2, 0, 3, 1, 0, 2, 0, 3, 0, 2, 3, 0, 1, 0,
      2, 0, 3, 1, 0, 3, 0, 3, 2, 0, 2, 0, 3, 0, 1, 2, 3, 0, 2, 0, 0,
    ];
    const cols = [];
    for (let w = 0; w < 12; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const v = seed[(w * 7 + d) % seed.length];
        col.push(
          `<i style="${v === 0 ? '' : `background:var(--accent);opacity:${v === 1 ? 0.3 : v === 2 ? 0.6 : 1}`}"></i>`,
        );
      }
      cols.push(`<div>${col.join('')}</div>`);
    }
    return `<div class="heat">${cols.join('')}</div>`;
  };

  const stat = (n, label) => `
    <div class="grow stack g2" style="min-width:0">
      <span class="num" style="font-size:25px">${n}</span>
      <span class="lbl" style="letter-spacing:.045em;font-size:10px">${label}</span>
    </div>`;

  const tile = (icon, title, sub, badge) => `
    <div class="card" style="padding:12px;display:flex;flex-direction:column;min-height:86px">
      <div class="row between">
        <span style="color:var(--ink-2)">${ic(icon, 19)}</span>
        ${badge ? `<span class="badge">${badge}</span>` : ic('right', 15, 'color:var(--ink-3)')}
      </div>
      <div class="stack g2" style="margin-top:auto">
        <span class="h3" style="font-size:14.5px">${title}</span>
        <span class="small dim" style="font-size:12px;line-height:1.3">${sub}</span>
      </div>
    </div>`;

  const screen = () => `
${topbar('track')}
<div class="scrollarea">
  <div class="row between" style="padding:10px 16px 12px;align-items:flex-start">
    <div class="stack g4 grow">
      <span class="h1">Track</span>
      <span class="body" style="font-size:14px">Log workouts and PRs across movements.</span>
    </div>
    <span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Record</span>
  </div>

  <div style="padding:0 16px 14px">
    <div class="card">
      <div class="row" style="align-items:stretch">
        ${stat(4, 'Day streak')}
        <span style="width:1px;background:var(--line);margin:0 12px"></span>
        ${stat(6, 'Week streak')}
        <span style="width:1px;background:var(--line);margin:0 12px"></span>
        ${stat(11, 'This month')}
      </div>
      <div class="rule" style="margin:14px 0 12px"></div>
      <div class="row between">
        <span class="lbl">Last 12 weeks</span>
        <span class="small dim" style="font-size:12px">42 sessions</span>
      </div>
      <div style="margin-top:9px;width:176px">${heat()}</div>
    </div>
  </div>

  <div class="row between" style="padding:0 16px 10px">
    <span class="lbl">Your movements</span>
    <span class="small" style="font-size:12.5px;color:var(--link)">See all</span>
  </div>

  <div style="padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${tile('book', 'Journal', '38 sessions logged')}
    ${tile('trophy', 'Leaderboards', 'Heaviest, fastest, hardest')}
    ${tile('library', 'Movement Library', 'Search &amp; star all movements')}
    ${tile('body', 'Injury tracker', '1 open injury', '1 due')}
  </div>

  <div style="padding:10px 16px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${[
      ['Squat', '6 moves', '142.5', 'Back squat · 3 wks ago', '0,18 12,15 24,16 36,10 48,8 60,3'],
      ['Press', '4 moves', '62.5', 'Strict press · 6 days ago', '0,14 12,15 24,11 36,12 48,7 60,6'],
    ]
      .map(
        ([name, moves, kg, sub, pts]) => `
      <div class="card" style="padding:12px">
        <div class="row between">
          <span class="h3" style="font-size:14px">${name}</span>
          <span class="lbl" style="letter-spacing:.05em">${moves}</span>
        </div>
        <div class="row between" style="margin-top:7px;align-items:flex-end">
          <span class="num" style="font-size:21px">${kg}<span style="font-size:11px;font-weight:600"> kg</span></span>
          <svg viewBox="0 0 60 22" style="width:52px;height:18px;flex:none">
            <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="small dim" style="font-size:11px;margin-top:4px">${sub}</div>
      </div>`,
      )
      .join('')}
  </div>
</div>`;

  const body = `<div class="board-row">
  ${phone(screen(), { label: 'Light' })}
  ${phone(screen(), { dark: true, label: 'Dark' })}
</div>`;

  return page({
    title: 'Member — Track',
    sub: 'Numbers set plainly with a small-caps label under each, split by hairlines rather than boxed into tinted tiles. The tool tiles lose their coloured top rules and icon bubbles: a line icon, a title, a sub, a chevron. The only colour left on the page is the gym\'s, on the member\'s own data.',
    body,
  });
}

/* ============================================================ 06 timeline */

function timelineBoard() {
  const receipt = (icon, text, time) => `
  <div class="row g10" style="align-items:flex-start">
    <span style="color:var(--ink-3);margin-top:1px">${ic(icon, 15)}</span>
    <div class="grow small" style="font-size:13.5px;line-height:1.42">${text}</div>
    <span class="lbl" style="letter-spacing:.05em;margin-top:2px">${time}</span>
  </div>`;

  const screen = () => `
${staffTopbar('timeline')}
<div class="scrollarea">
  <div class="row" style="justify-content:center;gap:2px;padding:4px 0 6px">
    <span style="color:var(--ink-3)">${ic('left', 16)}</span>
    <span class="h3" style="font-size:15px;padding:0 8px">Today</span>
    <span style="color:var(--ink-3)">${ic('right', 16)}</span>
  </div>

  <div class="stack g10" style="padding:2px 16px 0">
    ${receipt('person', '<b class="strong">Marcus Bell</b> joined on Unlimited.', '07:12')}
    ${receipt('check', '<b class="strong">Priya Raman</b> took tonight’s 18:45 cover.', '08:40')}
    ${receipt('mail', 'Newsletter went out — 61% opened.', '09:05')}
  </div>

  <div class="row g8" style="padding:13px 16px 8px">
    <span class="lbl" style="color:var(--ink)">Waiting on you</span>
    <span class="badge" style="background:var(--warn-soft);color:var(--warn)">2</span>
  </div>

  <div class="stack" style="padding:0 16px;gap:9px">
    <div class="card lift" style="padding:13px">
      <div class="row g10">
        <span style="color:var(--warn)">${ic('card', 17)}</span>
        <span class="h3 grow">Amara Nwosu's payment failed</span>
      </div>
      <div class="body" style="font-size:13.5px;margin-top:7px">
        £48 on the 3rd. Her card expired last month — she has trained four
        times since.
      </div>
      <div class="row g8" style="margin-top:13px">
        <span class="btn btn-dark btn-sm">Ask her to update it</span>
        <span class="btn btn-plain btn-sm">See the details</span>
      </div>
    </div>

    <div class="card" style="padding:13px">
      <div class="row g10">
        ${AV('je', 26)}
        <span class="h3 grow">Jonah Ellis wants to join</span>
        <span class="lbl" style="letter-spacing:.05em">11:20</span>
      </div>
      <div class="body" style="font-size:13.5px;margin-top:7px">
        From the join link. No plan picked yet — Unlimited is what most take.
      </div>
      <div class="row g8" style="margin-top:13px">
        <span class="btn btn-dark btn-sm">Approve on Unlimited</span>
        <span class="btn btn-plain btn-sm">Not yet</span>
      </div>
    </div>
  </div>

  <div class="row g8" style="padding:13px 16px 8px">
    <span class="lbl">With me</span>
    <span class="badge">1</span>
  </div>

  <div style="padding:0 16px">
    <div class="card" style="padding:13px;background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">
        ${orb(24)}
        <div class="grow">
          <div class="body" style="font-size:13.5px;color:var(--ink)">
            I've asked <b class="strong">Sam Whitlock</b> to update his card,
            and I'll chase again Friday.
          </div>
          <div class="row g6" style="margin-top:11px">
            <span class="chip chip-sm">${ic('clock', 12)}Chased 2 days ago</span>
            <span class="chip chip-sm">Hand it back to me</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="stack g8" style="padding:8px 16px 6px">
  <div class="row g6">
    <span class="chip chip-sm">${ic('doc', 12)}Your rules</span>
    <span class="chip chip-sm">${ic('people', 12)}The team</span>
    <span class="chip chip-sm">${ic('flag', 12)}Goals</span>
  </div>
  <div class="glow">
    <div class="field">
      <span class="grow trunc">Show me a member, change a class…</span>
      <span class="btn btn-dark btn-sm" style="padding:0 12px 0 8px">${orb(17)}Go</span>
    </div>
  </div>
</div>`;

  const body = `<div class="board-row">
  ${phone(screen(), { dark: true, label: 'Dark' })}
  ${phone(screen(), { label: 'Light' })}
</div>`;

  return page({
    title: 'Owner — Timeline (the day\'s work)',
    sub: 'The reference marks everything its machine does with one iridescent orb, and puts a soft pastel bloom behind the box you talk to it in. Temple\'s Timeline is exactly that surface, so it gets both: the orb is the agent\'s face on "With me" and on the send button, and it is the only colour in the chrome.',
    body,
  });
}

/* ============================================================= 07 desktop */

function deskBoard() {
  const navRow = (icon, label, { on, trail, orbIcon } = {}) => `
    <div class="navrow ${on ? 'on' : ''}">
      ${orbIcon ? orb(19) : `<span style="color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${ic(icon, 19)}</span>`}
      <span class="grow">${label}</span>
      ${trail ?? ''}
    </div>`;

  const kpi = (label, value, delta, sub) => `
    <div class="card grow" style="min-width:0">
      <span class="lbl">${label}</span>
      <div class="num" style="font-size:32px;margin-top:8px">${value}</div>
      <div class="row g6" style="margin-top:8px">
        <span class="chip chip-sm chip-ok">${delta}</span>
        <span class="small dim" style="font-size:12px">${sub}</span>
      </div>
    </div>`;

  const member = (initials, name, plan, planTone, last, tags) => `
    <div class="row g12" style="padding:12px 16px;border-bottom:1px solid var(--line)">
      ${AV(initials)}
      <div class="stack g2" style="width:200px">
        <span class="h3" style="font-size:14px">${name}</span>
        <span class="small dim" style="font-size:12.5px">${last}</span>
      </div>
      <div style="width:148px"><span class="chip chip-sm ${planTone}">${plan}</span></div>
      <div class="row g6 grow">${tags.map((t) => `<span class="chip chip-sm">${t}</span>`).join('')}</div>
      <span class="chip chip-sm">Open</span>
    </div>`;

  const inner = (dark) => `
<div class="app ${dark ? 'dark' : ''}" style="background:var(--bg);color:var(--ink)">
  <div class="deskbar"><b></b><b></b><b></b><span class="url">app.jointemple.io/management</span></div>
  <div style="display:flex;align-items:stretch;min-height:764px">

    <div style="width:246px;flex:none;background:var(--surface);border-right:1px solid var(--line);padding:16px 12px;display:flex;flex-direction:column;gap:14px">
      <div class="row between" style="padding:2px 4px 0">
        ${lockup(17, dark ? '#f4f5f6' : '#14161a')}
        <span style="color:var(--ink-3)">${ic('panel', 17)}</span>
      </div>

      <div class="card" style="padding:9px 11px;border-radius:var(--r-ctl)">
        <div class="row g10">
          <div class="gymtile">F</div>
          <div class="stack g2 grow" style="min-width:0">
            <span class="h3 trunc" style="font-size:13.5px">Forge Barbell Club</span>
            <span class="small dim trunc" style="font-size:12px">Dani Okafor · Owner</span>
          </div>
          ${ic('right', 14, 'color:var(--ink-3)')}
        </div>
      </div>

      <span class="btn btn-dark btn-full" style="height:40px;border-radius:var(--r-ctl)">${ic('plus', 16)}Create</span>

      <div class="stack g2">
        ${navRow('chat', 'Timeline', { on: true })}
        ${navRow('barbell', 'Programming')}
        ${navRow('cal', 'Classes')}
        ${navRow('grid', 'Manage')}
        ${navRow('', 'Co—Agent', { orbIcon: true })}
        ${navRow('bell', 'Notifications')}
      </div>

      <div class="stack g2" style="margin-top:4px">
        <span class="lbl" style="padding:8px 12px 4px">The gym</span>
        ${navRow('people', 'Members', { trail: '<span class="small dim" style="font-size:12.5px">214</span>' })}
        ${navRow('card', 'Billing', { trail: '<span class="small dim" style="font-size:12.5px">£14.3k</span>' })}
        ${navRow('mail', 'Communications')}
        ${navRow('gear', 'Settings')}
      </div>

      <div style="margin-top:auto">
        <div class="card" style="padding:12px;border-radius:var(--r-ctl)">
          <div class="row g10">
            ${orb(26)}
            <div class="stack g2 grow" style="min-width:0">
              <span class="h3" style="font-size:13px">Finish setting up</span>
              <span class="small dim" style="font-size:11.5px">3 of 8 left</span>
            </div>
          </div>
          <div class="bar" style="margin-top:10px"><i style="width:62%"></i></div>
        </div>
      </div>
    </div>

    <div class="grow" style="padding:22px 24px 30px;min-width:0">
      <div class="row between" style="align-items:flex-end">
        <div class="stack g4">
          <span class="h1" style="font-size:30px">Members</span>
          <span class="body">214 active · 6 joined this month · 3 lapsing</span>
        </div>
        <div class="row g8">
          <span class="chip">${ic('cal', 14)}This month</span>
          <span class="btn btn-plain btn-sm">Import</span>
          <span class="btn btn-accent btn-sm">${ic('plus', 15)}Invite</span>
        </div>
      </div>

      <div class="row g12" style="margin-top:20px">
        ${kpi('Revenue', '£14,280', '+8.2%', 'vs previous period')}
        ${kpi('Members', '214', '+3.4%', 'vs previous period')}
        ${kpi('Attendance', '62%', '+2pp', 'of members checked in')}
      </div>

      <div class="card flush" style="margin-top:18px">
        <div class="row g12" style="padding:13px 16px;border-bottom:1px solid var(--line)">
          <div class="field grow" style="min-height:36px;padding-left:14px;font-size:14px">
            ${ic('search', 15, 'color:var(--ink-3)')}<span class="grow">Search members</span>
          </div>
          <span class="chip chip-sm">All plans</span>
          <span class="chip chip-sm">All tags</span>
          <span class="chip chip-sm">${ic('doc', 12)}Export</span>
        </div>
        <div class="row g12" style="padding:9px 16px;border-bottom:1px solid var(--line)">
          <span style="width:30px"></span>
          <span class="lbl" style="width:200px">Member</span>
          <span class="lbl" style="width:148px">Plan</span>
          <span class="lbl grow">Tags</span>
        </div>
        ${member('an', 'Amara Nwosu', 'Payment failed', 'chip-bad', 'Trained 4× this week', ['Evenings', 'Metcon'])}
        ${member('mb', 'Marcus Bell', 'Unlimited', 'chip-ok', 'Joined today', ['New'])}
        ${member('pr', 'Priya Raman', 'Coach — staff', '', 'Coached 3 classes today', ['Coach'])}
        ${member('je', 'Jonah Ellis', 'Requested', 'chip-warn', 'From the join link · 11:20', ['Lead'])}
        ${member('sw', 'Sam Whitlock', '10-class pack', '', '2 credits left · last in 21 Jul', ['Lapsing'])}
      </div>
    </div>

    <div style="width:296px;flex:none;padding:22px 20px 30px;min-width:0">
      <div class="row between">
        <span class="lbl">Waiting on you</span>
        <span class="small" style="font-size:12.5px;color:var(--link)">View all</span>
      </div>
      <div class="card lift" style="margin-top:10px;padding:13px">
        <div class="row g8">
          <span style="color:var(--warn)">${ic('card', 15)}</span>
          <span class="h3 grow" style="font-size:13.5px">Payment failed</span>
        </div>
        <div class="small" style="margin-top:6px;font-size:12.5px">Amara Nwosu · £48 · 2 attempts</div>
        <div class="row g6" style="margin-top:11px">
          <span class="btn btn-dark btn-sm" style="height:30px;font-size:12.5px">Chase it</span>
          <span class="btn btn-plain btn-sm" style="height:30px;font-size:12.5px">Details</span>
        </div>
      </div>

      <div class="lbl" style="margin-top:22px">Today at the gym</div>
      <div class="stack g10" style="margin-top:10px">
        ${[
          ['06:00', 'Strength', 'Dani Okafor', '12/20', ['jm', 'ro', 'ka']],
          ['07:15', 'Metcon', 'Dani Okafor', '18/20', ['an', 'lk', 'tm']],
          ['17:30', 'Metcon', 'Priya Raman', '17/20', ['lk', 'mb', 'ro']],
          ['18:45', 'Barbell Club', 'Marcus Bell', '20/20', ['tm', 'jm', 'ka']],
        ]
          .map(
            ([t, n, c, cap, who]) => `
          <div class="row g10">
            <span class="num" style="font-size:12.5px;width:38px;color:var(--ink-2)">${t}</span>
            <div class="stack g2 grow" style="min-width:0">
              <span class="h3 trunc" style="font-size:13.5px">${n}</span>
              <span class="small dim" style="font-size:12px">${c} · ${cap}</span>
            </div>
            ${avstack(who, 20)}
          </div>`,
          )
          .join('')}
      </div>

      <div class="lbl" style="margin-top:22px">This week</div>
      <div class="stack g12" style="margin-top:10px">
        <div class="stack g2">
          <span class="h3" style="font-size:13.5px">Attendance is up 6%</span>
          <span class="small dim" style="font-size:12.5px;line-height:1.4">Evening Metcon is filling earlier than it did in July.</span>
        </div>
        <div class="stack g2">
          <span class="h3" style="font-size:13.5px">Three members are lapsing</span>
          <span class="small dim" style="font-size:12.5px;line-height:1.4">No visit in 21 days. Two are on credit packs with credits left.</span>
        </div>
      </div>
    </div>
  </div>
</div>`;

  const body = `
<div class="board-row"><div class="frame-wrap">
  <div class="frame-label">Desktop · light</div><div class="desk">${inner(false)}</div>
</div></div>
<div class="board-row" style="margin-top:34px"><div class="frame-wrap">
  <div class="frame-label">Desktop · dark</div><div class="desk">${inner(true)}</div>
</div></div>`;

  return page({
    title: 'Staff — the three-column shell',
    sub: 'The biggest structural idea worth taking. The reference runs a left sidebar (workspace switcher, one dark Create button, a nav list whose selected row is a raised white card), a working middle column, and a right rail of what is happening now. Temple\'s staff area is desktop-heavy and currently spends its whole top edge on four pills.',
    body,
  });
}

/* ======================================================== 08 before/after */

function beforeAfterBoard() {
  const legacyScreen = () => `
<div class="scrollarea">
  <div class="row g8" style="padding:10px 12px 12px">
    <div class="row g8 grow">
      <div style="width:36px;height:36px;border-radius:999px;background:#3b6ba5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">F</div>
    </div>
    <div class="lseg">
      <span>${ic('barbell', 15)}</span>
      <span class="on">${ic('cal', 15)}Book</span>
      <span>${ic('trend', 15)}</span>
    </div>
    <div class="row g8 grow" style="justify-content:flex-end">
      <span style="display:inline-flex;align-items:center;height:30px;padding:0 10px;border-radius:999px;border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.1);color:#10b981">${ic('cal', 13)}</span>
      <div style="width:30px;height:30px;border-radius:999px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#6b7280">AN</div>
    </div>
  </div>

  <div class="row" style="padding:0 10px 12px;gap:2px">
    ${[['M', 18], ['T', 19], ['W', 20], ['T', 21], ['F', 22], ['S', 23], ['S', 24]]
      .map(([d, n], i) => `<div class="ldaycell ${i === 3 ? 'on' : ''} ${i === 2 ? 'today' : ''}"><span class="d">${d}</span><span class="n">${n}</span></div>`)
      .join('')}
  </div>

  <div class="row g6 wrap" style="padding:0 12px 12px">
    <span class="lfilter" style="border-color:#3b6ba5;color:#3b6ba5;background:rgba(59,107,165,.1)">All</span>
    <span class="lfilter"><i class="dot" style="background:#e11d48"></i>Strength</span>
    <span class="lfilter"><i class="dot" style="background:#6366f1"></i>Metcon</span>
    <span class="lfilter"><i class="dot" style="background:#0f766e"></i>Open Gym</span>
  </div>

  <div class="stack g8" style="padding:0 12px 10px">
    <div class="lcard" style="padding:12px;display:flex;align-items:center;gap:12px">
      <span style="background:#3b6ba5;color:#fff;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:700">Metcon</span>
      <div class="grow">
        <div class="lmicro">Recommended</div>
        <div style="font-size:14px;font-weight:500">Thursday 21 Aug at 17:30</div>
      </div>
      <span class="lchip">Quick book</span>
    </div>
    <div class="lcard" style="padding:12px;display:flex;align-items:center;gap:12px">
      <div style="width:32px;height:32px;border-radius:8px;background:var(--l-inset);display:flex;align-items:center;justify-content:center;color:#6b7280">${ic('cal', 16)}</div>
      <div class="grow">
        <div class="lmicro">Your next class</div>
        <div style="font-size:14px;font-weight:500">Thursday 21 Aug at 18:00</div>
      </div>
      ${ic('right', 15, 'color:#9ca3af')}
    </div>
  </div>

  <div class="stack g10" style="padding:0 12px">
    ${[
      ['06:00', '60 min', 'Strength', '#e11d48', 'Dani Okafor', '8 spots left', '#059669', 'book', ''],
      ['07:15', '45 min', 'Metcon', '#6366f1', 'Dani Okafor', 'Booked in', '#059669', 'booked', 'border:1px solid #34d399'],
      ['12:00', '90 min', 'Open Gym', '#0f766e', '', '14 spots left', '#059669', 'book', ''],
      ['17:30', '45 min', 'Metcon', '#6366f1', 'Priya Raman', '3 spots left', '#d97706', 'book', 'border:1px solid #c084fc'],
      ['18:45', '60 min', 'Barbell Club', '#7c3aed', 'Marcus Bell', 'Full', '#9ca3af', 'full', ''],
    ]
      .map(
        ([t, d, n, c, coach, st, stc, kind, extra]) => `
      <div class="lcard bordered" style="display:flex;align-items:center;gap:12px;padding:14px;${extra || 'border:1px solid var(--l-line)'}">
        <div style="width:56px">
          <div style="font-size:17px;font-weight:800">${t}</div>
          <div style="font-size:11px;color:var(--l-ink3);margin-top:2px">${d}</div>
        </div>
        <div class="grow" style="min-width:0">
          <div class="row g8">
            <i class="dot" style="background:${c}"></i>
            <span style="font-size:14.5px;font-weight:600" class="trunc">${n}</span>
          </div>
          <div style="margin-top:4px;font-size:12px;color:var(--l-ink2)">
            ${coach ? `with ${coach} · ` : ''}<span style="color:${stc};font-weight:600">${st}</span>
          </div>
        </div>
        ${
          kind === 'booked'
            ? `<span style="display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:6px 12px;background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;font-size:11px;font-weight:700">${ic('check', 13)}Booked</span>`
            : kind === 'full'
              ? `<span style="border-radius:999px;padding:8px 16px;background:var(--l-inset);color:var(--l-ink2);font-size:11px;font-weight:700">Waitlist</span>`
              : `<span class="lpill">Book</span>`
        }
      </div>`,
      )
      .join('')}
  </div>
</div>`;

  const newScreen = () => `
${topbar('book')}
<div class="scrollarea">
  ${dayStrip(3)}
  ${filterRow()}
  <div style="padding:0 16px 14px">
    <div class="card" style="padding:13px 14px">
      <div class="row g10">
        <div class="stack g2 grow" style="min-width:0">
          <span class="lbl">Your next class</span>
          <span class="h3" style="margin-top:3px;font-size:16px">Thu 21 Aug at 18:00</span>
        </div>
        <span class="chip chip-sm"><i class="dot" style="background:#6366f1"></i>Metcon</span>
        ${ic('right', 15, 'color:var(--ink-3)')}
      </div>
    </div>
  </div>
  <div class="row between" style="padding:0 16px 10px">
    <span class="lbl">Thursday 21 August</span>
    <span class="small dim" style="font-size:12.5px">5 classes</span>
  </div>
  ${agendaRow({ time: '06:00', dur: '60 min', name: 'Strength', colour: '#e11d48', coach: 'Dani Okafor', status: '8 spots left', tone: 'ok', who: ['jm', 'ro', 'ka'] })}
  ${agendaRow({ time: '07:15', dur: '45 min', name: 'Metcon', colour: '#6366f1', coach: 'Dani Okafor', status: 'You are in', tone: 'ok', action: 'booked', who: ['an', 'lk', 'tm', 'bh'] })}
  ${agendaRow({ time: '12:00', dur: '90 min', name: 'Open Gym', colour: '#0f766e', coach: null, status: '14 spots left', tone: 'ok', who: ['sw'] })}
  ${agendaRow({ time: '17:30', dur: '45 min', name: 'Metcon', colour: '#6366f1', coach: 'Priya Raman', status: '3 spots left', tone: 'warn', rec: true, who: ['lk', 'mb', 'ro'] })}
  ${agendaRow({ time: '18:45', dur: '60 min', name: 'Barbell Club', colour: '#7c3aed', coach: 'Marcus Bell', status: 'Full — 2 waiting', tone: 'dim', action: 'waitlist', who: ['tm', 'jm', 'ka', 'bh'] })}
</div>`;

  const body = `<div class="board-row">
  ${phone(legacyScreen(), { legacy: true, label: 'Today' })}
  ${phone(newScreen(), { label: 'Proposed' })}
  ${phone(legacyScreen(), { legacy: true, dark: true, label: 'Today · dark' })}
  ${phone(newScreen(), { dark: true, label: 'Proposed · dark' })}
</div>`;

  return page({
    extraCss: '.board-row{flex-wrap:nowrap}body.board{width:max-content;min-width:100%}.board-head{max-width:none}',
    title: 'Before / after — member Book',
    sub: 'Same data, same routes. Cool slate becomes cool white, shadows become hairlines, the brand blue stops filling the day pill and the Book button and the filter chip all at once, and every row gains the faces of the people already in the class.',
    body,
  });
}

/* ------------------------------------------------------------------ emit */

const PAGES = [
  ['01-identity.html', identityBoard()],
  ['02-type-controls.html', typeBoard()],
  ['03-landing.html', landingBoard()],
  ['04-member-book.html', bookBoard()],
  ['05-member-track.html', trackBoard()],
  ['06-owner-timeline.html', timelineBoard()],
  ['07-staff-desktop.html', deskBoard()],
  ['08-before-after.html', beforeAfterBoard()],
];

for (const [name, html] of PAGES) {
  writeFileSync(join(HERE, name), html);
  console.log('wrote', name);
}
