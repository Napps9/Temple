// Board 29 — one vertical nav.
//
// The staff rail shipped at 768 and up. Two screens already had a
// full-height sidebar of their own at 1024 — the Manage hub's category
// menu and the Leads section's tab list — so on any desktop window the
// product drew two bordered nav columns side by side, 492px of chrome
// before a single row of the page.
//
// The rail also arrived too early. It takes 246px out of the row before
// the page sees any of it, so at a 768 window the page column was 522px
// wide while every `md:` class inside it still fired: the classes
// calendar switched to its wide layout in two thirds of the room it was
// drawn for.
//
// Both are fixed the same way — by deciding there is one vertical nav in
// the product, and that it waits until there is space for it.
import { AV, gymTile, ic, note, page, row, wordmark } from './kit.mjs';

const navRow = (icon, label, { on } = {}) => `
  <div class="navrow ${on ? 'on' : ''}">
    <span style="color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${ic(icon, 18)}</span>
    <span class="grow">${label}</span>
  </div>`;

const rail = `
  <div class="side" style="width:246px;gap:14px">
    <div style="padding:2px 4px 0">${wordmark(17, 'var(--ink)')}</div>
    <div class="card" style="padding:8px 10px;border-radius:var(--r-ctl)">
      <div class="row g10">${gymTile('F', 30, 9)}
        <div class="stack g2 grow" style="min-width:0">
          <span class="h3 trunc" style="font-size:13.5px">Forge Barbell Club</span>
          <span class="small dim trunc" style="font-size:12px">Owner</span>
        </div>
      </div>
    </div>
    <div class="stack g2">
      ${navRow('chat', 'Timeline')}
      ${navRow('barbell', 'Programming')}
      ${navRow('cal', 'Classes')}
      ${navRow('grid', 'Manage', { on: true })}
    </div>
    <div class="stack g2" style="margin-top:2px">
      <span class="lbl" style="padding:6px 12px 4px">The gym</span>
      ${navRow('people', 'Members')}
      ${navRow('card', 'Plans')}
      ${navRow('mail', 'Communications')}
      ${navRow('bag', 'Billing')}
    </div>
    <div style="margin-top:auto" class="stack g10">
      <div style="border-top:1px solid var(--line);padding-top:8px">
        <div class="row g10">${AV('DO', 30)}<span class="h3 grow" style="font-size:13.5px">Dani Okafor</span></div>
      </div>
    </div>
  </div>`;

const CATEGORIES = [
  ['people', 'Members'],
  ['spark', 'AI Front Desk'],
  ['mail', 'Communications'],
  ['link', 'Website'],
  ['bag', 'Store'],
  ['doc', 'Team'],
  ['card', 'Plans'],
  ['gear', 'Settings'],
];

// What it was: the categories as a second bordered column.
const categorySidebar = `
  <div class="side" style="width:246px;gap:2px;padding-top:22px">
    ${CATEGORIES.map(([i, l], k) => navRow(i, l, { on: k === 0 })).join('')}
  </div>`;

// What it is: the categories as the pill row, in the page.
const categoryPills = `
  <div class="row g8 wrap">
    ${CATEGORIES.map(
      ([i, l], k) =>
        `<span class="chip chip-sm ${k === 0 ? 'chip-on' : ''}" style="${k === 0 ? '' : 'background:var(--surface)'}">${ic(i, 14)}${l}</span>`,
    ).join('')}
  </div>`;

const searchField = `
  <div class="stack g6">
    <span class="lbl">Find a setting</span>
    <div class="input empty"><span class="grow">refunds, sending domain, coach pay…</span></div>
  </div>`;

const hubCard = (title, blurb) => `
  <div class="card" style="padding:14px;gap:4px">
    <div class="row between"><span class="h3">${title}</span>${ic('right', 15, 'color:var(--ink-3)')}</div>
    <span class="small dim" style="font-size:12.5px">${blurb}</span>
  </div>`;

const hubBody = (nav) => `
  <div style="padding:22px 24px 30px;min-width:0;display:flex;flex-direction:column;gap:16px" class="grow">
    ${searchField}
    ${nav}
    ${hubCard('Members', 'Everyone in the gym, their plan and their tags.')}
    ${hubCard('Member import', 'Bring a CSV across from your previous platform.')}
    ${hubCard('Tags & cohorts', 'Group members by hand, or by a rule that recomputes.')}
    ${hubCard('Attendance', 'Trends from check-ins recorded on class bookings.')}
  </div>`;

const desk = (inner, url = 'app.jointemple.io/management') => `
<div class="desk">
  <div class="deskbar"><b></b><b></b><b></b><span class="url">${url}</span></div>
  <div style="display:flex;background:var(--bg);min-height:520px">${inner}</div>
</div>`;

/* ------------------------------------------------------- the squeeze bar */

const widthBar = (label, cols) => `
  <div class="stack g6" style="width:100%">
    <span class="lbl">${label}</span>
    <div class="row" style="height:38px;border:1px solid var(--line);border-radius:var(--r-ctl);overflow:hidden">
      ${cols
        .map(
          ([w, text, fill]) =>
            `<div style="flex:${w};background:${fill};display:flex;align-items:center;justify-content:center;border-right:1px solid var(--line);min-width:0">
               <span class="small dim" style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px">${text}</span>
             </div>`,
        )
        .join('')}
    </div>
  </div>`;

export const oneRailBoard = () =>
  page({
    title: 'One vertical nav',
    sub: 'The rail shipped at 768. Two screens already had a sidebar of their own at 1024, so a desktop window drew two nav columns side by side — and at 768 the rail left the page 522px to lay out in while every md: class inside it still fired.',
    content: `
${row(
  `<div class="frame-wrap"><div class="frame-label">before — two nav columns</div>${desk(rail + categorySidebar + hubBody(''))}</div>`,
)}
${note(
  'The Manage hub’s category menu and the staff rail are the same shape, the same width and the same border, one against the other. Together they are 492px of chrome — more than a phone screen — before the first row of the page, and neither one tells you where you are more clearly than the other would alone.',
)}
${row(
  `<div class="frame-wrap"><div class="frame-label">after — the section nav is a pill row</div>${desk(rail + hubBody(categoryPills))}</div>`,
)}
${note(
  'The categories keep the same pills they already used below 1024 — the layout that existed for phones is simply the layout now. Leads did the same thing with its three tabs. Nothing moved routes and no capability gate changed; the second column stopped existing.',
)}
${row(
  `<div class="stack g14" style="width:100%;max-width:900px">
    ${widthBar('a 768 window, rail at 768 — what shipped', [
      [246, 'rail · 246px', 'var(--surface-2)'],
      [522, 'the page · 522px, and every md: class firing', 'var(--surface)'],
    ])}
    ${widthBar('a 768 window, rail at 1024 — now', [
      [768, 'the page · 768px, top bar above it', 'var(--surface)'],
    ])}
    ${widthBar('a 1024 window — now', [
      [246, 'rail · 246px', 'var(--surface-2)'],
      [778, 'the page · 778px, still wider than md', 'var(--surface)'],
    ])}
  </div>`,
)}
${note(
  'The rail now waits for 1024, so the column inside it is never narrower than the <code>md</code> its own classes assume. The two split views that ask the window how wide it is — the website builder and the email builder — ask <code>staffContentWidth()</code> instead, which takes the rail off.',
)}
`,
  });
