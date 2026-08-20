// Board 24 — the shared parts, as shipped.
//
// These are the components imported by most of the app: ChipButton in 54
// files, BackLink in 54, Input in 47. Migrating them changed what every
// screen looks like before any screen was edited, which is why they went
// first. Drawn with the classes that are in production.
import { ic, note, page, phone, pagehead, memberBar, row, staffBar } from './kit.mjs';

/* ---- the chip, and why the default changed ---- */

const chip = (label, icon, tone = '') =>
  `<span class="chip chip-sm ${tone}">${icon ? ic(icon, 12) : ''}${label}</span>`;

const toneRow = (name, chips, why) => `
  <div class="row g12" style="padding:12px 16px;border-top:1px solid var(--line)">
    <span class="lbl" style="width:78px;flex:none">${name}</span>
    <span class="row g6" style="width:230px;flex:none">${chips}</span>
    <span class="small grow" style="font-size:12.5px">${why}</span>
  </div>`;

const chips = `
<div class="card flush">
  <div class="row g12" style="padding:12px 16px">
    <span class="lbl" style="width:78px;flex:none">Tone</span>
    <span class="lbl" style="width:230px;flex:none">Looks like</span>
    <span class="lbl grow">When</span>
  </div>
  ${toneRow('neutral', chip('Copy', 'copy') + chip('Edit', 'edit') + chip('Share', 'share'), 'The default now. A chip is a repeated action by nature — three on a card, five down a list — and the accent belongs to the one action a page exists for.')}
  ${toneRow('primary', chip('Change', 'edit', 'chip-accent') + chip('View', 'right', 'chip-accent'), 'The chip that <i>is</i> the page’s action. Was the default; now it has to be asked for.')}
  ${toneRow('filled', chip('Share', 'share', 'chip-dark'), 'A single prominent chip. Takes the gym’s colour, with the label contrast-checked against it — a yellow brand no longer gets white-on-white.')}
  ${toneRow('amber', chip('Needs attention', 'warn', 'chip-warn'), 'Something is off but nothing has broken.')}
  ${toneRow('red', chip('Remove', 'trash', 'chip-bad'), 'Destructive. Carries a warning haptic, not a tap.')}
  ${toneRow('inverse', chip('Auto-fill', 'sparkle', 'chip-dark'), 'Ink fill for emphasis without competing with the brand.')}
</div>`;

/* ---- the four states ---- */

const stateCard = (title, body, foot, tint) => `
  <div class="card" style="padding:22px 18px;align-items:center;text-align:center;gap:10px;display:flex;flex-direction:column">
    <span style="width:46px;height:46px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:${tint}">${body.icon}</span>
    <span class="h3" style="font-size:15px">${title}</span>
    <span class="small dim" style="font-size:12.5px;line-height:1.45">${body.text}</span>
    ${foot}
  </div>`;

const skeleton = `
  <div class="card flush">
    ${[0, 1, 2]
      .map(
        (i) => `<div class="row g12" style="padding:13px 14px;${i ? 'border-top:1px solid var(--line)' : ''}">
        <span style="width:32px;height:32px;border-radius:999px;background:var(--surface-2);flex:none"></span>
        <span class="stack g6 grow"><span style="height:11px;width:34%;border-radius:999px;background:var(--surface-2);display:block"></span>
        <span style="height:9px;width:58%;border-radius:999px;background:var(--surface-2);display:block"></span></span>
      </div>`,
      )
      .join('')}
  </div>`;

const states = `
<div class="row g14" style="align-items:stretch">
  <div class="stack g8 grow" style="min-width:0">
    <span class="frame-label">empty</span>
    ${stateCard('No members yet', { icon: ic('people', 22, 'color:var(--accent)'), text: 'Invite your first and they land on a branded join page.' }, '<span class="btn btn-accent btn-sm btn-full">Invite a member</span>', 'var(--accent-soft)')}
  </div>
  <div class="stack g8 grow" style="min-width:0">
    <span class="frame-label">nothing matches</span>
    ${stateCard('Nothing matches', { icon: ic('search', 22, 'color:var(--ink-3)'), text: '214 members, none called “zzz”. The list is fine; the filter is not.' }, '<span class="btn btn-plain btn-sm btn-full">Clear filters</span>', 'var(--surface-2)')}
  </div>
  <div class="stack g8 grow" style="min-width:0">
    <span class="frame-label">loading</span>
    <div class="card" style="padding:14px">${skeleton}</div>
  </div>
  <div class="stack g8 grow" style="min-width:0">
    <span class="frame-label">failed</span>
    ${stateCard('That did not load', { icon: ic('warn', 22, 'color:var(--bad)'), text: 'Could not load members.' }, '<span class="btn btn-plain btn-sm btn-full">Try again</span>', 'var(--bad-soft)')}
  </div>
</div>`;

export function partsBoard() {
  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="card" style="padding:20px 22px">
    <span class="lbl">Shipped</span>
    <div class="h2" style="margin-top:8px;font-size:19px">Eight components, and most of the app changed.</div>
    <div class="small" style="margin-top:8px;font-size:13.5px;max-width:780px">
      ChipButton is imported by 54 files, BackLink by 54, Input by 47. They
      went before any page did, because a page migration that starts with
      the shared parts already right is only about structure.
      <br><br>
      The four icon tints — iconPrimary, iconSecondary, iconTertiary,
      iconInverse — are gone. They held their own greys off the ramp, and
      iconSecondary was the same grey in both schemes, so a dim icon in
      dark mode was dim against the wrong ground. 193 call sites now take
      ink, ink-2 or ink-3 like everything else.
    </div>
  </div>

  <div class="lbl" style="margin-top:26px">The chip, and why its default changed</div>
  <div style="margin-top:10px">${chips}</div>

  <div class="lbl" style="margin-top:26px">The four states every list owes you</div>
  <div style="margin-top:10px">${states}</div>
  ${note('These were one component with one shape. The distinction that matters is the first two: “No members yet — invite your first”, shown to an owner with 214 members and a search box reading “zzz”, is the system telling them something false.')}
</div>`;

  return page({
    title: 'The shared parts',
    sub: 'Phase 1 of the migration: the components imported by most of the app, drawn with the classes that are in production.',
    content,
  });
}
