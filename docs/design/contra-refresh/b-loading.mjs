// Board 31 — the loading state, as shipped.
//
// Board 20 defined four states every list owes you and made the case for
// the one that is usually skipped: a skeleton of the shape that is
// coming, rather than a spinner in the middle of a blank page. The
// difference is not decoration. A spinner is centred in the empty space,
// so when the data lands the page jumps — the first row appears where
// the spinner was, everything below it moves, and a tap aimed at what
// you could see lands on something else.
//
// The timeline is where this mattered most: it is the staff home screen,
// it loads on every visit, and its feed is the tallest list in the
// product.
import { body, ic, note, page, phone, row, staffBar } from './kit.mjs';

/* ------------------------------------------------------------ the states */

const spinner = `
  <div style="padding:64px 24px;display:flex;justify-content:center">
    <span style="width:22px;height:22px;border-radius:999px;border:2.5px solid var(--line-strong);border-top-color:var(--ink-3);display:block"></span>
  </div>`;

const skeletonRow = (i) => `
  <div class="row g12" style="padding:13px 14px;${i ? 'border-top:1px solid var(--line)' : ''}">
    <span style="width:32px;height:32px;border-radius:999px;background:var(--surface-2);flex:none"></span>
    <span class="stack g6 grow">
      <span style="height:11px;width:34%;border-radius:999px;background:var(--surface-2);display:block"></span>
      <span style="height:9px;width:58%;border-radius:999px;background:var(--surface-2);display:block"></span>
    </span>
  </div>`;

const skeleton = (rows = 4) => `
  <div style="padding:0 16px">
    <div class="card flush">${Array.from({ length: rows }, (_, i) => skeletonRow(i)).join('')}</div>
  </div>`;

const receipt = (icon, text, when) => `
  <div class="row g12" style="padding:12px 16px">
    <span style="width:32px;height:32px;border-radius:999px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex:none">${ic(icon, 15, 'color:var(--ink-3)')}</span>
    <span class="stack g2 grow" style="min-width:0">
      <span class="h3" style="font-size:14px">${text}</span>
      <span class="small dim" style="font-size:12px">${when}</span>
    </span>
  </div>`;

const loaded = `
  <div style="padding:0">
    ${receipt('person', 'Priya Kaur joined on Unlimited', '9 minutes ago')}
    ${receipt('card', 'Marcus Bell’s payment failed', '40 minutes ago')}
    ${receipt('cal', 'Thursday 18:00 Metcon filled up', '2 hours ago')}
    ${receipt('chat', 'Sam Doyle asked about pausing', 'yesterday')}
  </div>`;

const emptyCard = (icon, title, text, tint) => `
  <div style="padding:0 16px">
    <div class="card" style="padding:24px;align-items:center;text-align:center;gap:12px;display:flex;flex-direction:column">
      <span style="width:48px;height:48px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:${tint}">${ic(icon, 24, 'color:var(--ink-3)')}</span>
      <div class="stack g4">
        <span class="h3" style="font-size:16px">${title}</span>
        <span class="small dim" style="font-size:13px;line-height:1.45;max-width:250px">${text}</span>
      </div>
    </div>
  </div>`;

const oldEmpty = (title, text) => `
  <div style="padding:64px 24px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center">
    <span class="h3" style="font-size:16px">${title}</span>
    <span class="small dim" style="font-size:13px;line-height:1.45">${text}</span>
  </div>`;

/* ----------------------------------------------------------- the screens */

const dayTabs = `
  <div class="row g6" style="padding:0 16px 4px">
    ${['Yesterday', 'Today', 'Tomorrow'].map((d, i) => `<span class="chip chip-sm ${i === 1 ? 'chip-on' : ''}">${d}</span>`).join('')}
  </div>`;

const timeline = (inner) =>
  `<div style="display:flex;flex-direction:column;gap:14px;padding-top:4px">${dayTabs}${inner}</div>`;

/* -------------------------------------------------------------- the board */

export const shippedStatesBoard = () =>
  page({
    title: 'The loading state, as shipped',
    sub: 'A spinner sits in the middle of the space the list will fill, so the page jumps when the data lands. A skeleton is the shape that is coming — the rows arrive where they were already drawn.',
    content: `
${row(
  phone(body(staffBar('timeline') + timeline(spinner)), { label: 'before — a spinner' }) +
    phone(body(staffBar('timeline') + timeline(skeleton(4))), { label: 'after — the shape' }) +
    phone(body(staffBar('timeline') + timeline(loaded)), { label: 'loaded' }),
)}
${note(
  'Nine list-level spinners became skeletons: the timeline feed and both day views, the payment story, an action story, the suppressed-address card and the site editor’s photo grid. Eight more were a bare <code>ActivityIndicator</code> filling a whole screen while it booted, at four different colours including two hard-coded blues; they share one <code>Spinner</code> now, which is the ink-3 one. A spinner still has a job — a button or a card that is busy inside an otherwise-drawn page, where a skeleton would be the wrong shape.',
)}
${row(
  phone(body(staffBar('timeline') + timeline(oldEmpty('Nothing here yet', 'As things happen — someone joins, asks about their membership, needs looking after — it shows up here.'))), {
    label: 'before — empty',
  }) +
    phone(
      body(
        staffBar('timeline') +
          timeline(
            emptyCard(
              'chat',
              'Nothing here yet',
              'As things happen — someone joins, asks about their membership, needs looking after — it shows up here.',
              'var(--accent-soft)',
            ),
          ),
      ),
      { label: 'after — empty' },
    ) +
    phone(
      body(
        staffBar('timeline') +
          timeline(
            emptyCard('clock', 'A quiet day', 'Nothing happened that was worth keeping.', 'var(--surface-2)'),
          ),
      ),
      { label: 'a quiet day — dark', dark: true },
    ),
)}
${note(
  'The empty states next to them came along: a floating line of centred text in 64px of nothing is now the same card the rest of the product uses, with the icon that says which kind of nothing it is. The two quiet-day sentences were one string each, doing the job of a title and a caption at once; they are split into the two halves the card draws.',
)}
`,
  });
