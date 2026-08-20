// Builds the "Paper & Ink" mockup boards (Contra + Luma inspired) as static
// HTML, which shot.mjs then screenshots. Run: node build.mjs && node shot.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ icons */

const ICONS = {
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  barbell: '<path d="M4 9v6M7 6.5v11M17 6.5v11M20 9v6M7 12h10"/>',
  trend: '<path d="M3 16.5l6-6 4 4 7.5-7.5"/><path d="M14.5 7h6v6"/>',
  ticket:
    '<rect x="3" y="6.5" width="18" height="11" rx="2.6"/><path d="M9 6.5v1.6M9 11.2v1.6M9 15.9v1.6"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  bolt: '<path d="M13.2 2.5L4.8 13.6H11l-.8 7.9 8.9-11.1H13z"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19"/>',
  people:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.2 19.5a5.8 5.8 0 0 1 11.6 0"/><path d="M16.2 5.4a3.2 3.2 0 0 1 0 5.9"/><path d="M17.4 14.6a5.8 5.8 0 0 1 3.4 4.9"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 5h11l-2 3.6 2 3.6h-11z"/>',
  doc: '<path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18"/><path d="M9 12.5h6M9 16h4"/>',
  up: '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/>',
  swap: '<path d="M3.5 8.5H17"/><path d="M13.5 5L17 8.5 13.5 12"/><path d="M20.5 15.5H7"/><path d="M10.5 12L7 15.5 10.5 19"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.2 2"/>',
  alert: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.5v5.2M12 16.2v.3"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8L20.5 20.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.6l1.5 2.5 2.9-.5.6 2.9 2.7 1.2-1.4 2.6 1.4 2.6-2.7 1.2-.6 2.9-2.9-.5L12 21.4l-1.5-2.5-2.9.5-.6-2.9-2.7-1.2L5.7 12 4.3 9.4l2.7-1.2.6-2.9 2.9.5z"/>',
  chat: '<path d="M20 14.8a3 3 0 0 1-3 3H9.4L5 21v-3.6a3 3 0 0 1-1-2.6V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>',
  trophy:
    '<path d="M8 4h8v4.6a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.4A2.6 2.6 0 0 0 8 10.6M16 5.5h2.6A2.6 2.6 0 0 1 16 10.6"/><path d="M12 12.6v3.2M8.8 20h6.4l-.6-4H9.4z"/>',
  book: '<path d="M5 5.2A2.2 2.2 0 0 1 7.2 3H19v14.4H7.2A2.2 2.2 0 0 0 5 19.6z"/><path d="M5 19.6A1.6 1.6 0 0 1 6.6 18H19v3H6.6A1.6 1.6 0 0 1 5 19.6z"/>',
  body: '<circle cx="12" cy="4.4" r="2"/><path d="M12 7v7.2M12 7.6L7.2 9.4M12 7.6l4.8 1.8M12 14.2L9 20.4M12 14.2l3 6.2"/>',
  library: '<path d="M4 5h3.6v14H4zM9.6 5h3.6v14H9.6z"/><path d="M16.4 5.6l3.3 12.8-2.2.6-3.3-12.8z"/>',
  flame: '<path d="M12 3.2s5 3.9 5 8.1a5 5 0 0 1-10 0c0-2 1-3.2 1-3.2s.4 2 1.9 2c0-3 2.1-4.8 2.1-6.9z"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="M3.8 7l8.2 6 8.2-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  users2: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  pin: '<path d="M12 21s6.5-6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21z"/><circle cx="12" cy="10.3" r="2.4"/>',
};

function sprite() {
  const syms = Object.entries(ICONS)
    .map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`)
    .join('');
  return `<svg style="position:absolute;width:0;height:0" aria-hidden="true">${syms}</svg>`;
}

const ic = (name, size = 16, style = '') =>
  `<svg class="i" style="width:${size}px;height:${size}px;flex:none;${style}"><use href="#i-${name}"/></svg>`;

const icf = (name, size = 16, style = '') =>
  `<svg class="i i-fill" style="width:${size}px;height:${size}px;flex:none;${style}"><use href="#i-${name}"/></svg>`;

/* ------------------------------------------------------------------ marks */

const MARK = {
  portico: (fg, bg) => `
    <rect width="48" height="48" rx="13" fill="${bg}"/>
    <rect x="9.4" y="11.6" width="29.2" height="5.2" rx="2.6" fill="${fg}"/>
    <rect x="11.4" y="20.2" width="5.2" height="16.2" rx="2.6" fill="${fg}"/>
    <rect x="21.4" y="20.2" width="5.2" height="16.2" rx="2.6" fill="${fg}"/>
    <rect x="31.4" y="20.2" width="5.2" height="16.2" rx="2.6" fill="${fg}"/>`,
  arch: (fg, bg) => `
    <rect width="48" height="48" rx="13" fill="${bg}"/>
    <path d="M13.6 36.4V23.8a10.4 10.4 0 0 1 20.8 0v12.6" fill="none"
      stroke="${fg}" stroke-width="5.2" stroke-linecap="round"/>`,
  monogram: (fg, bg) => `
    <rect width="48" height="48" rx="13" fill="${bg}"/>
    <rect x="10.4" y="11.6" width="27.2" height="5.4" rx="2.7" fill="${fg}"/>
    <rect x="21.3" y="16.4" width="5.4" height="20" rx="2.7" fill="${fg}"/>`,
  pediment: (fg, bg) => `
    <rect width="48" height="48" rx="13" fill="${bg}"/>
    <path d="M10.4 15.6 24 8.6l13.6 7z" fill="${fg}"/>
    <rect x="12.6" y="19.4" width="4.8" height="13.2" rx="2.4" fill="${fg}"/>
    <rect x="21.6" y="19.4" width="4.8" height="13.2" rx="2.4" fill="${fg}"/>
    <rect x="30.6" y="19.4" width="4.8" height="13.2" rx="2.4" fill="${fg}"/>
    <rect x="9.6" y="35" width="28.8" height="4.4" rx="2.2" fill="${fg}"/>`,
  stack: (fg, bg, accent) => `
    <rect x="9" y="5" width="34" height="34" rx="10" fill="${accent}"/>
    <rect x="5" y="9" width="34" height="34" rx="10" fill="${bg}" stroke="${accent}" stroke-width="0"/>
    <rect x="11.4" y="15.4" width="21.2" height="4.2" rx="2.1" fill="${fg}"/>
    <rect x="11.9" y="22" width="4.2" height="12.6" rx="2.1" fill="${fg}"/>
    <rect x="19.9" y="22" width="4.2" height="12.6" rx="2.1" fill="${fg}"/>
    <rect x="27.9" y="22" width="4.2" height="12.6" rx="2.1" fill="${fg}"/>`,
};

const mark = (kind, size, fg, bg, accent = '#e8b620') =>
  `<svg viewBox="0 0 48 48" width="${size}" height="${size}" style="flex:none;display:block">${MARK[kind](fg, bg, accent)}</svg>`;

const wordmark = (size, color, weight = 700, stretch = 125, ls = 0.06) =>
  `<span style="font-family:Archivo;font-weight:${weight};font-stretch:${stretch}%;font-size:${size}px;letter-spacing:${ls}em;color:${color};line-height:1">TEMPLE</span>`;

/* ------------------------------------------------------- page scaffolding */

function page({ title, sub, body, extraCss = '' }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="fonts.css">
<link rel="stylesheet" href="system.css">
<link rel="stylesheet" href="legacy.css">
<style>${extraCss}</style>
</head>
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
  <span class="num" style="font-size:14px">9:41</span>
  <span class="row g5" style="gap:5px;opacity:.85">
    <svg style="width:17px;height:11px" viewBox="0 0 17 11"><g fill="currentColor">
      <rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.3" y="5" width="3" height="6" rx="1"/>
      <rect x="8.6" y="2.6" width="3" height="8.4" rx="1"/><rect x="12.9" y="0" width="3" height="11" rx="1"/>
    </g></svg>
    <svg style="width:15px;height:11px" viewBox="0 0 15 11"><path d="M7.5 9.4l2-2a2.9 2.9 0 0 0-4 0zM3.6 5.5a5.6 5.6 0 0 1 7.8 0l1.5-1.6a7.8 7.8 0 0 0-10.8 0z" fill="currentColor"/></svg>
    <svg style="width:24px;height:11px" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="19" height="10" rx="3" fill="none" stroke="currentColor" stroke-opacity=".4"/><rect x="2" y="2" width="15" height="7" rx="1.6" fill="currentColor"/><path d="M21 3.6v3.8a2 2 0 0 0 0-3.8z" fill="currentColor" fill-opacity=".5"/></svg>
  </span>
</div>`;

const homebar = () => `<div class="homebar"><span></span></div>`;

const phone = (inner, { dark = false, label = '', legacy = false } = {}) => `
<div class="frame-wrap">
  ${label ? `<div class="frame-label">${label}</div>` : ''}
  <div class="frame">
    <div class="screen ${legacy ? 'legacy' : 'app'} ${dark ? 'dark' : ''}"
         style="background:var(${legacy ? '--l-bg' : '--paper'});color:var(${legacy ? '--l-ink' : '--ink'})">
      ${statusbar()}
      ${inner}
      ${homebar()}
    </div>
  </div>
</div>`;

/* -------------------------------------------------------------- app parts */

const AV = (initials) => `<div class="avatar">${initials}</div>`;

const topbar = (active) => `
<div class="topbar">
  <div class="row g8 grow" style="min-width:0">
    <div class="gymtile">F</div>
  </div>
  <div class="seg">
    <span class="${active === 'programming' ? 'on' : ''}">${ic('barbell', 15)}${active === 'programming' ? 'Programming' : ''}</span>
    <span class="${active === 'book' ? 'on' : ''}">${ic('cal', 15)}${active === 'book' ? 'Book' : ''}</span>
    <span class="${active === 'track' ? 'on' : ''}">${ic('trend', 15)}${active === 'track' ? 'Track' : ''}</span>
  </div>
  <div class="row g8 grow" style="justify-content:flex-end">
    ${AV('AN')}
  </div>
</div>`;

const staffTopbar = (active) => `
<div class="topbar">
  <div class="row g8 grow" style="min-width:0">
    <div class="gymtile">F</div>
  </div>
  <div class="seg">
    <span class="${active === 'timeline' ? 'on' : ''}">${ic('chat', 15)}${active === 'timeline' ? 'Timeline' : ''}</span>
    <span class="${active === 'programming' ? 'on' : ''}">${ic('barbell', 15)}${active === 'programming' ? 'Programming' : ''}</span>
    <span class="${active === 'classes' ? 'on' : ''}">${ic('cal', 15)}${active === 'classes' ? 'Classes' : ''}</span>
    <span class="${active === 'manage' ? 'on' : ''}">${ic('gear', 15)}${active === 'manage' ? 'Manage' : ''}</span>
  </div>
  <div class="row g8 grow" style="justify-content:flex-end">
    <span class="chip" style="height:26px;padding:0 9px;font-size:11px;gap:5px">${ic('swap', 13)}Staff</span>
    ${AV('DO')}
  </div>
</div>`;

const dayStrip = (sel = 3) => {
  const days = [
    ['M', 18], ['T', 19], ['W', 20], ['T', 21], ['F', 22], ['S', 23], ['S', 24],
  ];
  return `<div class="row" style="gap:4px;padding:2px 12px 10px">
    ${days
      .map(
        ([d, n], i) =>
          `<div class="daycell ${i === sel ? 'on' : ''} ${i === 2 ? 'today' : ''}"><span class="d">${d}</span><span class="n">${n}</span></div>`,
      )
      .join('')}
  </div>`;
};

const filterRow = () => `
<div class="row g6 wrap" style="padding:0 16px 12px">
  <span class="chip chip-ink">All</span>
  <span class="chip"><i class="dot" style="background:#c2410c"></i>Strength</span>
  <span class="chip"><i class="dot" style="background:#3b6ba5"></i>Metcon</span>
  <span class="chip"><i class="dot" style="background:#2f7a4f"></i>Open Gym</span>
</div>`;

function agendaRow({ time, dur, name, colour, coach, status, statusTone, action, on, rec, booked }) {
  const statusClass =
    statusTone === 'ok' ? 'style="color:var(--ok)"'
    : statusTone === 'warn' ? 'style="color:var(--warn)"'
    : 'style="color:var(--ink-3)"';
  const btn = booked
    ? `<span class="chip chip-ok">${ic('check', 13)}Booked</span>`
    : action === 'Waitlist'
      ? `<span class="chip">Waitlist</span>`
      : `<span class="btn btn-ink btn-sm">Book</span>`;
  return `
<div class="spine">
  <div class="spine-gutter">
    <div class="num" style="font-size:15px">${time}</div>
    <div class="micro" style="letter-spacing:.08em;margin-top:1px">${dur}</div>
  </div>
  <div class="spine-rail"><div class="spine-node ${on ? 'on' : ''}"></div></div>
  <div class="grow" style="padding-bottom:10px">
    <div class="card" style="padding:12px 13px;${rec ? 'border-color:var(--accent)' : ''}">
      <div class="row g8">
        <i class="dot" style="background:${colour}"></i>
        <span class="h3 trunc grow">${name}</span>
        ${rec ? `<span class="chip chip-accent" style="height:20px;padding:0 7px;font-size:10px;gap:3px">${icf('spark', 10)}For you</span>` : ''}
        ${btn}
      </div>
      <div class="small trunc" style="margin-top:7px;font-size:12.5px">
        ${coach ? `with ${coach} <span class="dim">·</span> ` : ''}<b ${statusClass}>${status}</b>
      </div>
    </div>
  </div>
</div>`;
}

/* ============================================================ 01 identity */

function identityBoard() {
  const swatch = (name, hex, note) => `
    <div class="stack g8" style="width:126px">
      <div style="height:64px;border-radius:12px;background:${hex};border:1px solid var(--line)"></div>
      <div class="stack g2">
        <span class="h3" style="font-size:13px">${name}</span>
        <span class="micro" style="letter-spacing:.08em">${hex}</span>
        <span class="small" style="font-size:11.5px;line-height:1.35">${note}</span>
      </div>
    </div>`;

  const direction = (kind, name, blurb, recommended) => `
  <div class="card" style="width:205px;padding:14px;${recommended ? 'border-color:var(--ink);border-width:1.5px' : ''}">
    <div class="row between" style="height:22px">
      <span class="micro">${recommended ? 'Recommended' : 'Alternative'}</span>
      ${recommended ? `<span class="chip chip-ink" style="height:20px;padding:0 8px;font-size:9.5px">Pick this</span>` : ''}
    </div>
    <div class="row g12" style="margin-top:14px;align-items:flex-end">
      ${mark(kind, 66, '#f3f1ec', '#17150f')}
      <div class="stack g6">
        ${mark(kind, 30, '#f3f1ec', '#17150f')}
        ${mark(kind, 18, '#f3f1ec', '#17150f')}
      </div>
    </div>
    <div class="row g8" style="margin-top:12px">
      ${mark(kind, 34, '#17150f', '#f3f1ec')}
      ${mark(kind, 34, '#f3f1ec', '#3b6ba5')}
      ${mark(kind, 34, '#17150f', '#e8b620')}
    </div>
    <div class="h2" style="margin-top:14px;font-size:16px">${name}</div>
    <div class="small" style="margin-top:5px;font-size:12px;line-height:1.4">${blurb}</div>
  </div>`;

  const body = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="row between" style="align-items:flex-start">
    <div class="stack g6">
      <span class="micro">The lockup</span>
      <div class="row g14" style="align-items:center;margin-top:6px">
        ${mark('portico', 54, '#f3f1ec', '#17150f')}
        <div class="stack" style="gap:3px">
          ${wordmark(34, '#17150f')}
          <span style="font-family:Archivo;font-weight:500;font-stretch:125%;font-size:10px;letter-spacing:.34em;color:#8b8578">TECHNOLOGY</span>
        </div>
      </div>
    </div>
    <div style="background:#0c0b0a;border-radius:16px;padding:22px 26px">
      <div class="row g14" style="align-items:center">
        ${mark('portico', 54, '#0c0b0a', '#f4f2ed')}
        <div class="stack" style="gap:3px">
          ${wordmark(34, '#f4f2ed')}
          <span style="font-family:Archivo;font-weight:500;font-stretch:125%;font-size:10px;letter-spacing:.34em;color:#79736a">TECHNOLOGY</span>
        </div>
      </div>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <div class="micro">Mark directions</div>
  <div class="row wrap" style="margin-top:14px;align-items:stretch;gap:14px">
    ${direction('portico', 'Portico', 'Three columns under a lintel. Says "temple" without a word, survives 16px, reads as one confident tile instead of a stack of three.', true)}
    ${direction('pediment', 'Pediment', 'The full facade — roof, columns, plinth. The most literal and the best at large sizes; muddiest at favicon scale.', false)}
    ${direction('arch', 'Arch', 'The doorway, monoline. Softest of the five and the most distinctive large — reads as a letter n small.', false)}
    ${direction('monogram', 'Monogram T', 'A lintel and a column: the letter and the building at once. Safest, least ownable.', false)}
    ${direction('stack', 'Stack (evolved)', 'Today’s three offset cards flattened to two, gold behind ink. Keeps continuity — carries the most visual debt.', false)}
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <div class="row g32" style="align-items:flex-start">
    <div class="stack g14" style="flex:1">
      <span class="micro">Applied — app icon, avatar, favicon</span>
      <div class="row g16" style="align-items:flex-end">
        <div class="stack g8" style="align-items:center">
          ${mark('portico', 108, '#f4f2ed', '#17150f')}
          <span class="micro" style="letter-spacing:.08em">1024 · iOS</span>
        </div>
        <div class="stack g8" style="align-items:center">
          ${mark('portico', 60, '#17150f', '#e8b620')}
          <span class="micro" style="letter-spacing:.08em">180 · alt</span>
        </div>
        <div class="stack g8" style="align-items:center">
          ${mark('portico', 32, '#f4f2ed', '#3b6ba5')}
          <span class="micro" style="letter-spacing:.08em">32</span>
        </div>
        <div class="stack g8" style="align-items:center">
          ${mark('portico', 16, '#f4f2ed', '#17150f')}
          <span class="micro" style="letter-spacing:.08em">16</span>
        </div>
      </div>
      <div class="small" style="max-width:420px">
        One mark, two fills. The colour trio (gold, steel, ink) stops being
        three stacked cards and becomes three <em>backgrounds</em> the single
        mark sits on — so the logo still holds the palette without needing
        three layers to do it.
      </div>
    </div>

    <div class="stack g14" style="flex:1">
      <span class="micro">Wordmark</span>
      <div class="card" style="padding:20px">
        <div class="stack g16">
          <div class="stack g4">
            ${wordmark(38, '#17150f')}
            <span class="small" style="font-size:12px">Archivo 700 · width 125 · tracking +0.06em — the lintel. Used for the logo only.</span>
          </div>
          <div class="rule"></div>
          <div class="stack g4">
            <span style="font-family:Archivo;font-weight:700;font-size:38px;letter-spacing:-.035em;color:#17150f;line-height:1">Temple</span>
            <span class="small" style="font-size:12px">Archivo 700 · width 100 · tracking −0.035em — the same family tight, for headings.</span>
          </div>
        </div>
      </div>
      <div class="small" style="max-width:420px">
        Clear space stays one column-width all round. The mark never
        recolours to a gym's brand colour — inside a gym the gym's own logo
        leads and Temple sits small in the footer.
      </div>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <div class="micro">Palette — unchanged brand colours, warmer neutrals</div>
  <div class="row g16 wrap" style="margin-top:14px">
    ${swatch('Ink', '#17150F', 'Text, the mark, primary buttons')}
    ${swatch('Paper', '#F3F1EC', 'App ground (was slate #F1F5F9)')}
    ${swatch('Surface', '#FFFFFF', 'Cards, on a hairline not a shadow')}
    ${swatch('Line', '#E3DED2', 'Every border in the product')}
    ${swatch('Steel', '#3B6BA5', 'Brand accent — kept')}
    ${swatch('Gold', '#E8B620', 'Brand accent — kept')}
    ${swatch('Gym accent', '#C2410C', 'Per-gym, runtime — example')}
  </div>
</div>`;

  return page({
    title: 'Temple identity — mark, lockup, palette',
    sub: 'Five directions for the mark, the lockup on both grounds, and the neutral ramp the app would move onto. The brand blue and gold survive unchanged; what changes is that they stop being structural (three stacked cards) and become grounds the single mark sits on.',
    body,
  });
}

/* ================================================================ 02 type */

function typeBoard() {
  const specimen = (name, css, note, rec) => `
  <div class="card" style="flex:1;min-width:330px;padding:20px;${rec ? 'border-color:var(--ink);border-width:1.5px' : ''}">
    <div class="row between">
      <span class="micro">${rec ? 'Recommended' : 'Alternative'}</span>
      <span class="chip" style="height:22px;padding:0 9px;font-size:10.5px">${name}</span>
    </div>
    <div style="${css};font-size:40px;line-height:1.05;margin-top:16px">Book a class</div>
    <div style="${css};font-size:19px;line-height:1.25;margin-top:12px;opacity:.85">Thursday 21 August · 18:00</div>
    <div style="${css};font-size:33px;line-height:1.1;margin-top:12px;opacity:.35">Rag&amp;Q1 · 07:15</div>
    <div style="font-family:'Inter Tight';font-size:14px;line-height:1.45;color:var(--ink-2);margin-top:12px">
      ${note}
    </div>
  </div>`;

  const scaleRow = (label, css, spec) => `
    <div class="row g16" style="align-items:baseline;padding:11px 0;border-bottom:1px solid var(--line-soft)">
      <span class="micro" style="width:96px;flex:none">${label}</span>
      <span style="${css};flex:1">The whiteboard, the front desk, the books</span>
      <span class="small" style="font-size:11.5px;width:210px;flex:none;text-align:right">${spec}</span>
    </div>`;

  const body = `
<div class="app" style="max-family:0;max-width:1180px;margin:0 auto;background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="micro">Three typographic directions</div>
  <div class="row g16 wrap" style="margin-top:14px;align-items:stretch">
    ${specimen(
      'Archivo + Inter Tight',
      "font-family:Archivo;font-weight:700;letter-spacing:-.035em;color:var(--ink)",
      'Sturdy grotesque for anything that carries weight; Inter Tight for the dense UI underneath. Closest to Contra: confident, tight, quiet about it. Both variable, both free.',
      true,
    )}
    ${specimen(
      'Instrument Sans',
      "font-family:'Instrument Sans';font-weight:600;letter-spacing:-.025em;color:var(--ink)",
      'One family for everything, the Luma move. Lighter on its feet and simpler to ship — gives up some of the monumentality the name Temple invites.',
      false,
    )}
    ${specimen(
      'Bricolage + Geist',
      "font-family:'Bricolage Grotesque';font-weight:700;letter-spacing:-.02em;color:var(--ink)",
      'The most opinionated. Real personality in the display cut, but it dates faster and fights a gym owner who wants their own brand to be the loud thing on screen.',
      false,
    )}
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <div class="micro">The scale — Archivo for display, Inter Tight from 16px down</div>
  <div style="margin-top:10px">
    ${scaleRow('Display', "font-family:Archivo;font-weight:700;font-size:34px;letter-spacing:-.035em", 'Archivo 700 · 34/35 · −0.035em')}
    ${scaleRow('Page title', "font-family:Archivo;font-weight:700;font-size:27px;letter-spacing:-.03em", 'Archivo 700 · 27/30 · −0.03em')}
    ${scaleRow('Card title', "font-family:Archivo;font-weight:700;font-size:19px;letter-spacing:-.02em", 'Archivo 700 · 19/23 · −0.02em')}
    ${scaleRow('Row title', "font-family:'Inter Tight';font-weight:600;font-size:15.5px;letter-spacing:-.012em", 'Inter Tight 600 · 15.5/20')}
    ${scaleRow('Body', "font-family:'Inter Tight';font-weight:400;font-size:14.5px;color:var(--ink-2)", 'Inter Tight 400 · 14.5/21')}
    ${scaleRow('Meta', "font-family:'Inter Tight';font-weight:400;font-size:13px;color:var(--ink-2)", 'Inter Tight 400 · 13/18')}
    <div class="row g16" style="align-items:baseline;padding:11px 0">
      <span class="micro" style="width:96px;flex:none">Label</span>
      <span class="micro" style="flex:1;font-size:10px">The whiteboard, the front desk, the books</span>
      <span class="small" style="font-size:11.5px;width:210px;flex:none;text-align:right">Inter Tight 600 · 10px · +0.15em · caps</span>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <div class="row g32" style="align-items:flex-start">
    <div class="stack g14" style="flex:1">
      <span class="micro">Controls</span>
      <div class="card">
        <div class="row g10 wrap">
          <span class="btn btn-ink">Book</span>
          <span class="btn btn-accent">Record</span>
          <span class="btn btn-outline">Cancel</span>
          <span class="btn btn-quiet">Waitlist</span>
        </div>
        <div class="row g8 wrap" style="margin-top:16px">
          <span class="chip chip-ink">All</span>
          <span class="chip">${ic('doc', 13)}Your rules</span>
          <span class="chip chip-ok">${ic('check', 13)}Booked</span>
          <span class="chip chip-warn">3 spots left</span>
          <span class="chip chip-bad">Payment failed</span>
          <span class="chip chip-accent">${icf('spark', 12)}For you</span>
        </div>
        <div class="row g10" style="margin-top:16px">
          <div class="seg">
            <span class="on">${ic('cal', 15)}Book</span>
            <span>${ic('barbell', 15)}Programming</span>
            <span>${ic('trend', 15)}Track</span>
          </div>
        </div>
        <div class="field" style="margin-top:16px">
          <span class="grow">Show me a member, change a class…</span>
          <span class="btn btn-accent" style="width:34px;height:34px;padding:0;border-radius:999px">${ic('up', 16)}</span>
        </div>
      </div>
    </div>

    <div class="stack g14" style="flex:1">
      <span class="micro">The same components in dark</span>
      <div class="app dark" style="background:var(--paper);border-radius:20px;padding:16px;border:1px solid rgba(0,0,0,.4)">
        <div class="card">
          <div class="row g10 wrap">
            <span class="btn btn-ink" style="background:var(--ink);color:var(--paper)">Book</span>
            <span class="btn btn-accent">Record</span>
            <span class="btn btn-outline">Cancel</span>
            <span class="btn btn-quiet">Waitlist</span>
          </div>
          <div class="row g8 wrap" style="margin-top:16px">
            <span class="chip chip-ink">All</span>
            <span class="chip">${ic('doc', 13)}Your rules</span>
            <span class="chip chip-ok">${ic('check', 13)}Booked</span>
            <span class="chip chip-warn">3 spots left</span>
            <span class="chip chip-bad">Payment failed</span>
            <span class="chip chip-accent">${icf('spark', 12)}For you</span>
          </div>
          <div class="row g10" style="margin-top:16px">
            <div class="seg">
              <span class="on">${ic('cal', 15)}Book</span>
              <span>${ic('barbell', 15)}Programming</span>
              <span>${ic('trend', 15)}Track</span>
            </div>
          </div>
          <div class="field" style="margin-top:16px">
            <span class="grow">Show me a member, change a class…</span>
            <span class="btn btn-accent" style="width:34px;height:34px;padding:0;border-radius:999px">${ic('up', 16)}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>

  <div class="micro">One system, five gyms — the accent is the only thing that moves</div>
  <div class="row g12 wrap" style="margin-top:14px">
    ${[
      ['#c2410c', 'Forge Barbell Club'],
      ['#3b6ba5', 'Southbank S&amp;C'],
      ['#2f7a4f', 'Grove Athletic'],
      ['#7c3aed', 'Nightshift Fitness'],
      ['#0f766e', 'Harbour CrossFit'],
    ]
      .map(
        ([c, n]) => `
      <div class="card" style="flex:1;min-width:196px;padding:14px">
        <div class="row g10">
          <div class="gymtile" style="background:${c};color:#fff">${n[0]}</div>
          <div class="stack g2 grow" style="min-width:0">
            <span class="h3 trunc" style="font-size:13.5px">${n}</span>
            <span class="micro" style="letter-spacing:.08em">${c.toUpperCase()}</span>
          </div>
        </div>
        <div class="row g6" style="margin-top:12px">
          <span class="btn btn-sm" style="background:${c};color:#fff">Book</span>
          <span class="chip" style="border-color:${c}33;background:${c}1a;color:${c}">Strength</span>
        </div>
      </div>`,
      )
      .join('')}
  </div>
</div>`;

  return page({
    title: 'Type, controls, and the per-gym accent',
    sub: 'The typographic choice, the scale it produces, and the component set rebuilt on hairlines instead of shadows. Every gym still gets its own colour — it just stops washing across whole surfaces and lands on the one thing you are meant to press.',
    body,
  });
}

/* ============================================================= 03 landing */

function landingBoard() {
  const deck = (dark) => {
    const inkCard = dark ? '#f4f2ed' : '#17150f';
    const inkText = dark ? '#0c0b0a' : '#f3f1ec';
    return `
    <div style="position:relative;height:414px">
      <div style="position:absolute;left:22px;right:0;top:24px;bottom:0;border-radius:20px;background:${dark ? '#241d10' : '#f6e9c2'};border:1px solid ${dark ? '#3a2f18' : '#ecdcae'}"></div>
      <div style="position:absolute;left:11px;right:11px;top:12px;bottom:12px;border-radius:20px;background:${dark ? '#16212e' : '#e3ebf5'};border:1px solid ${dark ? '#22374f' : '#cfdcec'}"></div>
      <div style="position:absolute;left:0;right:22px;top:0;bottom:24px;border-radius:20px;background:${inkCard};color:${inkText};padding:22px">
        <div class="row between">
          <span style="font-size:10px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;opacity:.55">Owner</span>
          <span style="width:26px;height:26px;border-radius:999px;border:1px solid currentColor;opacity:.4;display:flex;align-items:center;justify-content:center">${ic('right', 13)}</span>
        </div>
        <div style="font-family:Archivo;font-weight:700;font-size:28px;letter-spacing:-.035em;line-height:1.05;margin-top:12px">
          The whiteboard,<br>the front desk,<br>the books — one app.
        </div>
        <div class="stack g8" style="margin-top:16px;font-size:13px;line-height:1.35;opacity:.82">
          <div class="row g8">${ic('check', 14, 'opacity:.7;margin-top:2px')}<span>Programming, schedules and bookings on one calendar</span></div>
          <div class="row g8">${ic('check', 14, 'opacity:.7;margin-top:2px')}<span>Members, plans and comms in one place</span></div>
          <div class="row g8">${ic('check', 14, 'opacity:.7;margin-top:2px')}<span>A public join link the moment you're ready</span></div>
          <div class="row g8">${ic('check', 14, 'opacity:.7;margin-top:2px')}<span>Insights that tell you what's working</span></div>
          <div class="row g8">${ic('check', 14, 'opacity:.7;margin-top:2px')}<span>Make it look like your gym, not a template</span></div>
        </div>
        <div style="position:absolute;left:22px;right:22px;bottom:22px">
          <span class="btn btn-full" style="background:${inkText};color:${inkCard}">Get set up</span>
        </div>
      </div>
    </div>`;
  };

  const screen = (dark) => `
<div class="scrollarea">
  <div class="row between" style="padding:6px 18px 0">
    <div class="row g10">
      ${mark('portico', 30, dark ? '#0c0b0a' : '#f3f1ec', dark ? '#f4f2ed' : '#17150f')}
      ${wordmark(17, dark ? '#f4f2ed' : '#17150f')}
    </div>
    <span class="chip" style="height:30px;width:30px;padding:0;justify-content:center">${ic(dark ? 'sun' : 'moon', 15)}</span>
  </div>

  <div style="padding:26px 18px 16px">
    <div class="display" style="font-size:34px">Welcome to Temple</div>
    <div class="body" style="margin-top:10px;font-size:14px;max-width:300px">
      Pick how you'll use it — swipe through, you can always switch later.
    </div>
  </div>

  <div style="padding:0 18px">${deck(dark)}</div>

  <div class="row g10" style="justify-content:center;padding:20px 0 0">
    <span class="chip" style="height:28px;width:28px;padding:0;justify-content:center">${ic('left', 13)}</span>
    <span class="row g6">
      <i class="dot" style="width:8px;height:8px;background:var(--ink)"></i>
      <i class="dot" style="background:var(--line)"></i>
      <i class="dot" style="background:var(--line)"></i>
    </span>
    <span class="chip" style="height:28px;width:28px;padding:0;justify-content:center">${ic('right', 13)}</span>
  </div>

  <div class="stack g8" style="align-items:center;padding:20px 18px 0">
    <span class="h3" style="font-size:14px;text-decoration:underline;text-underline-offset:3px">Already have an account? Sign in</span>
    <span class="small dim" style="font-size:11px;text-align:center;line-height:1.4;max-width:290px">
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
    sub: 'The one surface Temple\'s own identity owns. The three-path deck stays (it is the logo, animated) but the gradients, drop shadows and coloured borders go: flat ink, steel and gold cards on paper, one pill CTA per card, and the display face doing the persuading instead of a stack of bullet icons.',
    body,
  });
}

/* ============================================================ 04 book */

function bookBoard() {
  const screen = () => `
${topbar('book')}
<div class="scrollarea">
  ${dayStrip(3)}
  ${filterRow()}
  <div style="padding:0 16px 12px" class="stack g8">
    <div class="card" style="padding:12px 14px">
      <div class="row g10">
        <div class="stack g2 grow" style="min-width:0">
          <span class="micro">Your next class</span>
          <span class="h3" style="margin-top:2px">Thu 21 Aug at 18:00</span>
        </div>
        <span class="chip"><i class="dot" style="background:#3b6ba5"></i>Metcon</span>
        ${ic('right', 15, 'color:var(--ink-3)')}
      </div>
    </div>
  </div>

  <div class="row between" style="padding:2px 16px 8px">
    <span class="micro">Thursday 21 August</span>
    <span class="micro" style="letter-spacing:.08em">5 classes</span>
  </div>

  <div style="padding:0 16px">
    ${agendaRow({ time: '06:00', dur: '60 min', name: 'Strength', colour: '#c2410c', coach: 'Dani Okafor', status: '8 spots left', statusTone: 'ok', on: false })}
    ${agendaRow({ time: '07:15', dur: '45 min', name: 'Metcon', colour: '#3b6ba5', coach: 'Dani Okafor', status: 'You are in', statusTone: 'ok', booked: true, on: true })}
    ${agendaRow({ time: '12:00', dur: '90 min', name: 'Open Gym', colour: '#2f7a4f', coach: null, status: '14 spots left', statusTone: 'ok' })}
    ${agendaRow({ time: '17:30', dur: '45 min', name: 'Metcon', colour: '#3b6ba5', coach: 'Priya Raman', status: '3 spots left', statusTone: 'warn', rec: true })}
    ${agendaRow({ time: '18:45', dur: '60 min', name: 'Barbell Club', colour: '#7c3aed', coach: 'Marcus Bell', status: 'Full — 2 waiting', statusTone: 'dim', action: 'Waitlist' })}
  </div>
</div>`;

  const body = `<div class="board-row">
  ${phone(screen(), { label: 'Light' })}
  ${phone(screen(), { dark: true, label: 'Dark' })}
</div>`;

  return page({
    title: 'Member — Book',
    sub: 'The member\'s whole job is "get me into the right class". Luma\'s timeline spine replaces five identical floating cards: the time sits in a gutter on a rail, so the day reads as a day. Booked state is a quiet tick, not a green-bordered card; the recommendation is a chip on the row it refers to instead of a separate card above the list.',
    body,
  });
}

/* ============================================================= 05 track */

function trackBoard() {
  const heat = () => {
    const cells = [];
    // Deterministic-looking training pattern: denser midweek, gaps at weekends.
    const seed = [
      3, 0, 2, 0, 3, 1, 0, 2, 3, 0, 2, 0, 1, 0, 3, 2, 0, 3, 0, 2, 0,
      1, 3, 2, 0, 3, 0, 0, 2, 0, 3, 1, 2, 0, 0, 3, 2, 0, 3, 0, 1, 0,
      0, 3, 2, 0, 3, 0, 2, 2, 0, 3, 1, 0, 2, 0, 3, 0, 2, 3, 0, 1, 0,
      2, 0, 3, 1, 0, 3, 0, 3, 2, 0, 2, 0, 3, 0, 1, 2, 3, 0, 2, 0, 0,
    ];
    for (let w = 0; w < 12; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const v = seed[(w * 7 + d) % seed.length];
        const style = v === 0
          ? ''
          : `background:var(--accent);opacity:${v === 1 ? 0.3 : v === 2 ? 0.6 : 1}`;
        col.push(`<i style="${style}"></i>`);
      }
      cells.push(`<div>${col.join('')}</div>`);
    }
    return `<div class="heat">${cells.join('')}</div>`;
  };

  const stat = (n, label, icon, tint, filled) => `
    <div class="inset grow" style="padding:9px;display:flex;flex-direction:column">
      <div style="color:${tint}">${filled ? icf(icon, 14) : ic(icon, 14)}</div>
      <div class="num" style="font-size:22px;margin-top:5px">${n}</div>
      <div class="small dim" style="font-size:11.5px;line-height:1.25;margin-top:1px">${label}</div>
    </div>`;

  const tile = (icon, tint, title, sub, badge) => `
    <div class="tile" style="border-top-color:${tint};min-height:76px;padding:11px">
      <div class="row between">
        <span style="color:${tint}">${ic(icon, 20)}</span>
        ${badge ? `<span class="chip chip-warn" style="height:20px;padding:0 8px;font-size:10px">${badge}</span>` : ''}
      </div>
      <div class="stack g2" style="margin-top:auto">
        <span class="h3" style="font-size:14px">${title}</span>
        <span class="small dim" style="font-size:11.5px;line-height:1.3">${sub}</span>
      </div>
    </div>`;

  const screen = () => `
${topbar('track')}
<div class="scrollarea">
  <div class="row between" style="padding:12px 16px 10px;align-items:flex-start">
    <div class="stack g4 grow">
      <span class="h1">Track</span>
      <span class="body" style="font-size:13.5px">Log workouts and PRs across movements.</span>
    </div>
    <span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Record</span>
  </div>

  <div style="padding:0 16px 12px">
    <div class="card">
      <div class="row g8" style="align-items:stretch">
        ${stat(4, 'days in a row', 'flame', 'var(--accent)', true)}
        ${stat(6, 'weeks in a row', 'cal', '#3b6ba5')}
        ${stat(11, 'this month', 'barbell', '#2f7a4f')}
      </div>
      <div class="micro" style="margin-top:13px">Last 12 weeks</div>
      <div class="row g14" style="margin-top:8px;align-items:center">
        <div style="width:172px;flex:none">${heat()}</div>
        <div class="stack g2 grow">
          <span class="num" style="font-size:26px">42</span>
          <span class="small dim" style="font-size:11.5px;line-height:1.25">sessions logged</span>
        </div>
      </div>
    </div>
  </div>

  <div class="row between" style="padding:2px 16px 8px">
    <span class="micro">Your movements</span>
    <span class="micro" style="letter-spacing:.08em">See all</span>
  </div>

  <div style="padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${tile('book', 'var(--ink)', 'Journal', '38 sessions logged')}
    ${tile('trophy', '#a9741f', 'Leaderboards', 'Heaviest, fastest, hardest')}
    ${tile('library', '#3b6ba5', 'Movement Library', 'Search &amp; star all movements')}
    ${tile('body', '#ab3a2c', 'Injury tracker', '1 open injury', '1 due')}
  </div>

  <div style="padding:10px 16px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${['Squat,6 moves,142.5,Back squat · 3 wks ago,0,18 12,15 24,16 36,10 48,8 60,3',
       'Press,4 moves,62.5,Strict press · 6 days ago,0,14 12,15 24,11 36,12 48,7 60,6']
      .map((row) => {
        const [name, moves, kg, sub, ...pts] = row.split(',');
        return `
    <div class="card" style="padding:11px">
      <div class="row between">
        <span class="h3" style="font-size:13.5px">${name}</span>
        <span class="micro" style="letter-spacing:.06em">${moves}</span>
      </div>
      <div class="row between" style="margin-top:6px;align-items:flex-end">
        <span class="num" style="font-size:21px">${kg}<span style="font-size:11px;font-weight:600"> kg</span></span>
        <svg viewBox="0 0 60 22" style="width:52px;height:18px;flex:none">
          <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="small dim" style="font-size:10.5px;margin-top:4px">${sub}</div>
    </div>`;
      })
      .join('')}
  </div>
</div>`;

  const body = `<div class="board-row">
  ${phone(screen(), { label: 'Light' })}
  ${phone(screen(), { dark: true, label: 'Dark' })}
</div>`;

  return page({
    title: 'Member — Track',
    sub: 'Consistency first, catalogue second. The streak block and the twelve-week heatmap become one card in the gym\'s colour; the tool tiles lose their tinted bubbles and coloured blob backgrounds and keep a single 2px accent rule on top, so the grid stops looking like a folder of app icons.',
    body,
  });
}

/* ========================================================== 06 timeline */

function timelineBoard() {
  const receipt = (icon, text, time) => `
  <div class="row g10" style="align-items:flex-start;padding:0 2px">
    <span style="color:var(--ink-3);margin-top:1px">${ic(icon, 15)}</span>
    <div class="grow small" style="font-size:13.5px;line-height:1.4;color:var(--ink-2)">${text}</div>
    <span class="micro" style="letter-spacing:.06em;margin-top:2px">${time}</span>
  </div>`;

  const screen = () => `
${staffTopbar('timeline')}
<div class="scrollarea">
  <div class="row" style="justify-content:center;gap:2px;padding:10px 0 6px">
    <span style="color:var(--ink-3)">${ic('left', 16)}</span>
    <span class="h2" style="font-size:16px;padding:0 8px">Today</span>
    <span style="color:var(--ink-3)">${ic('right', 16)}</span>
  </div>

  <div class="stack g12" style="padding:6px 16px 0">
    ${receipt('users2', '<b class="strong">Marcus Bell</b> joined on Unlimited.', '07:12')}
    ${receipt('check', '<b class="strong">Priya Raman</b> took tonight’s 18:45 cover.', '08:40')}
    ${receipt('mail', 'August newsletter went out. 61% opened it.', '09:05')}
  </div>

  <div class="row g8" style="padding:15px 16px 8px">
    <span style="color:var(--warn)">${ic('alert', 15)}</span>
    <span class="micro" style="color:var(--ink);letter-spacing:.14em">Waiting on you</span>
    <span class="chip chip-warn" style="height:19px;padding:0 7px;font-size:10.5px">2</span>
  </div>

  <div class="stack g9" style="padding:0 16px;gap:9px">
    <div class="card" style="border-color:var(--warn);padding:14px">
      <div class="row g10">
        <span style="color:var(--warn)">${ic('card', 17)}</span>
        <span class="h3 grow">Amara Nwosu's payment failed</span>
      </div>
      <div class="body" style="font-size:13px;margin-top:7px">
        £48 on the 3rd. Her card expired last month — she has trained four
        times since.
      </div>
      <div class="row g8" style="margin-top:13px">
        <span class="btn btn-ink btn-sm">Ask her to update it</span>
        <span class="btn btn-outline btn-sm">See the details</span>
      </div>
    </div>

    <div class="card" style="padding:14px">
      <div class="row g10">
        <span style="color:var(--ink-3)">${ic('users2', 17)}</span>
        <span class="h3 grow">Jonah Ellis wants to join</span>
        <span class="micro" style="letter-spacing:.06em">11:20</span>
      </div>
      <div class="body" style="font-size:13px;margin-top:7px">
        From the join link. No plan picked yet — Unlimited is what most take.
      </div>
      <div class="row g8" style="margin-top:13px">
        <span class="btn btn-ink btn-sm">Approve on Unlimited</span>
        <span class="btn btn-outline btn-sm">Not yet</span>
      </div>
    </div>
  </div>

  <div class="row g8" style="padding:15px 16px 8px">
    <span style="color:var(--ink-3)">${icf('spark', 14)}</span>
    <span class="micro" style="letter-spacing:.14em">With me</span>
    <span class="chip" style="height:19px;padding:0 7px;font-size:10.5px">1</span>
  </div>

  <div style="padding:0 16px">
    <div class="card" style="background:var(--surface-2);padding:14px">
      <div class="body" style="font-size:13px">
        I've asked <b class="strong">Sam Whitlock</b> to update his card, and
        I'll chase again Friday.
      </div>
      <div class="row g8" style="margin-top:12px">
        <span class="chip">${ic('clock', 13)}Chased 2 days ago</span>
        <span class="chip">Hand it back to me</span>
      </div>
    </div>
  </div>
</div>

<div class="stack g8" style="padding:10px 16px 4px;border-top:1px solid var(--line-soft)">
  <div class="row g6">
    <span class="chip">${ic('doc', 13)}Your rules</span>
    <span class="chip">${ic('people', 13)}The team</span>
    <span class="chip">${ic('flag', 13)}Goals</span>
  </div>
  <div class="field">
    <span class="grow trunc">Show me a member, change a class…</span>
    <span class="btn btn-accent" style="width:34px;height:34px;padding:0;border-radius:999px">${ic('up', 16)}</span>
  </div>
</div>`;

  const body = `<div class="board-row">
  ${phone(screen(), { dark: true, label: 'Dark' })}
  ${phone(screen(), { label: 'Light' })}
</div>`;

  return page({
    title: 'Owner — Timeline (the day\'s work)',
    sub: 'The owner\'s home is a conversation, so it should read like one. Receipts become quiet ruled lines with the time on the right; only the things actually waiting on someone get a card. "Waiting on you" borrows the one warm border in the system, "With me" sits a tone step back on the inset surface — the hierarchy is carried by tone, not by five competing accent colours.',
    body,
  });
}

/* =========================================================== 07 desktop */

function deskBoard() {
  const kpi = (label, value, delta, up, sub) => `
    <div class="card grow" style="min-width:0">
      <span class="micro">${label}</span>
      <div class="num" style="font-size:34px;margin-top:8px">${value}</div>
      <div class="row g6" style="margin-top:8px">
        <span class="chip ${up ? 'chip-ok' : 'chip-bad'}" style="height:21px;padding:0 8px;font-size:11px">${delta}</span>
        <span class="small dim" style="font-size:12px">${sub}</span>
      </div>
    </div>`;

  const member = (initials, name, plan, planTone, last, tags) => `
    <div class="row g12" style="padding:13px 16px;border-bottom:1px solid var(--line-soft)">
      ${AV(initials)}
      <div class="stack g2" style="width:210px">
        <span class="h3" style="font-size:14px">${name}</span>
        <span class="small dim" style="font-size:12px">${last}</span>
      </div>
      <div style="width:150px"><span class="chip ${planTone}">${plan}</span></div>
      <div class="row g6 grow">${tags.map((t) => `<span class="chip" style="height:22px;padding:0 9px;font-size:11px">${t}</span>`).join('')}</div>
      <span class="chip" style="height:28px;padding:0 12px">Open</span>
    </div>`;

  const inner = (dark) => `
<div class="app ${dark ? 'dark' : ''}" style="background:var(--paper);color:var(--ink)">
  <div class="deskbar">
    <b></b><b></b><b></b>
    <span class="url">app.jointemple.io/management</span>
  </div>
  <div class="topbar" style="padding:12px 22px">
    <div class="row g10 grow">
      <div class="gymtile">F</div>
      <span class="h3">Forge Barbell Club</span>
    </div>
    <div class="seg">
      <span>${ic('chat', 15)}Timeline</span>
      <span>${ic('barbell', 15)}Programming</span>
      <span>${ic('cal', 15)}Classes</span>
      <span class="on">${ic('gear', 15)}Manage</span>
    </div>
    <div class="row g8 grow" style="justify-content:flex-end">
      <span class="chip">${ic('swap', 13)}Viewing Staff</span>
      ${AV('DO')}
    </div>
  </div>

  <div style="padding:24px 22px 30px;max-width:1080px;margin:0 auto">
    <div class="row between" style="align-items:flex-end">
      <div class="stack g4">
        <span class="h1" style="font-size:29px">Members</span>
        <span class="body">214 active · 6 joined this month · 3 lapsing</span>
      </div>
      <div class="row g8">
        <span class="chip">${ic('cal', 13)}This month</span>
        <span class="btn btn-outline btn-sm">Import</span>
        <span class="btn btn-ink btn-sm">${ic('plus', 15)}Invite</span>
      </div>
    </div>

    <div class="row g12" style="margin-top:20px">
      ${kpi('Revenue', '£14,280', '+8.2%', true, 'vs previous period')}
      ${kpi('Members', '214', '+3.4%', true, 'vs previous period')}
      ${kpi('Attendance', '62%', '+2pp', true, 'of members checked in')}
      ${kpi('Lapsing', '3', '−1', true, 'no visit in 21 days')}
    </div>

    <div class="card flush" style="margin-top:20px">
      <div class="row g12" style="padding:14px 16px;border-bottom:1px solid var(--line)">
        <div class="field grow" style="height:38px;padding-left:14px">
          ${ic('search', 15, 'color:var(--ink-3)')}<span class="grow">Search members</span>
        </div>
        <span class="chip">All plans</span>
        <span class="chip">All tags</span>
        <span class="chip">${ic('doc', 13)}Export CSV</span>
      </div>
      <div class="row g12" style="padding:9px 16px;border-bottom:1px solid var(--line)">
        <span class="micro" style="width:30px"></span>
        <span class="micro" style="width:210px">Member</span>
        <span class="micro" style="width:150px">Plan</span>
        <span class="micro grow">Tags</span>
      </div>
      ${member('AN', 'Amara Nwosu', 'Payment failed', 'chip-bad', 'Trained 4× this week', ['Evenings', 'Metcon'])}
      ${member('MB', 'Marcus Bell', 'Unlimited', 'chip-ok', 'Joined today', ['New'])}
      ${member('PR', 'Priya Raman', 'Coach — staff', '', 'Coached 3 classes today', ['Coach', 'Strength'])}
      ${member('JE', 'Jonah Ellis', 'Requested', 'chip-warn', 'From the join link · 11:20', ['Lead'])}
      ${member('SW', 'Sam Whitlock', '10-class pack', '', '2 credits left · last in 21 Jul', ['Lapsing'])}
      ${member('LK', 'Leila Karim', 'Unlimited', 'chip-ok', 'Trained 12× this month', ['Mornings', 'Hyrox'])}
    </div>
  </div>
</div>`;

  const body = `
<div class="board-row" style="gap:26px">
  <div class="frame-wrap">
    <div class="frame-label">Desktop · light</div>
    <div class="desk">${inner(false)}</div>
  </div>
</div>
<div class="board-row" style="gap:26px;margin-top:34px">
  <div class="frame-wrap">
    <div class="frame-label">Desktop · dark</div>
    <div class="desk">${inner(true)}</div>
  </div>
</div>`;

  return page({
    title: 'Staff — Manage / Members on desktop',
    sub: 'Where owners actually spend their time. A ruled table instead of a stack of shadowed cards, numbers set in the display face so they carry, and status living in one small chip per row rather than in six different border colours.',
    body,
  });
}

/* ======================================================= 08 before/after */

function beforeAfterBoard() {
  const legacyScreen = () => `
<div class="scrollarea">
  <div style="padding:10px 12px 12px" class="row g8">
    <div class="row g8 grow">
      <div style="width:36px;height:36px;border-radius:999px;background:#3b6ba5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">F</div>
    </div>
    <div class="lseg">
      <span>${ic('barbell', 15)}</span>
      <span class="on">${ic('cal', 15)}Book</span>
      <span>${ic('trend', 15)}</span>
    </div>
    <div class="row g8 grow" style="justify-content:flex-end">
      <span style="display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border-radius:999px;border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.1);color:#10b981;font-size:11px;font-weight:700">${ic('swap', 13)}</span>
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
    <span class="lfilter"><i class="dot" style="background:#c2410c"></i>Strength</span>
    <span class="lfilter"><i class="dot" style="background:#3b6ba5"></i>Metcon</span>
    <span class="lfilter"><i class="dot" style="background:#2f7a4f"></i>Open Gym</span>
  </div>

  <div class="stack g8" style="padding:0 12px 10px">
    <div class="lcard" style="padding:12px;display:flex;align-items:center;gap:12px">
      <span style="background:#3b6ba5;color:#fff;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:700">Metcon</span>
      <div class="grow">
        <div class="row g4" style="gap:4px">
          ${icf('spark', 11, 'color:#a855f7')}
          <span class="lmicro">Recommended</span>
        </div>
        <div style="font-size:14px;font-weight:500">Thursday 21 Aug at 17:30</div>
      </div>
      <span class="lchip">${ic('bolt', 12)}Quick book</span>
    </div>
    <div class="lcard" style="padding:12px;display:flex;align-items:center;gap:12px">
      <div style="width:32px;height:32px;border-radius:8px;background:var(--l-inset);display:flex;align-items:center;justify-content:center;color:#6b7280">${ic('ticket', 16)}</div>
      <div class="grow">
        <div class="lmicro">Your next class</div>
        <div style="font-size:14px;font-weight:500">Thursday 21 Aug at 18:00</div>
      </div>
      <span style="background:#3b6ba5;color:#fff;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:700">Metcon</span>
      ${ic('right', 15, 'color:#9ca3af')}
    </div>
  </div>

  <div class="stack g10" style="padding:0 12px">
    ${[
      ['06:00', '60 min', 'Strength', '#c2410c', 'Dani Okafor', '8 spots left', '#059669', 'book', ''],
      ['07:15', '45 min', 'Metcon', '#3b6ba5', 'Dani Okafor', 'Booked in', '#059669', 'booked', 'border:1px solid #34d399'],
      ['12:00', '90 min', 'Open Gym', '#2f7a4f', '', '14 spots left', '#059669', 'book', ''],
      ['17:30', '45 min', 'Metcon', '#3b6ba5', 'Priya Raman', '3 spots left', '#d97706', 'book', 'border:1px solid #c084fc'],
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
          <div class="row g8" style="gap:8px">
            <i class="dot" style="background:${c}"></i>
            ${kind === 'book' && n === 'Metcon' && t === '17:30' ? icf('spark', 12, 'color:#a855f7') : ''}
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
  <div style="padding:0 16px 12px" class="stack g8">
    <div class="card" style="padding:12px 14px">
      <div class="row g10">
        <div class="stack g2 grow" style="min-width:0">
          <span class="micro">Your next class</span>
          <span class="h3" style="margin-top:2px">Thu 21 Aug at 18:00</span>
        </div>
        <span class="chip"><i class="dot" style="background:#3b6ba5"></i>Metcon</span>
        ${ic('right', 15, 'color:var(--ink-3)')}
      </div>
    </div>
  </div>
  <div class="row between" style="padding:2px 16px 8px">
    <span class="micro">Thursday 21 August</span>
    <span class="micro" style="letter-spacing:.08em">5 classes</span>
  </div>
  <div style="padding:0 16px">
    ${agendaRow({ time: '06:00', dur: '60 min', name: 'Strength', colour: '#c2410c', coach: 'Dani Okafor', status: '8 spots left', statusTone: 'ok' })}
    ${agendaRow({ time: '07:15', dur: '45 min', name: 'Metcon', colour: '#3b6ba5', coach: 'Dani Okafor', status: 'You are in', statusTone: 'ok', booked: true, on: true })}
    ${agendaRow({ time: '12:00', dur: '90 min', name: 'Open Gym', colour: '#2f7a4f', coach: null, status: '14 spots left', statusTone: 'ok' })}
    ${agendaRow({ time: '17:30', dur: '45 min', name: 'Metcon', colour: '#3b6ba5', coach: 'Priya Raman', status: '3 spots left', statusTone: 'warn', rec: true })}
    ${agendaRow({ time: '18:45', dur: '60 min', name: 'Barbell Club', colour: '#7c3aed', coach: 'Marcus Bell', status: 'Full — 2 waiting', statusTone: 'dim', action: 'Waitlist' })}
  </div>
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
    sub: 'Same data, same information, same routes. What moves: cool slate to warm paper, shadows to hairlines, five floating cards to one ruled timeline, and the brand colour from "fill everything" to "fill the thing you press".',
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
