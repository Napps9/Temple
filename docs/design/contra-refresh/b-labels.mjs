// Board 28 — one label.
//
// The small-caps rule naming what is under it existed in the app 112
// times, written by hand in 47 files. It was 9px, 10px, 11px and 12px;
// normal, medium, semibold and bold; ink-2 and ink-3. Two files had gone
// as far as declaring their own local `FieldLabel` component — the same
// idea invented twice, and neither matching the caps labels beside it.
//
// Meanwhile `Input`, imported by 47 files, drew a fourth thing: a 14px
// medium sentence-case label. So a form with a text field and a picker
// showed two different label idioms one above the other.
//
// There is now one token. `SectionLabel` above a group, `FieldLabel`
// above a control that is not an Input, `Input`'s own label — all three
// are 11px / 600 / uppercase / +1px / ink-3, defined once.
import { body, field, ic, note, page, phone, row, staffBar } from './kit.mjs';

/* ------------------------------------------------------------ the labels */

const oldInputLabel = (label, value, hint) => `
<div class="stack g6">
  <span style="font-size:14px;font-weight:500;color:var(--ink-2)">${label}</span>
  <div class="input ${value ? '' : 'empty'}"><span class="grow">${value || hint}</span></div>
</div>`;

const oldCapsLabel = (text) =>
  `<span style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)">${text}</span>`;

/* ----------------------------------------------------------- the screens */

const back = `<div style="padding:0 16px"><span class="chip chip-sm" style="padding-left:7px">${ic('left', 13)}Back</span></div>`;

const head = (title, sub, action = '') => `
<div style="display:flex;align-items:flex-start;gap:12px;padding:0 16px">
  <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
    <span style="font-size:26px;font-weight:700;letter-spacing:-.8px;line-height:29px">${title}</span>
    ${sub ? `<span class="body" style="font-size:14px;line-height:20px">${sub}</span>` : ''}
  </div>
  ${action}
</div>`;

const stack = (parts) =>
  `<div style="display:flex;flex-direction:column;gap:16px;padding-bottom:20px">${parts.join('')}</div>`;

const designRow = `
<div class="card" style="padding:14px;flex-direction:row;align-items:center;gap:12px;display:flex">
  <span style="width:44px;height:44px;border-radius:999px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center">${ic('pen', 20, 'color:var(--accent)')}</span>
  <div class="stack g2 grow" style="min-width:0">
    <span class="h3">Design your email</span>
    <span class="small dim" style="font-size:12.5px">4 blocks · open the builder</span>
  </div>
  ${ic('right', 16, 'color:var(--ink-3)')}
</div>`;

const picker = (options, active) =>
  `<div class="row g6 wrap">${options
    .map((o) => `<span class="chip chip-sm ${o === active ? 'chip-on' : ''}">${o}</span>`)
    .join('')}</div>`;

const audience = `
<div class="card" style="padding:14px;gap:8px">
  <span class="h3">All active members</span>
  <span class="small dim" style="font-size:12.5px">214 recipients · 3 unsubscribed from this topic</span>
</div>`;

const campaignBefore = stack([
  back,
  head('Edit campaign', 'Build your email, choose who gets it, then send.'),
  `<div style="padding:0 16px">${designRow}</div>`,
  `<div class="stack g14" style="padding:0 16px">
    ${oldInputLabel('Title', 'March newsletter')}
    ${oldInputLabel('Subject', '', 'What is on this month at Forge')}
  </div>`,
  `<div class="stack g8" style="padding:0 16px">${oldCapsLabel('Topic')}${picker(['Newsletter', 'Promos', 'Billing'], 'Newsletter')}</div>`,
  `<div class="stack g8" style="padding:0 16px">${oldCapsLabel('Audience')}${audience}</div>`,
]);

const campaignAfter = stack([
  back,
  head('Edit campaign', 'Build your email, choose who gets it, then send.'),
  `<div style="padding:0 16px">${designRow}</div>`,
  `<div class="stack g14" style="padding:0 16px">
    ${field('Title', 'March newsletter')}
    ${field('Subject', '', { hint: 'What is on this month at Forge' })}
  </div>`,
  `<div class="stack g8" style="padding:0 16px"><span class="lbl">Topic</span>${picker(['Newsletter', 'Promos', 'Billing'], 'Newsletter')}</div>`,
  `<div class="stack g8" style="padding:0 16px"><span class="lbl">Audience</span>${audience}</div>`,
]);

const raceAfter = stack([
  back,
  head('Record a race', 'Hyrox splits, station by station.'),
  `<div class="stack g8" style="padding:0 16px"><span class="lbl">Race type</span>${picker(['Full', 'Doubles', 'Relay'], 'Full')}</div>`,
  `<div class="stack g8" style="padding:0 16px"><span class="lbl">Division</span>${picker(['Open', 'Pro'], 'Pro')}</div>`,
  `<div class="stack g8" style="padding:0 16px"><span class="lbl">Category</span>${picker(['Individual', 'Team'], 'Individual')}</div>`,
  `<div style="padding:0 16px">${field('Finish time', '1:12:44')}</div>`,
  `<div style="padding:0 16px"><span class="btn btn-accent btn-full">Save race</span></div>`,
]);

/* -------------------------------------------------------------- the board */

export const labelsBoard = () =>
  page({
    title: 'One label',
    sub: 'The same idiom was written by hand 112 times across 47 files, at four sizes, four weights and two greys — and Input drew a fifth thing, so a text field and a picker in the same form disagreed. There is now one token, defined once.',
    content: `
${row(
  phone(body(staffBar('manage') + campaignBefore), { label: 'before — two idioms, one form' }) +
    phone(body(staffBar('manage') + campaignAfter), { label: 'after — one token' }) +
    phone(body(staffBar('manage') + raceAfter), { label: 'after — dark', dark: true }),
)}
${note(
  'Left: Title and Subject carry Input’s 14px medium sentence-case label; Topic and Audience carry the hand-rolled 12px caps one, four pixels apart in size and nothing alike in weight. Right: all four are the same 11px / 600 / uppercase / +1px rule. <code>uppercase</code> is a style rather than a transform of the string, so a screen reader still hears “Email address” and not the shouted version.',
)}
${row(
  `<div class="card flush" style="max-width:900px;width:100%">
    <div class="row g12" style="padding:12px 16px">
      <span class="lbl" style="width:150px;flex:none">Where it was</span>
      <span class="lbl" style="width:210px;flex:none">What it drew</span>
      <span class="lbl grow">Now</span>
    </div>
    ${[
      ['65 call sites', '12px · normal · ink-3', 'FieldLabel'],
      ['17 call sites', '10px · normal · ink-3', 'FieldLabel'],
      ['13 call sites', '12px · normal · ink-2', 'FieldLabel'],
      ['EmailEditor', 'its own local component — 12px · medium · ink-2', 'FieldLabel'],
      ['SiteEditor', 'its own local component — the same one, again', 'FieldLabel'],
      ['Input (47 files)', '14px · medium · sentence case · ink-2', 'the same token'],
      ['18 groups', 'the caps label above a list', 'SectionLabel'],
    ]
      .map(
        ([a, b, c]) => `<div class="row g12" style="padding:11px 16px;border-top:1px solid var(--line)">
          <span class="small" style="width:150px;flex:none;font-size:12.5px">${a}</span>
          <span class="small dim" style="width:210px;flex:none;font-size:12.5px">${b}</span>
          <span class="small grow" style="font-size:12.5px">${c}</span>
        </div>`,
      )
      .join('')}
  </div>`,
)}
${note(
  'Left alone deliberately: the coloured badges. Amber, emerald, rose and purple caps chips carry their meaning in the colour, so they are status pills rather than labels and belong to their own token, not this one.',
)}
`,
  });
