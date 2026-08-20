// Board 30 — the accent rule, finished.
//
// The rule was written on board 02 and applied to the three navs: the
// gym's colour belongs to the one action a page exists for, and nothing
// else. What it had not reached was every control that shows which of
// its options is picked — filter chips, segmented controls, radio rows,
// tick boxes. There were 61 of them, in two treatments (a brand tint
// with a brand border, or a solid brand fill with white text) plus nine
// tick boxes that had rolled their own square.
//
// A picked option is a state, not an action. It is now a tone step: the
// raised surface, a transparent border, and ink text — the same thing
// the navs already do, and the same thing `Check` already did.
import { body, ic, note, page, phone, row, staffBar, memberBar } from './kit.mjs';

/* ---------------------------------------------------------- the controls */

const oldTintChip = (label, on) =>
  `<span class="chip chip-sm" style="${
    on
      ? 'border-color:var(--accent);background:var(--accent-soft);color:var(--accent);font-weight:600'
      : ''
  }">${label}</span>`;

const oldFillChip = (label, on) =>
  `<span class="chip chip-sm" style="${
    on ? 'border-color:var(--accent);background:var(--accent);color:#fff;font-weight:600' : ''
  }">${label}</span>`;

const newChip = (label, on) => `<span class="chip chip-sm ${on ? 'chip-on' : ''}">${label}</span>`;

const oldBox = (on) =>
  `<span style="width:20px;height:20px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;${
    on
      ? 'background:var(--accent);border:1px solid var(--accent);color:#fff'
      : 'border:1.5px solid var(--line-strong)'
  }">${on ? ic('check', 12) : ''}</span>`;

const newBox = (on) =>
  `<span style="width:20px;height:20px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;${
    on
      ? 'background:var(--ink);border:1.5px solid var(--ink);color:var(--surface)'
      : 'border:1.5px solid var(--line-strong)'
  }">${on ? ic('check', 12) : ''}</span>`;

const tickRow = (box, label, on) => `
  <div class="row g12" style="padding:11px 14px;border-top:1px solid var(--line)">
    ${box(on)}<span class="h3 grow" style="font-size:14px">${label}</span>
  </div>`;

/* ----------------------------------------------------------- the screens */

const stack = (parts) =>
  `<div style="display:flex;flex-direction:column;gap:16px;padding-bottom:20px">${parts.join('')}</div>`;

const back = `<div style="padding:0 16px"><span class="chip chip-sm" style="padding-left:7px">${ic('left', 13)}Back</span></div>`;

const head = (title, sub) => `
<div style="display:flex;align-items:flex-start;gap:12px;padding:0 16px">
  <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
    <span style="font-size:26px;font-weight:700;letter-spacing:-.8px;line-height:29px">${title}</span>
    ${sub ? `<span class="body" style="font-size:14px;line-height:20px">${sub}</span>` : ''}
  </div>
</div>`;

const injuryBody = (chip, box) =>
  stack([
    back,
    head('Injury tracker', 'Log a niggle so your coaches can program around it.'),
    `<div class="stack g8" style="padding:0 16px">
      <span class="lbl">How bad is it?</span>
      <div class="row g6 wrap">${chip('Niggle', false)}${chip('Sore', true)}${chip('Injured', false)}</div>
    </div>`,
    `<div class="stack g8" style="padding:0 16px">
      <span class="lbl">Status</span>
      <div class="row g6 wrap">${chip('Active', true)}${chip('Improving', false)}${chip('Resolved', false)}</div>
    </div>`,
    `<div class="stack g8" style="padding:0 16px">
      <span class="lbl">Movements to scale</span>
      <div class="card flush">
        ${tickRow(box, 'Overhead press', true)}
        ${tickRow(box, 'Snatch', true)}
        ${tickRow(box, 'Pull-up', false)}
        ${tickRow(box, 'Back squat', false)}
      </div>
    </div>`,
    `<div style="padding:0 16px"><span class="btn btn-accent btn-full">Save injury</span></div>`,
  ]);

const plansBody = (chip) =>
  stack([
    back,
    head('Plans', 'Define your membership plans.'),
    `<div class="stack g8" style="padding:0 16px">
      <span class="lbl">Plan kind</span>
      <div class="row g6 wrap">${chip('Recurring', true)}${chip('Credit pack', false)}${chip('Intro offer', false)}</div>
    </div>`,
    `<div class="stack g10" style="padding:0 16px">
      ${['Unlimited · £89/mo · 54 subscribers', '10-class pack · £95 · 31 subscribers', 'Intro offer · £25 · 8 subscribers']
        .map(
          (t) =>
            `<div class="card" style="padding:14px"><span class="h3">${t.split(' · ')[0]}</span><span class="small dim" style="font-size:12.5px;display:block;margin-top:4px">${t.split(' · ').slice(1).join(' · ')}</span></div>`,
        )
        .join('')}
      <span class="btn btn-accent btn-full">Add a plan</span>
    </div>`,
  ]);

/* -------------------------------------------------------------- the board */

export const accentBoard = () =>
  page({
    title: 'The accent rule, finished',
    sub: 'Sixty-one controls said “this one is picked” by filling themselves with the gym’s colour. A picked option is a state, not an action — so it is a tone step now, and the accent is left for the one thing the page exists to do.',
    content: `
${row(
  phone(body(memberBar('track') + injuryBody(oldTintChip, oldBox)), {
    label: 'before — tint and fill',
  }) +
    phone(body(memberBar('track') + injuryBody(newChip, newBox)), { label: 'after' }) +
    phone(body(staffBar('manage') + plansBody(newChip)), { label: 'after — dark', dark: true }),
)}
${note(
  'On the left every answer on the screen is competing with the one button that actually does something. Two chips, two tick boxes and the Save button are all the same colour, and the brand ends up meaning “an option exists” rather than “press this”. On the right the only orange left is the button.',
)}
${row(
  `<div class="card flush" style="max-width:900px;width:100%">
    <div class="row g12" style="padding:12px 16px">
      <span class="lbl" style="width:190px;flex:none">What it was</span>
      <span class="lbl" style="width:120px;flex:none">Count</span>
      <span class="lbl grow">Now</span>
    </div>
    ${[
      ['A brand tint with a brand border', '61 controls', 'the raised surface, a transparent border, ink text'],
      ['A solid brand fill, white text', '11 controls', 'the same — one selected treatment, not two'],
      ['Its own tick box, brand-filled', '9 boxes', '<code>Check</code>, which was already ink and already existed'],
      ['A brand label in the picked branch', '51 labels', 'ink at semibold — weight carries it, not hue'],
    ]
      .map(
        ([a, b, c]) => `<div class="row g12" style="padding:11px 16px;border-top:1px solid var(--line)">
          <span class="small" style="width:190px;flex:none;font-size:12.5px">${a}</span>
          <span class="small dim" style="width:120px;flex:none;font-size:12.5px">${b}</span>
          <span class="small grow" style="font-size:12.5px">${c}</span>
        </div>`,
      )
      .join('')}
  </div>`,
)}
${note(
  'Two kept the accent on purpose. The date picker’s chosen day is the answer the picker exists to give, and the setup conversation’s first option chip is a recommendation rather than a selection. Today’s date on a calendar keeps it too: that is emphasis on a fact, not a control saying it has been pressed.',
)}
`,
  });
