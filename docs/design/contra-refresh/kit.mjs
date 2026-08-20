// Shared primitives for the Temple redesign boards.
// Everything the screens are made of lives here, so a screen definition is
// a list of parts rather than a wall of markup.

/* ------------------------------------------------------------------ icons */

export const ICONS = {
  cal: '<rect x="3" y="5" width="18" height="16" rx="3.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  barbell: '<path d="M4 9v6M7 6.5v11M17 6.5v11M20 9v6M7 12h10"/>',
  trend: '<path d="M3 16.5l6-6 4 4 7.5-7.5"/><path d="M14.5 7h6v6"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  up: '<path d="M12 19.5V5"/><path d="M6 11l6-6 6 6"/>',
  arrow: '<path d="M5 12h13"/><path d="M12.5 5.5 19 12l-6.5 6.5"/>',
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
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.2 2"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 20.5 20.5"/>',
  trophy:
    '<path d="M8 4h8v4.6a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.4A2.6 2.6 0 0 0 8 10.6M16 5.5h2.6A2.6 2.6 0 0 1 16 10.6"/><path d="M12 12.6v3.2M8.8 20h6.4l-.6-4H9.4z"/>',
  book: '<path d="M5 5.2A2.2 2.2 0 0 1 7.2 3H19v14.4H7.2A2.2 2.2 0 0 0 5 19.6z"/><path d="M5 19.6A1.6 1.6 0 0 1 6.6 18H19v3H6.6A1.6 1.6 0 0 1 5 19.6z"/>',
  body: '<circle cx="12" cy="4.4" r="2"/><path d="M12 7v7.2M12 7.6 7.2 9.4M12 7.6l4.8 1.8M12 14.2 9 20.4M12 14.2l3 6.2"/>',
  library: '<path d="M4 5h3.6v14H4zM9.6 5h3.6v14H9.6z"/><path d="M16.4 5.6l3.3 12.8-2.2.6-3.3-12.8z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m3.8 7 8.2 6 8.2-6"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
  bag: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  heart: '<path d="M12 20.3S3.8 15 3.8 9.5A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.2 3.1c0 5.5-8.2 10.8-8.2 10.8z"/>',
  shield: '<path d="M12 3l7.5 3v6c0 5-3.4 8-7.5 9.5C7.9 20 4.5 17 4.5 12V6z"/><path d="M9 12l2.2 2.2L15.4 10"/>',
  pen: '<path d="M4 20.2 4.6 16 16.4 4.2a2.1 2.1 0 0 1 3 3L7.7 19z"/><path d="M13.8 6.8l3.4 3.4"/>',
  qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><path d="M13.5 13.5h3v3h-3zM20.5 13.5v3M17 20.5h3.5M13.5 20.5h1"/>',
  link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
  bolt: '<path d="M13.2 2.5 4.8 13.6H11l-.8 7.9 8.9-11.1H13z"/>',
  wifi: '<path d="M4.5 10.5a10 10 0 0 1 15 0M7.5 13.8a5.6 5.6 0 0 1 9 0"/><circle cx="12" cy="17.6" r="1.2"/>',
  filter: '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.6"/><path d="M15.5 5.5H5.8a2.3 2.3 0 0 0-2.3 2.3v9.7"/>',
  play: '<path d="M7.5 5.2 19 12 7.5 18.8z"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4.5v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 19.5v-4h4"/>',
};

export const sprite = () =>
  `<svg style="position:absolute;width:0;height:0" aria-hidden="true">${Object.entries(ICONS)
    .map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`)
    .join('')}</svg>`;

export const ic = (n, s = 16, st = '') =>
  `<svg class="i" style="width:${s}px;height:${s}px;flex:none;${st}"><use href="#i-${n}"/></svg>`;
export const icf = (n, s = 16, st = '') =>
  `<svg class="i i-fill" style="width:${s}px;height:${s}px;flex:none;${st}"><use href="#i-${n}"/></svg>`;

/* ------------------------------------------------------------------ brand */

export const MARK = {
  portico: 'M3 6h42v7H3zM8.5 17h6.4v16H8.5zM20.8 17h6.4v16h-6.4zM33.1 17h6.4v16h-6.4zM3 36h42v7H3z',
  doorway: 'M6 44V9h36v35h-8.5V17.5h-19V44z',
  pediment: 'M24 4 45 20H3zM6 24h36v7H6zM3 36h42v7H3z',
  column: 'M13.5 5h21v6.4h-21zM18.6 14h10.8v21H18.6zM11.5 37.6h25V44h-25z',
};

export const mark = (kind, size, color) =>
  `<svg viewBox="0 0 48 48" width="${size}" height="${size}" style="flex:none;display:block"><path fill="${color}" fill-rule="evenodd" d="${MARK[kind]}"/></svg>`;

export function starfield(kind, color, opacity) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46"><g transform="translate(17.5 17.5) scale(0.229)"><path fill="${color}" fill-opacity="${opacity}" fill-rule="evenodd" d="${MARK[kind]}"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const wordmark = (size, color) =>
  `<span class="wordmark" style="font-size:${size}px;color:${color}">temple</span>`;

export const lockup = (size, color) =>
  `<span class="row" style="gap:${Math.round(size * 0.34)}px">${mark('portico', Math.round(size * 0.92), color)}${wordmark(size, color)}</span>`;

export const MEDIA = {
  owner: 'radial-gradient(110% 80% at 80% 6%, #fcd34d 0%, rgba(252,211,77,0) 58%), linear-gradient(158deg, #f97316 0%, #7c2d12 100%)',
  member: 'radial-gradient(110% 80% at 22% 8%, #7dd3fc 0%, rgba(125,211,252,0) 60%), linear-gradient(155deg, #38bdf8 0%, #1e3a8a 100%)',
  solo: 'radial-gradient(110% 80% at 28% 10%, #bbf7d0 0%, rgba(187,247,208,0) 58%), linear-gradient(152deg, #4ade80 0%, #14532d 100%)',
  strength: 'radial-gradient(110% 80% at 24% 10%, #fda4af 0%, rgba(253,164,175,0) 58%), linear-gradient(150deg, #e11d48 0%, #4c0519 100%)',
  metcon: 'radial-gradient(110% 80% at 76% 8%, #c4b5fd 0%, rgba(196,181,253,0) 58%), linear-gradient(150deg, #6366f1 0%, #1e1b4b 100%)',
  gym: 'radial-gradient(110% 80% at 70% 12%, #a5b4fc 0%, rgba(165,180,252,0) 55%), linear-gradient(160deg, #475569 0%, #0f172a 100%)',
};

export const TYPE = { strength: '#e11d48', metcon: '#6366f1', open: '#0f766e', barbell: '#7c3aed', hyrox: '#ca8a04' };

/* ------------------------------------------------------------- primitives */

export const AV = (initials, size = 30) =>
  `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.37)}px">${initials}</div>`;

export const avstack = (list, size = 22, onMedia = false) =>
  `<div class="avstack ${size < 24 ? 'faces' : ''} ${onMedia ? 'on-media' : ''}">${list.map((i) => AV(i, size)).join('')}</div>`;

export const orb = (size) => `<span class="orb" style="width:${size}px;height:${size}px;display:block"></span>`;

export const dot = (c) => `<i class="dot" style="background:${c}"></i>`;

export const lbl = (t, right = '') =>
  `<div class="row between" style="padding:0 16px 9px"><span class="lbl">${t}</span>${right}</div>`;

export const gymTile = (letter = 'F', size = 30, radius = 9) =>
  `<div class="gymtile" style="width:${size}px;height:${size}px;border-radius:${radius}px;font-size:${Math.round(size * 0.47)}px">${letter}</div>`;

/* ------------------------------------------------------------ page parts */

// Top bar. Nav is the reference's filter row: selected is a soft tint pill,
// the rest are bare icons.
export const bar = (items, active, { right = '', letter = 'F' } = {}) => `
<div class="topbar">
  <div class="row g8 grow" style="min-width:0">${gymTile(letter)}</div>
  <div class="row g4" style="min-width:0">${items
    .map(
      ([k, i, l]) =>
        `<span class="chip ${active === k ? 'chip-on' : ''}" style="${active === k ? '' : 'border-color:transparent;background:transparent'}">${ic(i, 15)}${active === k ? l : ''}</span>`,
    )
    .join('')}</div>
  <div class="row g6 grow" style="justify-content:flex-end;flex:none">${right || AV('an')}</div>
</div>`;

export const MEMBER_NAV = [['programming', 'barbell', 'Programming'], ['book', 'cal', 'Book'], ['track', 'trend', 'Track']];
export const STAFF_NAV = [['timeline', 'chat', 'Timeline'], ['programming', 'barbell', 'Programming'], ['classes', 'cal', 'Classes'], ['manage', 'gear', 'Manage']];

export const memberBar = (active) => bar(MEMBER_NAV, active);
// The member/staff switch is icon-only on a phone: the four nav icons
// already say which side you are on.
export const staffBar = (active) =>
  bar(STAFF_NAV, active, {
    right: `<span class="chip chip-sm" style="width:26px;padding:0;justify-content:center">${ic('refresh', 12)}</span>${AV('do')}`,
  });

// A sub-page: back affordance replaces the nav, per Temple's BackLink rule.
export const subBar = (title, right = '') => `
<div class="topbar" style="padding-bottom:10px">
  <span class="chip chip-sm" style="padding-left:7px">${ic('left', 13)}Back</span>
  <span class="h3 grow" style="text-align:center">${title}</span>
  <span style="min-width:64px;display:flex;justify-content:flex-end">${right}</span>
</div>`;

export const pagehead = (title, sub, action = '') => `
<div class="pagehead">
  <div class="stack g4 grow">
    <span class="h1">${title}</span>
    ${sub ? `<span class="body" style="font-size:14px">${sub}</span>` : ''}
  </div>
  ${action}
</div>`;

export const chips = (list, pad = '0 16px 12px') =>
  `<div class="row g6 wrap" style="padding:${pad}">${list
    .map(([label, on, lead]) => `<span class="chip chip-sm ${on ? 'chip-on' : ''}">${lead ?? ''}${label}</span>`)
    .join('')}</div>`;

export const segmented = (list, active) =>
  `<div class="segmented">${list.map((l) => `<span class="${l === active ? 'on' : ''}">${l}</span>`).join('')}</div>`;

export const tabs = (list, active) =>
  `<div class="tabs">${list.map((l) => `<span class="${l === active ? 'on' : ''}">${l}</span>`).join('')}</div>`;

// The one row shape behind every directory in the product.
export const listrow = ({ lead, title, sub, right, chip, ruled }) => `
<div class="listrow" ${ruled ? '' : ''}>
  ${lead ?? ''}
  <div class="stack g2 grow" style="min-width:0">
    <span class="h3 trunc">${title}</span>
    ${sub ? `<span class="small dim trunc" style="font-size:12.5px">${sub}</span>` : ''}
  </div>
  ${chip ?? ''}
  ${right ?? ic('right', 15, 'color:var(--ink-3)')}
</div>`;

export const setting = ({ title, sub, control, save, wide }) => `
<div class="setting">
  <div class="cap">
    <div class="stack g2 grow" style="min-width:0">
      <span class="h3">${title}</span>
      ${sub ? `<span class="small dim" style="font-size:12.5px;line-height:1.4">${sub}</span>` : ''}
    </div>
    ${wide ? '' : (control ?? '')}
  </div>
  ${wide ? `<div style="margin-top:12px">${control ?? ''}</div>` : ''}
  ${save ? `<div class="row between" style="margin-top:13px"><span class="small dim" style="font-size:12px">${save.hint ?? ''}</span><span class="btn btn-dark btn-sm">${save.label ?? 'Save'}</span></div>` : ''}
</div>`;

export const field = (label, value, { hint, bad, area, trail } = {}) => `
<div class="stack g6">
  <span class="lbl" style="letter-spacing:.06em">${label}</span>
  <div class="input ${value ? '' : 'empty'} ${area ? 'area' : ''} ${bad ? 'bad' : ''}">
    <span class="grow">${value || hint || ''}</span>${trail ?? ''}
  </div>
  ${bad ? `<span class="small" style="font-size:12px;color:var(--bad)">${bad}</span>` : ''}
</div>`;

export const sw = (on) => `<span class="switch ${on ? 'on' : ''}"><i></i></span>`;
export const radio = (on) => `<span class="radio ${on ? 'on' : ''}"></span>`;
export const checkbox = (on) => `<span class="check ${on ? 'on' : ''}">${on ? ic('check', 12) : ''}</span>`;

export const stat = (n, label, sub) => `
  <div class="grow stack g2" style="min-width:0">
    <span class="num" style="font-size:25px">${n}</span>
    <span class="lbl" style="letter-spacing:.045em;font-size:10px">${label}</span>
    ${sub ? `<span class="small dim" style="font-size:11.5px">${sub}</span>` : ''}
  </div>`;

export const divider = () => `<span style="width:1px;background:var(--line);margin:0 12px;align-self:stretch"></span>`;

export const media = ({ bg, kicker, title, sub, foot, h = 132, icon = 'grid' }) => `
<div class="media" style="background-image:${bg};height:${h}px">
  <div class="top">
    <span class="appicon">${ic(icon, 12)}</span>
    <span style="font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;opacity:.92">${kicker}</span>
    <span class="grow"></span>${ic('arrow', 16, 'opacity:.9')}
  </div>
  <div style="font-size:18px;font-weight:700;letter-spacing:-.028em">${title}</div>
  ${sub ? `<div style="font-size:12.5px;opacity:.86;margin-top:3px">${sub}</div>` : ''}
  ${foot ? `<div class="row between" style="margin-top:10px">${foot}</div>` : ''}
</div>`;

export const emptyState = ({ icon, title, body, action }) => `
<div class="stack g12" style="align-items:center;padding:38px 26px;text-align:center">
  <span class="empty-icon">${ic(icon, 21)}</span>
  <div class="stack g4">
    <span class="h3" style="font-size:16px">${title}</span>
    <span class="small dim" style="font-size:13px;line-height:1.45;max-width:250px">${body}</span>
  </div>
  ${action ?? ''}
</div>`;

export const skel = (w, h, extra = '') => `<span class="skel" style="width:${w};height:${h}px;${extra}"></span>`;

/* ------------------------------------------------------------ the modal */
/* Phone gets a sheet, desktop gets a dialog. Same title, same body, same
   actions, same order — only the container changes. */

export const sheet = ({ title, sub, body, actions, close = true }) => `
<div class="backdrop"></div>
<div class="sheet">
  <div class="grab"><i></i></div>
  <div class="sheet-head">
    <div class="stack g2 grow" style="min-width:0">
      <span class="h2" style="font-size:19px">${title}</span>
      ${sub ? `<span class="small dim" style="font-size:13px">${sub}</span>` : ''}
    </div>
    ${close ? `<span class="chip" style="width:30px;height:30px;padding:0;justify-content:center">${ic('close', 14)}</span>` : ''}
  </div>
  <div class="sheet-body">${body}</div>
  ${actions ? `<div class="sheet-foot">${actions}</div>` : ''}
</div>`;

export const dialog = ({ title, sub, body, actions, width = 460 }) => `
<div class="dialog" style="width:${width}px">
  <div class="sheet-head" style="padding:16px 18px 12px">
    <div class="stack g2 grow" style="min-width:0">
      <span class="h2" style="font-size:19px">${title}</span>
      ${sub ? `<span class="small dim" style="font-size:13px">${sub}</span>` : ''}
    </div>
    <span class="chip" style="width:30px;height:30px;padding:0;justify-content:center">${ic('close', 14)}</span>
  </div>
  <div style="padding:0 18px 16px">${body}</div>
  ${actions ? `<div class="dialog-foot">${actions}</div>` : ''}
</div>`;

/* --------------------------------------------------------- device chrome */

export const statusbar = () => `
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

export const phone = (inner, { dark = false, label = '', legacy = false, scale = 1 } = {}) => `
<div class="frame-wrap">
  ${label ? `<div class="frame-label">${label}</div>` : ''}
  <div class="frame" style="${scale !== 1 ? `transform:scale(${scale});transform-origin:top center;margin-bottom:${Math.round(-844 * (1 - scale))}px` : ''}">
    <div class="screen ${legacy ? 'legacy' : 'app'} ${dark ? 'dark' : ''}"
         style="background:var(${legacy ? '--l-bg' : '--bg'});color:var(${legacy ? '--l-ink' : '--ink'})">
      ${statusbar()}${inner}
      <div class="homebar"><span></span></div>
    </div>
  </div>
</div>`;

// Scroll body of a phone screen.
export const body = (inner) => `<div class="scrollarea">${inner}</div>`;

export const page = ({ title, sub, content, extraCss = '' }) => `<!doctype html>
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
${content}
</body></html>`;

export const row = (inner, style = '') => `<div class="board-row" style="${style}">${inner}</div>`;

// A caption under a group of phones, for boards that need to name the rule.
export const note = (text) =>
  `<div class="board-row" style="margin-top:6px"><p class="board-sub" style="text-align:center;max-width:900px">${text}</p></div>`;
