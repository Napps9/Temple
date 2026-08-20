// Board 34 — what shipped, counted.
//
// The redesign was never a retexture. Boards 01-21 proposed a system;
// 22-33 record what landed. This one is the scoreboard, because a number
// is checkable in a way "it feels tidier" is not, and because two of the
// numbers are the ones that matter most: the count of things drawn by
// hand that are now drawn once, and the count of routes that stopped
// existing.
import { ic, note, page, row } from './kit.mjs';

const NUMBERS = [
  ['5,604', 'gray-* and slate-* utilities', '0 — the neutral ramp, by codemod and then by hand'],
  ['46', 'runtime hex greys a class sweep cannot reach', '0 neutral; 16 remain and are data colours'],
  ['272', 'drop shadows on flat cards', '0 — a hairline and a tone step; two shadows exist'],
  ['22', 'bespoke modals', '0 — one Sheet, a sheet under 1024 and a dialog above'],
  ['7', 'modals opening another modal', '0 — a nested one is a step of the same sheet'],
  ['41', 'hand-rolled page titles', '0 — PageHead'],
  ['112', 'hand-written small-caps labels, 4 sizes, 4 weights', '0 — one token, three ways in'],
  ['61', 'controls filling with the brand to say “picked”', '0 — the accent is the page’s one action'],
  ['9', 'tick boxes that rolled their own square', '0 — Check, which was already ink'],
  ['17', 'spinners where a skeleton belonged', '0 — the shape that is coming'],
  ['2', 'vertical navs on one desktop window', '1'],
  ['3', 'routes that were a heading around a section', '0 — Email is four routes, from seven'],
];

const PARTS = [
  ['PageHead', 'what the page is, what it is showing, at most one action'],
  ['SectionLabel · FieldLabel', 'the same 11px caps rule; one is a heading, one is not'],
  ['ListRow · RuledList', 'a card per object, or one ruled card for a table'],
  ['SettingCard', 'one decision, one card, its own save'],
  ['Sheet · SheetAction', 'sheet under 1024, dialog above; onBack makes a step'],
  ['EmptyState · Spinner', 'nothing yet · nothing matches · loading · failed'],
  ['Check', 'the tick box, ink because a ticked row is a state'],
  ['AIMark', 'the one glyph that means a machine did this'],
];

const numberRow = ([n, was, now]) => `
  <div class="row g14" style="padding:12px 18px;border-top:1px solid var(--line);align-items:baseline">
    <span class="num" style="width:64px;flex:none;font-size:19px;text-align:right">${n}</span>
    <span class="small" style="width:330px;flex:none;font-size:12.5px">${was}</span>
    <span class="small dim grow" style="font-size:12.5px">${now}</span>
  </div>`;

const partRow = ([name, what]) => `
  <div class="row g14" style="padding:11px 18px;border-top:1px solid var(--line)">
    <span class="h3" style="width:220px;flex:none;font-size:13.5px;font-family:ui-monospace,monospace">${name}</span>
    <span class="small dim grow" style="font-size:12.5px">${what}</span>
  </div>`;

const ruleCard = (title, body) => `
  <div class="card grow" style="padding:16px;gap:6px;min-width:250px">
    <span class="h3">${title}</span>
    <span class="small dim" style="font-size:12.5px;line-height:1.5">${body}</span>
  </div>`;

export const shippedAllBoard = () =>
  page({
    title: 'What shipped, counted',
    sub: 'Boards 01–21 proposed a system; 22–33 record what landed. This is the scoreboard, because a number is checkable in a way “it feels tidier” is not.',
    content: `
${row(
  `<div class="card flush" style="max-width:960px;width:100%">
    <div class="row g14" style="padding:12px 18px">
      <span class="lbl" style="width:64px;flex:none;text-align:right">Was</span>
      <span class="lbl" style="width:330px;flex:none">Of what</span>
      <span class="lbl grow">Now</span>
    </div>
    ${NUMBERS.map(numberRow).join('')}
  </div>`,
)}
${note(
  'Every one of these was verified the same way, because <code>tsc</code> and vitest cannot see a wrong design token — a class NativeWind does not recognise compiles to nothing and is green in CI. Each push ran an <code>expo export</code> and grepped the emitted CSS for every class it introduced, including one deliberately fake class per run to prove the checker could still fail.',
)}
${row(
  `<div class="card flush" style="max-width:960px;width:100%">
    <div class="row g14" style="padding:12px 18px">
      <span class="lbl" style="width:220px;flex:none">The part</span>
      <span class="lbl grow">What it is for</span>
    </div>
    ${PARTS.map(partRow).join('')}
  </div>`,
)}
${row(
  `<div class="row g14 wrap" style="max-width:960px;width:100%;align-items:stretch">
    ${ruleCard('The accent', 'The gym’s colour marks the one action a page exists for, and nothing else. A picked chip, a ticked box and a nav’s current section are a tone step, because a picked option is a state rather than an action.')}
    ${ruleCard('Depth', 'A card is a hairline and a tone step. Two shadows exist and only for something that genuinely leaves the page: a primary button, a sheet, a dialog, a popover.')}
    ${ruleCard('The modal', 'A sheet under 1024 and a dialog above it, and it never opens another modal. A nested one is a step: the container stays, the head names the step, back returns.')}
    ${ruleCard('The nav', 'One vertical nav. The rail is 246px the page never sees, which is why it waits for 1024 — below that a page inside it would be narrower than the md: classes it contains assume.')}
  </div>`,
)}
${note(
  'What is left is written down rather than glossed: every directory except six still hand-rolls its rows, the three heaviest screens have the right colours and the wrong structure, and the most repeated shape in the product — a door, being an icon tile, a title, a wrapping blurb and a chevron — is not one of the parts. Two consolidations the plan asked for are deliberately not done, because reading the code showed they would make the product worse rather than smaller.',
)}
`,
  });
