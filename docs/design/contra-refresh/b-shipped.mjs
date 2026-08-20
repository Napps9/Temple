// Board 22 — the modals that actually shipped.
//
// Boards 01-21 are the proposal. This one is the record: ten modals moved
// onto the one Sheet component in production, drawn with their real copy
// and their real footers, in the screen each is opened from. If a caption
// here disagrees with the app, the app is right and this is stale.
import {
  AV,
  avstack,
  checkbox,
  chips,
  dialog,
  dot,
  ic,
  listrow,
  memberBar,
  note,
  page,
  pagehead,
  phone,
  radio,
  row,
  sheet,
  staffBar,
  subBar,
  sw,
  TYPE,
} from './kit.mjs';

const dimmed = (inner) => `<div class="scrollarea" style="opacity:.5">${inner}</div>`;

/* ---- 1. Cancel a class: the destructive shape, with scope ---- */

const scopeOption = (on, label, effect, detail) => `
  <div class="card" style="padding:12px;border-radius:var(--r-ctl);${
    on ? 'border-color:var(--ink);background:var(--surface-2)' : ''
  }">
    <div class="row g8">${radio(on)}<span class="h3" style="font-size:14px">${label}</span></div>
    <div class="small" style="margin:4px 0 0 26px;font-size:12.5px">${effect}</div>
    <div class="small dim" style="margin:2px 0 0 26px;font-size:12.5px">${detail}</div>
  </div>`;

const cancelSheet = sheet({
  title: 'Cancel Metcon?',
  sub: 'Thursday 21 August, 17:30 · 60 min',
  body: `
  <div class="stack g12">
    <div class="small" style="font-size:13.5px">
      Members lose access to this class. Credit-pack and comp credits are
      refunded automatically. Members on unlimited plans don’t lose anything.
    </div>
    <div class="stack g8">
      ${scopeOption(true, 'Just this one', 'The rest of the series keeps running', '17 bookings · 3 waitlisted')}
      ${scopeOption(false, 'This and all future', 'Any sessions in this series before Thursday 21 August will not be cancelled', 'Tuesdays and Thursdays at 17:30, from this date onward')}
      ${scopeOption(false, 'The whole series', 'Past sessions kept as history; the recurring schedule is removed', 'Tuesdays and Thursdays at 17:30')}
    </div>
  </div>`,
  actions: `<span class="btn btn-plain">Keep it</span><span class="btn btn-bad" style="flex:1.4">Cancel class</span>`,
});

const classesBehind = `
  ${staffBar('classes')}
  ${dimmed(`
    ${pagehead('Classes', 'Week of 18 August')}
    ${chips([['Week', true], ['Month', false], ['Closures', false]])}
    <div style="padding:0 16px">
      ${listrow({ lead: dot(TYPE.strength), title: 'Strength', sub: 'Thu 21 Aug · 06:00 · Priya', right: '12/16', ruled: false })}
      ${listrow({ lead: dot(TYPE.metcon), title: 'Metcon', sub: 'Thu 21 Aug · 17:30 · Priya', right: '17/20', ruled: false })}
      ${listrow({ lead: dot(TYPE.open), title: 'Open gym', sub: 'Thu 21 Aug · 19:00', right: '4/30', ruled: false })}
    </div>`)}
  ${cancelSheet}`;

/* ---- 2. Remove a member: consequence as a table ---- */

const countRow = (label, value, zero) => `
  <div class="row between" style="padding:10px 14px;border-top:1px solid var(--line)">
    <span class="small" style="font-size:13.5px">${label}</span>
    <span class="${zero ? 'small dim' : 'strong'}" style="font-size:13.5px">${value}</span>
  </div>`;

const removeSheet = sheet({
  title: 'Remove Ana Ruiz from the gym?',
  body: `
  <div class="stack g12">
    <div class="small" style="font-size:14px">
      They lose access to bookings, eligibility, and any active subscriptions
      or comp grants. History is preserved — you can restore them from the
      archived view, but subscriptions and comps have to be re-issued.
    </div>
    <div class="card flush">
      <div class="row between" style="padding:10px 14px"><span class="small" style="font-size:13.5px">Future bookings</span><span class="strong" style="font-size:13.5px">3</span></div>
      ${countRow('Active subscriptions', '1')}
      ${countRow('Active comp grants', '0', true)}
      ${countRow('Waitlist entries', '2')}
    </div>
  </div>`,
  actions: `<span class="btn btn-plain">Keep them</span><span class="btn btn-bad" style="flex:1.4">Remove</span>`,
});

const memberBehind = `
  ${staffBar('manage')}
  ${dimmed(`
    ${subBar('Ana Ruiz')}
    <div style="padding:0 16px">
      <div class="card" style="padding:16px">
        <div class="row g12">${AV('AR', 44)}<div class="stack g2 grow">
          <span class="h2" style="font-size:18px">Ana Ruiz</span>
          <span class="small dim" style="font-size:13px">Member since March 2024</span>
        </div><span class="chip chip-sm chip-ok">Active</span></div>
      </div>
      <div style="height:8px"></div>
      ${listrow({ title: 'Unlimited monthly', sub: 'Renews 1 September · £68', ruled: false })}
      ${listrow({ title: 'Attendance', sub: '11 classes in the last 30 days', ruled: false })}
    </div>`)}
  ${removeSheet}`;

/* ---- 3. Pick classes to cover: the tick list ---- */

const pickRow = (on, title, sub, first) => `
  <div class="row g12" style="padding:11px 14px;${first ? '' : 'border-top:1px solid var(--line)'}">
    ${checkbox(on)}
    <div class="stack g2 grow" style="min-width:0">
      <span class="h3" style="font-size:14.5px">${title}</span>
      <span class="small dim" style="font-size:12.5px">${sub}</span>
    </div>
  </div>`;

const coverSheet = sheet({
  title: 'Pick classes you need covered',
  sub: 'Coaches at this gym will see and claim them',
  body: `<div class="card flush">
    ${pickRow(true, 'Metcon', 'Thu 21 Aug at 17:30 · 60 min', true)}
    ${pickRow(true, 'Strength', 'Fri 22 Aug at 06:00 · 60 min')}
    ${pickRow(false, 'Open gym', 'Fri 22 Aug at 19:00 · 90 min')}
    ${pickRow(false, 'Metcon', 'Tue 26 Aug at 17:30 · 60 min')}
  </div>`,
  actions: `<span class="btn btn-plain">Cancel</span><span class="btn btn-accent" style="flex:1.4">Request cover (2)</span>`,
});

const timelineBehind = `
  ${staffBar('timeline')}
  ${dimmed(`
    ${pagehead('Timeline', 'Thursday 21 August')}
    <div style="padding:0 16px">
      ${listrow({ lead: AV('PR', 30), title: 'Priya Raman', sub: 'Asked for cover on Friday 06:00', ruled: false })}
      ${listrow({ lead: AV('TM', 30), title: 'Tom Mercer', sub: 'Claimed Wednesday 19:00 Open gym', ruled: false })}
    </div>`)}
  ${coverSheet}`;

/* ---- 4. Jump to a date: the month grid, now a sheet ---- */

const monthCell = (n, state) => `
  <div style="flex:1;display:flex;justify-content:center;padding:1px 0">
    <span style="width:36px;height:36px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:14px;${
      state === 'sel'
        ? 'background:var(--accent);color:var(--accent-ink);font-weight:700'
        : state === 'today'
          ? 'border:1px solid var(--accent);color:var(--accent);font-weight:700'
          : state === 'out'
            ? 'color:var(--ink-3);opacity:.5'
            : 'color:var(--ink)'
    }">${n}</span>
  </div>`;

const monthWeek = (cells) => `<div class="row">${cells.map(([n, s]) => monthCell(n, s)).join('')}</div>`;

const monthSheet = sheet({
  title: 'Jump to a date',
  body: `
  <div class="stack g8" style="padding-bottom:8px">
    <div class="row between">
      <span class="chip" style="width:36px;height:36px;padding:0;justify-content:center;border-radius:999px">‹</span>
      <span class="h3" style="font-size:15px">August 2026</span>
      <span class="chip" style="width:36px;height:36px;padding:0;justify-content:center;border-radius:999px">›</span>
    </div>
    <div class="row">${['M', 'T', 'W', 'T', 'F', 'S', 'S']
      .map((l) => `<div style="flex:1;text-align:center"><span class="lbl" style="font-size:11px">${l}</span></div>`)
      .join('')}</div>
    ${monthWeek([[27, 'out'], [28, 'out'], [29, 'out'], [30, 'out'], [31, 'out'], [1, ''], [2, '']])}
    ${monthWeek([[3, ''], [4, ''], [5, ''], [6, ''], [7, ''], [8, ''], [9, '']])}
    ${monthWeek([[10, ''], [11, ''], [12, ''], [13, ''], [14, ''], [15, ''], [16, '']])}
    ${monthWeek([[17, ''], [18, 'today'], [19, ''], [20, ''], [21, 'sel'], [22, ''], [23, '']])}
    ${monthWeek([[24, ''], [25, ''], [26, ''], [27, ''], [28, ''], [29, ''], [30, '']])}
    ${monthWeek([[31, ''], [1, 'out'], [2, 'out'], [3, 'out'], [4, 'out'], [5, 'out'], [6, 'out']])}
  </div>`,
});

const bookBehind = `
  ${memberBar('book')}
  ${dimmed(`
    ${pagehead('Book', 'Thursday 21 August')}
    ${chips([['All', true], ['Strength', false, dot(TYPE.strength)], ['Metcon', false, dot(TYPE.metcon)]])}
    <div style="padding:0 16px">
      ${listrow({ lead: dot(TYPE.strength), title: 'Strength', sub: '06:00 · Priya · 12/16', ruled: false })}
      ${listrow({ lead: dot(TYPE.metcon), title: 'Metcon', sub: '17:30 · Priya · 17/20', ruled: false })}
    </div>`)}
  ${monthSheet}`;

/* ---- 5. The same modal as a desktop dialog ---- */

const modeOption = (on, title, blurb, amount) => `
  <div class="card" style="padding:12px;border-radius:var(--r-ctl);${
    on ? 'border-color:var(--ink);background:var(--surface-2)' : ''
  }">
    <div class="row between g8">
      <span class="h3 grow" style="font-size:14px">${title}</span>
      <span class="strong" style="font-size:14px">${amount}</span>
    </div>
    <div class="small dim" style="margin-top:2px;font-size:12.5px">${blurb}</div>
  </div>`;

const refundDialog = dialog({
  title: 'Refund Unlimited monthly',
  sub: 'Last payment £68.00',
  width: 560,
  body: `
  <div class="stack g10">
    ${modeOption(true, 'Refund the unused part & end now', 'Give back what they haven’t used, cut access immediately, stop renewals.', '£24.13')}
    ${modeOption(false, 'Full refund, keep access to period end', 'Refund in full but let them finish the period they paid for, then it ends.', '£68.00')}
    ${modeOption(false, 'Full refund & end now', 'Refund in full and cut access immediately.', '£68.00')}
    ${modeOption(false, 'Refund & keep access', 'Goodwill — money back, membership and renewals carry on unchanged.', '£68.00')}
    <div class="card" style="padding:12px 14px">
      <div class="row g12">
        <div class="stack g2 grow">
          <span class="h3" style="font-size:14px">Email the member</span>
          <span class="small dim" style="font-size:12.5px">Send a note telling them they’ve been refunded and what happens to their access.</span>
        </div>
        ${sw(true)}
      </div>
    </div>
  </div>`,
  actions: `<span class="btn btn-plain">Cancel</span><span class="btn btn-bad">Refund £24.13</span>`,
});

/* ---- 6. What moved, as a ledger ---- */

const LEDGER = [
  ['ConfirmDialog', 'ten call sites', 'Already through Sheet in the first push'],
  ['CancelClassDialog', 'staff · Classes', 'Title now asks; confirm is outlined red'],
  ['RemoveMemberDialog', 'staff · Members', 'Title now asks; the safe option is named'],
  ['RefundDialog', 'staff · Money', 'Gained a close button and a backdrop that dismisses'],
  ['ReopenClosureModal', 'staff · Closures', 'Day/slot ticks became one ruled card'],
  ['CoverRangeModal', 'staff · Timeline', 'Same'],
  ['SessionPickerModal', 'staff · Timeline', 'Same'],
  ['MemberPickerSheet', 'staff · Comms', 'Was a sheet at every width; now a dialog on desktop'],
  ['ClassLeaderboardModal', 'member · Programming', 'Rows became a ruled card'],
  ['MonthPickerModal', 'both calendars', 'Was a floating grid with no title'],
  ['InviteQRModal', 'staff · Members', 'Lost its coloured header bar'],
];

export function shippedModalsBoard() {
  const ledger = `
  <div class="card flush" style="margin-top:20px">
    ${LEDGER.map(
      ([name, where, what], i) => `
      <div class="row g12" style="padding:11px 16px;${i ? 'border-top:1px solid var(--line)' : ''}">
        <span class="h3" style="font-size:14px;width:210px;flex:none">${name}</span>
        <span class="small dim" style="font-size:12.5px;width:170px;flex:none">${where}</span>
        <span class="small grow" style="font-size:12.5px">${what}</span>
      </div>`,
    ).join('')}
  </div>`;

  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="card" style="padding:20px 22px">
    <span class="lbl">Shipped</span>
    <div class="h2" style="margin-top:8px;font-size:19px">Ten modals moved onto the one Sheet.</div>
    <div class="small" style="margin-top:8px;font-size:13.5px;max-width:760px">
      Every one of these was a centred card with a dimmed backdrop at every
      width. They are now bottom sheets under 768px and dialogs at 768 and up,
      from a single component — so a phone gets the grabber, the thumb-reach
      footer and the keyboard behaviour without any caller asking for them.
      Two destructive ones were also rewritten to the rule: the title asks the
      question, the body carries the consequence, red appears once, and the
      safe way out is named rather than called “Cancel”.
    </div>
  </div>

  ${row(
    `${phone(classesBehind, { label: 'Cancel a class — destructive, with scope' })}
     ${phone(memberBehind, { label: 'Remove a member — the consequence is a table' })}
     ${phone(timelineBehind, { label: 'Request cover — the shared tick box' })}
     ${phone(bookBehind, { label: 'Jump to a date — was a floating grid' })}`,
    'margin-top:20px;gap:22px;flex-wrap:wrap;justify-content:center',
  )}

  ${note(
    'The tick box is one component now, not four. It fills with ink rather than the gym’s brand colour: a ticked row is a state, and the accent is spent on the one thing the sheet exists to do.',
  )}

  <div class="stack g14" style="margin-top:26px">
    <span class="frame-label">The same modal at 768 and up — a dialog, same title, same body, same actions, same order</span>
    <div style="background:var(--surface-3);border-radius:16px;padding:34px;display:flex;justify-content:center">
      ${refundDialog}
    </div>
  </div>

  <div class="lbl" style="margin-top:26px">What moved</div>
  ${ledger}
</div>`;

  return page({
    title: 'The modals that shipped',
    sub: 'Ten components, one Sheet. Drawn with the copy and the footers that are in production, in the screen each one opens from.',
    content,
  });
}
