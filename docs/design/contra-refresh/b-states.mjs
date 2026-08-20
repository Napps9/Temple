// Boards 19-20: the states every pattern needs, and the comparison.
import {
  ic, icf, AV, avstack, orb, TYPE,
  page, phone, row, sheet, listrow, emptyState, gymTile, dot, skel,
  memberBar, staffBar, subBar, pagehead, lbl, chips, segmented, stat, divider,
} from './kit.mjs';
import { WIDE, bookScreen } from './b-member.mjs';

/* ============================================================== 19 states */

export function statesBoard() {
  const firstRun = () => `
${staffBar('timeline')}
<div class="scrollarea">
  <div class="row" style="justify-content:center;gap:2px;padding:4px 0 6px">
    <span style="color:var(--ink-3)">${ic('left', 16)}</span>
    <span class="h3" style="font-size:15px;padding:0 8px">Today</span>
    <span style="color:var(--ink-3)">${ic('right', 16)}</span>
  </div>
  ${emptyState({
    icon: 'chat',
    title: 'Nothing has happened yet',
    body: 'As people join, book, pay or need looking after, it shows up here — newest at the bottom, like a conversation.',
  })}
  <div style="padding:0 16px">
    <div class="card">
      <div class="row between"><span class="lbl">Get the gym open</span><span class="small num" style="font-size:12.5px">2 of 6</span></div>
      <div class="bar" style="margin-top:10px"><i style="width:33%"></i></div>
      <div class="stack g2" style="margin-top:14px">
        ${[['Name the gym and pick a colour', true], ['Connect Stripe', true], ['Add your first plan', false], ['Write this week’s programming', false], ['Put classes on the calendar', false], ['Invite your members', false]]
          .map(([t, done]) => `
          <div class="row g10" style="padding:7px 0">
            <span class="check ${done ? 'on' : ''}" style="width:18px;height:18px">${done ? ic('check', 11) : ''}</span>
            <span class="small grow" style="font-size:13.5px;${done ? 'color:var(--ink-3);text-decoration:line-through' : 'color:var(--ink)'}">${t}</span>
            ${done ? '' : ic('right', 14, 'color:var(--ink-3)')}
          </div>`).join('')}
      </div>
    </div>
  </div>
  <div style="padding:14px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(20)}
        <span class="small grow" style="font-size:12.5px;line-height:1.45;color:var(--ink)">I can write the first four weeks of programming from a couple of questions, if that would help.</span></div>
      <div class="row g6" style="margin-top:11px"><span class="chip chip-sm">Go on then</span><span class="chip chip-sm">I'll do it</span></div>
    </div>
  </div>
</div>
<div class="stack g8" style="padding:8px 16px 6px">
  <div class="glow"><div class="field"><span class="grow trunc">Show me a member, change a class…</span>
    <span class="btn btn-dark btn-sm" style="padding:0 12px 0 8px">${orb(17)}Go</span></div></div>
</div>`;

  const noMatch = () => `
${staffBar('manage')}
<div class="scrollarea">
  ${pagehead('Members', '214 active · 6 joined this month', `<span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Invite</span>`)}
  <div style="padding:0 16px 12px"><div class="field" style="min-height:40px;padding-left:14px;font-size:14px">${ic('search', 15, 'color:var(--ink-3)')}<span class="grow" style="color:var(--ink)">okonkwo</span>${ic('close', 14, 'color:var(--ink-3)')}</div></div>
  ${chips([['All', false], ['Lapsing', true], ['New', false], ['Owing', false]], '0 16px 12px')}
  ${emptyState({
    icon: 'search',
    title: 'No lapsing member called “okonkwo”',
    body: 'Two filters are on. Clearing the Lapsing filter would search all 214 members instead of 42.',
    action: `<div class="row g8"><span class="btn btn-plain btn-sm">Clear filters</span><span class="btn btn-dark btn-sm">Search everyone</span></div>`,
  })}
</div>`;

  const loading = () => `
${memberBar('book')}
<div class="scrollarea">
  <div class="row g4" style="padding:2px 14px 12px">
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<div class="daycell ${i === 3 ? 'on' : ''}"><span class="skel" style="width:9px;height:8px"></span><span class="skel" style="width:16px;height:12px;margin-top:2px"></span></div>`).join('')}
  </div>
  <div class="row g6" style="padding:0 16px 14px">${[36, 58, 52, 62].map((w) => `<span class="skel" style="width:${w}px;height:24px;border-radius:99px"></span>`).join('')}</div>
  <div style="padding:0 16px 14px"><div class="card" style="padding:13px 14px"><span class="skel" style="width:84px;height:8px"></span><span class="skel" style="width:60%;height:14px;margin-top:9px"></span></div></div>
  <div style="padding:0 16px 10px"><span class="skel" style="width:120px;height:9px"></span></div>
  ${[0, 1, 2, 3].map(() => `
    <div class="row g12" style="padding:0 16px 10px;align-items:stretch">
      <div style="width:44px;flex:none;padding-top:14px;text-align:right"><span class="skel" style="width:38px;height:12px;margin-left:auto"></span></div>
      <div class="card grow" style="padding:12px 13px">
        <div class="row g8"><span class="skel" style="width:7px;height:7px;border-radius:99px"></span><span class="skel" style="width:38%;height:11px"></span><span class="grow"></span><span class="skel" style="width:56px;height:24px;border-radius:99px"></span></div>
        <div class="row between" style="margin-top:11px"><span class="skel" style="width:52%;height:9px"></span><span class="skel" style="width:52px;height:20px;border-radius:99px"></span></div>
      </div>
    </div>`).join('')}
</div>`;

  const errored = () => `
${memberBar('book')}
<div style="padding:0 16px 10px">
  <div class="card" style="padding:10px 12px;background:var(--surface-2);border-color:transparent">
    <div class="row g10">${ic('wifi', 16, 'color:var(--ink-3)')}<span class="small grow" style="font-size:12.5px">You are offline. This is what we had at 09:41.</span></div>
  </div>
</div>
<div class="scrollarea">
  ${emptyState({
    icon: 'refresh',
    title: 'Could not load Thursday',
    body: 'The gym’s schedule did not come back. Nothing you have booked is affected — this is only the list.',
    action: `<div class="row g8"><span class="btn btn-dark btn-sm">${ic('refresh', 14)}Try again</span><span class="btn btn-plain btn-sm">My bookings</span></div>`,
  })}
  <div style="padding:0 16px">
    ${lbl('Still available offline')}
    <div class="ruled">
      ${listrow({ lead: dot(TYPE.metcon), title: 'Thu 21 Aug · 07:15 Metcon', sub: 'You are booked in', chip: `<span class="chip chip-sm chip-ok">${ic('check', 11)}Booked</span>`, right: '' })}
      ${listrow({ lead: dot(TYPE.metcon), title: 'Thu 21 Aug · 18:00 Metcon', sub: 'You are booked in', chip: `<span class="chip chip-sm chip-ok">${ic('check', 11)}Booked</span>`, right: '' })}
    </div>
  </div>
</div>`;

  return page({
    title: 'The states every pattern owes you',
    sub: 'Four different things, four different screens. “Nothing yet” teaches; “nothing matches” names the filter that is hiding things and offers to widen it; loading holds the exact shape of what is coming; failure says what is unaffected and what you can still do.',
    extraCss: WIDE,
    content: row(
      phone(firstRun(), { label: 'Nothing yet — first run' }) +
      phone(noMatch(), { label: 'Nothing matches' }) +
      phone(loading(), { label: 'Loading' }) +
      phone(errored(), { label: 'Failed · offline' }),
    ),
  });
}

/* ======================================================== 20 before/after */

export function beforeAfterBoard() {
  const legacy = () => `
<div class="scrollarea">
  <div class="row g8" style="padding:10px 12px 12px">
    <div class="row g8 grow"><div style="width:36px;height:36px;border-radius:999px;background:#3b6ba5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">F</div></div>
    <div class="lseg"><span>${ic('barbell', 15)}</span><span class="on">${ic('cal', 15)}Book</span><span>${ic('trend', 15)}</span></div>
    <div class="row g8 grow" style="justify-content:flex-end">
      <span style="display:inline-flex;align-items:center;height:30px;padding:0 10px;border-radius:999px;border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.1);color:#10b981">${ic('cal', 13)}</span>
      <div style="width:30px;height:30px;border-radius:999px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#6b7280">AN</div>
    </div>
  </div>
  <div class="row" style="padding:0 10px 12px;gap:2px">
    ${[['M', 18], ['T', 19], ['W', 20], ['T', 21], ['F', 22], ['S', 23], ['S', 24]]
      .map(([d, n], i) => `<div class="ldaycell ${i === 3 ? 'on' : ''} ${i === 2 ? 'today' : ''}"><span class="d">${d}</span><span class="n">${n}</span></div>`).join('')}
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
      <div class="grow"><div class="lmicro">Recommended</div><div style="font-size:14px;font-weight:500">Thursday 21 Aug at 17:30</div></div>
      <span class="lchip">Quick book</span>
    </div>
    <div class="lcard" style="padding:12px;display:flex;align-items:center;gap:12px">
      <div style="width:32px;height:32px;border-radius:8px;background:var(--l-inset);display:flex;align-items:center;justify-content:center;color:#6b7280">${ic('cal', 16)}</div>
      <div class="grow"><div class="lmicro">Your next class</div><div style="font-size:14px;font-weight:500">Thursday 21 Aug at 18:00</div></div>
      ${ic('right', 15, 'color:#9ca3af')}
    </div>
  </div>
  <div class="stack g10" style="padding:0 12px">
    ${[['06:00', '60 min', 'Strength', '#e11d48', 'Dani Okafor', '8 spots left', '#059669', 'book', ''],
       ['07:15', '45 min', 'Metcon', '#6366f1', 'Dani Okafor', 'Booked in', '#059669', 'booked', 'border:1px solid #34d399'],
       ['12:00', '90 min', 'Open Gym', '#0f766e', '', '14 spots left', '#059669', 'book', ''],
       ['17:30', '45 min', 'Metcon', '#6366f1', 'Priya Raman', '3 spots left', '#d97706', 'book', 'border:1px solid #c084fc'],
       ['18:45', '60 min', 'Barbell Club', '#7c3aed', 'Marcus Bell', 'Full', '#9ca3af', 'full', '']]
      .map(([t, d, n, c, coach, st, stc, kind, extra]) => `
      <div class="lcard bordered" style="display:flex;align-items:center;gap:12px;padding:14px;${extra || 'border:1px solid var(--l-line)'}">
        <div style="width:56px"><div style="font-size:17px;font-weight:800">${t}</div><div style="font-size:11px;color:var(--l-ink3);margin-top:2px">${d}</div></div>
        <div class="grow" style="min-width:0">
          <div class="row g8"><i class="dot" style="background:${c}"></i><span style="font-size:14.5px;font-weight:600" class="trunc">${n}</span></div>
          <div style="margin-top:4px;font-size:12px;color:var(--l-ink2)">${coach ? `with ${coach} · ` : ''}<span style="color:${stc};font-weight:600">${st}</span></div>
        </div>
        ${kind === 'booked'
          ? `<span style="display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:6px 12px;background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;font-size:11px;font-weight:700">${ic('check', 13)}Booked</span>`
          : kind === 'full'
            ? `<span style="border-radius:999px;padding:8px 16px;background:var(--l-inset);color:var(--l-ink2);font-size:11px;font-weight:700">Waitlist</span>`
            : `<span class="lpill">Book</span>`}
      </div>`).join('')}
  </div>
</div>`;

  return page({
    extraCss: WIDE,
    title: 'Before / after — member Book',
    sub: 'Same data, same routes. Cool slate becomes cool white, shadows become hairlines, the brand blue stops filling the day pill and the Book button and the filter chip all at once, and every row gains the faces of the people already in the class.',
    content: row(
      phone(legacy(), { legacy: true, label: 'Today' }) +
      phone(bookScreen(), { label: 'Proposed' }) +
      phone(legacy(), { legacy: true, dark: true, label: 'Today · dark' }) +
      phone(bookScreen(), { dark: true, label: 'Proposed · dark' }),
    ),
  });
}
