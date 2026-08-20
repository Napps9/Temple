// Boards 12-18: the staff side, as instances of the same eight patterns.
import {
  ic, icf, lockup, AV, avstack, orb, MEDIA, TYPE,
  page, phone, row, sheet, dialog, field, sw, radio, checkbox, listrow, setting,
  staffBar, subBar, pagehead, lbl, chips, segmented, tabs, stat, divider,
  emptyState, gymTile, dot, skel,
} from './kit.mjs';
import { WIDE } from './b-member.mjs';

/* ============================================================ 12 timeline */

export function timelineBoard() {
  const receipt = (icon, text, time) => `
  <div class="row g10" style="align-items:flex-start">
    <span style="color:var(--ink-3);margin-top:1px">${ic(icon, 15)}</span>
    <div class="grow small" style="font-size:13.5px;line-height:1.42">${text}</div>
    <span class="lbl" style="letter-spacing:.05em;margin-top:2px">${time}</span>
  </div>`;

  const timeline = () => `
${staffBar('timeline')}
<div class="scrollarea">
  <div class="row" style="justify-content:center;gap:2px;padding:4px 0 6px">
    <span style="color:var(--ink-3)">${ic('left', 16)}</span>
    <span class="h3" style="font-size:15px;padding:0 8px">Today</span>
    <span style="color:var(--ink-3)">${ic('right', 16)}</span>
  </div>
  <div class="stack g10" style="padding:2px 16px 0">
    ${receipt('person', '<b class="strong">Marcus Bell</b> joined on Unlimited.', '07:12')}
    ${receipt('check', '<b class="strong">Priya Raman</b> took tonight’s 18:45 cover.', '08:40')}
    ${receipt('mail', 'Newsletter went out — 61% opened.', '09:05')}
  </div>
  <div class="row g8" style="padding:13px 16px 8px">
    <span class="lbl" style="color:var(--ink)">Waiting on you</span>
    <span class="badge" style="background:var(--warn-soft);color:var(--warn)">2</span>
  </div>
  <div class="stack" style="padding:0 16px;gap:9px">
    <div class="card lift" style="padding:13px">
      <div class="row g10"><span style="color:var(--warn)">${ic('card', 17)}</span><span class="h3 grow">Amara Nwosu's payment failed</span></div>
      <div class="body" style="font-size:13.5px;margin-top:7px">£48 on the 3rd. Her card expired last month — she has trained four times since.</div>
      <div class="row g8" style="margin-top:13px"><span class="btn btn-dark btn-sm">Ask her to update it</span><span class="btn btn-plain btn-sm">See the details</span></div>
    </div>
    <div class="card" style="padding:13px">
      <div class="row g10">${AV('je', 26)}<span class="h3 grow">Jonah Ellis wants to join</span><span class="lbl" style="letter-spacing:.05em">11:20</span></div>
      <div class="body" style="font-size:13.5px;margin-top:7px">From the join link. No plan picked yet — Unlimited is what most take.</div>
      <div class="row g8" style="margin-top:13px"><span class="btn btn-dark btn-sm">Approve on Unlimited</span><span class="btn btn-plain btn-sm">Not yet</span></div>
    </div>
  </div>
  <div class="row g8" style="padding:13px 16px 8px"><span class="lbl">With me</span><span class="badge">1</span></div>
  <div style="padding:0 16px">
    <div class="card" style="padding:13px;background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(24)}
        <div class="grow">
          <div class="body" style="font-size:13.5px;color:var(--ink)">I've asked <b class="strong">Sam Whitlock</b> to update his card, and I'll chase again Friday.</div>
          <div class="row g6" style="margin-top:11px"><span class="chip chip-sm">${ic('clock', 12)}Chased 2 days ago</span><span class="chip chip-sm">Hand it back to me</span></div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="stack g8" style="padding:8px 16px 6px">
  <div class="row g6">
    <span class="chip chip-sm">${ic('doc', 12)}Your rules</span>
    <span class="chip chip-sm">${ic('people', 12)}The team</span>
    <span class="chip chip-sm">${ic('flag', 12)}Goals</span>
  </div>
  <div class="glow"><div class="field"><span class="grow trunc">Show me a member, change a class…</span>
    <span class="btn btn-dark btn-sm" style="padding:0 12px 0 8px">${orb(17)}Go</span></div></div>
</div>`;

  const rules = () => `
${staffBar('timeline')}
<div class="scrollarea" style="opacity:.5">
  <div class="stack g10" style="padding:14px 16px 0">${[0, 1, 2].map(() => `<div class="card" style="height:56px"></div>`).join('')}</div>
</div>
${sheet({
  title: 'Your rules',
  sub: 'What I may do without asking you first',
  body: `
    <div class="stack g10">
      ${[['Chase a failed payment', 'Email the member, twice, four days apart.', true],
         ['Approve a join request', 'Only on the plan most members take.', false],
         ['Fill a cover shift', 'Ask the team in seniority order, then tell you.', true],
         ['Send a newsletter', 'Draft it — never send without you.', false]]
        .map(([t, d, on]) => `
        <div class="card" style="padding:13px">
          <div class="row g12" style="align-items:flex-start">
            <div class="stack g2 grow"><span class="h3" style="font-size:14px">${t}</span><span class="small dim" style="font-size:12.5px;line-height:1.4">${d}</span></div>
            ${sw(on)}
          </div>
        </div>`).join('')}
    </div>
    <div class="card" style="margin-top:12px;padding:13px;background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(20)}
        <span class="small grow" style="font-size:12.5px;line-height:1.45;color:var(--ink)">Anything switched off still reaches you — it lands in "Waiting on you" with what I would have done.</span></div>
    </div>`,
  actions: `<span class="btn btn-plain">Cancel</span><span class="btn btn-dark" style="flex:1.4">Save rules</span>`,
})}`;

  const pastDay = () => `
${staffBar('timeline')}
<div class="scrollarea">
  <div class="row" style="justify-content:center;gap:2px;padding:4px 0 6px">
    <span style="color:var(--ink-3)">${ic('left', 16)}</span>
    <span class="h3" style="font-size:15px;padding:0 8px">Tue 19 Aug</span>
    <span style="color:var(--ink-3)">${ic('right', 16)}</span>
  </div>
  <div class="row" style="justify-content:center;padding:0 0 12px"><span class="chip chip-sm">${ic('clock', 11)}Back to today</span></div>
  <div class="stack g10" style="padding:0 16px">
    ${[['person', '<b class="strong">Leila Karim</b> moved to Unlimited from the 10-class pack.', '06:40'],
       ['check', 'All four classes ran. 61 of 72 spots filled.', '19:10'],
       ['card', '£1,240 collected from 26 subscriptions.', '09:00'],
       ['mail', 'Two lapsing members were nudged. One booked.', '11:15'],
       ['person', '<b class="strong">Tom Achebe</b> cancelled — moving to Bristol.', '14:02']]
      .map(([i, t, w]) => receipt(i, t, w)).join('')}
  </div>
  <div style="padding:20px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(20)}
        <span class="small grow" style="font-size:12.5px;line-height:1.45;color:var(--ink)">Nothing was left waiting on you on this day.</span></div>
    </div>
  </div>
</div>`;

  return page({
    title: 'Owner — Timeline: today, the rules, a past day',
    sub: 'Pattern 1, the Feed. Receipts are ruled lines; only a decision gets a card. A past day is the same feed with the composer removed — there is nothing left to say to a day that is over.',
    extraCss: WIDE,
    content: row(
      phone(timeline(), { dark: true, label: 'Today — dark' }) +
      phone(timeline(), { label: 'Today — light' }) +
      phone(rules(), { label: 'Your rules — sheet' }) +
      phone(pastDay(), { label: 'A past day' }),
    ),
  });
}

/* ============================================================== 13 classes */

export function classesBoard() {
  const classes = () => `
${staffBar('classes')}
<div class="scrollarea">
  <div class="row between" style="padding:2px 16px 12px">
    ${segmented(['Day', 'Week', 'Month'], 'Day')}
    <span class="btn btn-accent btn-sm">${ic('plus', 15)}Class</span>
  </div>
  <div class="row g4" style="padding:0 14px 12px">
    ${[['M', 18], ['T', 19], ['W', 20], ['T', 21], ['F', 22], ['S', 23], ['S', 24]]
      .map(([d, n], i) => `<div class="daycell ${i === 3 ? 'on' : ''} ${i === 2 ? 'today' : ''}"><span class="d">${d}</span><span class="n">${n}</span></div>`).join('')}
  </div>
  ${lbl('Thursday 21 August', '<span class="small dim" style="font-size:12.5px">61 of 72 booked</span>')}
  <div style="padding:0 16px">
    ${[['06:00', 'Strength', TYPE.strength, 'Dani Okafor', '12/20', 'ok', ['jm', 'ro', 'ka']],
       ['07:15', 'Metcon', TYPE.metcon, 'Dani Okafor', '18/20', 'ok', ['an', 'lk', 'tm']],
       ['12:00', 'Open Gym', TYPE.open, '—', '4/30', 'dim', ['sw']],
       ['17:30', 'Metcon', TYPE.metcon, 'Priya Raman', '17/20', 'ok', ['lk', 'mb', 'ro']],
       ['18:45', 'Barbell Club', TYPE.barbell, 'Marcus Bell', '20/20', 'warn', ['tm', 'jm', 'ka', 'bh']]]
      .map(([t, n, c, coach, cap, tone, who]) => `
      <div class="row g12" style="padding-bottom:8px;align-items:stretch">
        <div style="width:44px;flex:none;padding-top:13px;text-align:right"><div class="num" style="font-size:14.5px">${t}</div></div>
        <div class="card grow" style="padding:11px 12px">
          <div class="row g8">${dot(c)}<span class="h3 grow trunc">${n}</span>
            <span class="chip chip-sm ${tone === 'warn' ? 'chip-warn' : tone === 'dim' ? '' : 'chip-ok'}">${cap}</span>
          </div>
          <div class="row between" style="margin-top:8px">
            <span class="small dim trunc" style="font-size:12.5px">${coach}</span>${avstack(who, 21)}
          </div>
        </div>
      </div>`).join('')}
  </div>
  <div style="padding:6px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10">${ic('bolt', 16, 'color:var(--ink-3)')}<span class="small grow" style="font-size:12.5px">The 12:00 Open Gym has run under 5 for three weeks.</span><span class="chip chip-sm">Review</span></div>
    </div>
  </div>
</div>`;

  const createClass = () => `
${staffBar('classes')}
<div class="scrollarea" style="opacity:.5">
  <div class="row between" style="padding:2px 16px 12px">${segmented(['Day', 'Week', 'Month'], 'Day')}<span class="btn btn-accent btn-sm">${ic('plus', 15)}Class</span></div>
  <div style="padding:0 16px">${[0, 1, 2].map(() => `<div class="card" style="height:60px;margin-bottom:8px"></div>`).join('')}</div>
</div>
${sheet({
  title: 'New class',
  sub: 'Thursday 21 August',
  body: `
    <div class="stack g12">
      <div class="stack g6">
        <span class="lbl" style="letter-spacing:.06em">Type</span>
        <div class="row g6 wrap">
          <span class="chip chip-sm chip-on">${dot(TYPE.metcon)}Metcon</span>
          <span class="chip chip-sm">${dot(TYPE.strength)}Strength</span>
          <span class="chip chip-sm">${dot(TYPE.open)}Open Gym</span>
          <span class="chip chip-sm">${ic('plus', 11)}New type</span>
        </div>
      </div>
      <div class="row g10">
        <div class="grow">${field('Starts', '17:30')}</div>
        <div class="grow">${field('Length', '45 min')}</div>
        <div style="width:88px">${field('Cap', '20')}</div>
      </div>
      ${field('Coach', 'Priya Raman', { trail: ic('down', 15, 'color:var(--ink-3)') })}
      <div class="card" style="padding:13px">
        <div class="row g12" style="align-items:flex-start">
          <div class="stack g2 grow"><span class="h3" style="font-size:14px">Repeat weekly</span><span class="small dim" style="font-size:12.5px">Every Thursday until you stop it</span></div>
          ${sw(true)}
        </div>
      </div>
    </div>`,
  actions: `<span class="btn btn-plain">Cancel</span><span class="btn btn-accent" style="flex:1.4">Add class</span>`,
})}`;

  const roster = () => `
${subBar('17:30 Metcon', `<span class="chip chip-sm">${ic('pen', 12)}Edit</span>`)}
<div class="scrollarea">
  <div style="padding:2px 16px 12px">
    <div class="card">
      <div class="row g10">${dot(TYPE.metcon)}
        <div class="stack g2 grow"><span class="h3">Thursday 21 Aug · 17:30</span><span class="small dim" style="font-size:12.5px">45 min · Priya Raman</span></div>
        <span class="chip chip-sm chip-ok">17/20</span>
      </div>
      <div class="row g8" style="margin-top:13px">
        <span class="btn btn-dark btn-sm">${ic('check', 14)}Check in</span>
        <span class="btn btn-plain btn-sm">${ic('chat', 14)}Message</span>
        <span class="btn btn-plain btn-sm">${ic('plus', 14)}Add</span>
      </div>
    </div>
  </div>
  ${lbl('Booked in', '<span class="small dim" style="font-size:12.5px">9 checked in</span>')}
  <div style="padding:0 16px">
    <div class="ruled">
      ${[['Leila Karim', 'Unlimited', true, ''], ['Marcus Bell', 'Unlimited', true, ''],
         ['Amara Nwosu', 'Payment failed', false, 'bad'], ['Rosa Oduya', '10-class pack', true, ''],
         ['Tom Achebe', 'Unlimited', false, ''], ['Kai Mensah', 'Comp grant', false, 'warn']]
        .map(([n, p, inn, tone]) => `
        <div class="listrow">
          ${AV(n.split(' ').map((x) => x[0].toLowerCase()).join(''), 30)}
          <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:14px">${n}</span>
            <span class="small ${tone ? '' : 'dim'} trunc" style="font-size:12px;${tone === 'bad' ? 'color:var(--bad)' : tone === 'warn' ? 'color:var(--warn)' : ''}">${p}</span></div>
          <span class="check ${inn ? 'on' : ''}">${inn ? ic('check', 12) : ''}</span>
        </div>`).join('')}
    </div>
  </div>
  ${lbl('Waiting', '')}
  <div style="padding:0 16px">
    ${listrow({ lead: AV('bh', 30), title: 'Bea Hollins', sub: 'First in line since 14:20', chip: '<span class="chip chip-sm">Promote</span>', right: '' })}
  </div>
</div>`;

  const cancelSheet = () => `
${subBar('17:30 Metcon', `<span class="chip chip-sm">${ic('pen', 12)}Edit</span>`)}
<div class="scrollarea" style="opacity:.5">
  <div style="padding:2px 16px 12px"><div class="card" style="height:110px"></div></div>
  <div style="padding:0 16px"><div class="card" style="height:200px"></div></div>
</div>
${sheet({
  title: 'Cancel Thursday 17:30 Metcon?',
  body: `
    <div class="small" style="font-size:13.5px;line-height:1.55">
      17 members are booked in. Everyone is refunded in full — credits go
      straight back, no cancellation penalty — and everyone gets an email and
      an in-app notice telling them why.
    </div>
    <div style="margin-top:14px">${field('Tell them why (optional)', '', { hint: 'Coach is unwell — back Friday' })}</div>
    <div class="card" style="margin-top:12px;padding:12px;background:var(--surface-2);border-color:transparent">
      <div class="row g10">${avstack(['lk', 'mb', 'ro', 'tm'], 22)}<span class="small grow" style="font-size:12.5px">17 people will be told within a minute.</span></div>
    </div>`,
  actions: `<span class="btn btn-plain">Keep the class</span><span class="btn" style="background:var(--bad);color:#fff;flex:1">Cancel the class</span>`,
})}`;

  return page({
    title: 'Staff — Classes, new class, the roster, cancelling',
    sub: 'The Agenda pattern with staff numbers instead of member ones — capacity replaces spots-left, and the row leads to the roster rather than to a booking. The cancel sheet is the destructive template from board 04, filled in.',
    extraCss: WIDE,
    content: row(
      phone(classes(), { label: 'Classes — day' }) +
      phone(createClass(), { label: 'New class — sheet' }) +
      phone(roster(), { label: 'The roster' }) +
      phone(cancelSheet(), { label: 'Cancelling' }),
    ),
  });
}

/* ========================================================== 14 programming */

export function programmingBoard() {
  const editor = () => `
${staffBar('programming')}
<div class="scrollarea">
  <div class="row between" style="padding:2px 16px 12px">
    ${segmented(['Week', 'Cycle'], 'Week')}
    <span class="btn btn-accent btn-sm">${ic('plus', 15)}Session</span>
  </div>
  ${chips([['Everyone', true], ['Juniors', false], ['Barbell Club', false], ['1-to-1', false]], '0 16px 12px')}
  ${lbl('Week 3 of 8 — Wave', '<span class="chip chip-sm">${}</span>'.replace('${}', 'Duplicate'))}
  <div style="padding:0 16px">
    ${[['Mon', 'Strength — Back squat', '5 × 3 @ 82.5%', TYPE.strength, true],
       ['Tue', 'Metcon — 12 min AMRAP', 'Row · burpee · hang clean', TYPE.metcon, true],
       ['Wed', 'Rest or Open Gym', '', TYPE.open, true],
       ['Thu', 'Strength — Press', '5 × 5 @ RPE 7', TYPE.strength, true],
       ['Fri', '', 'Nothing written yet', '', false]]
      .map(([d, n, p, c, done]) => `
      <div class="row g12" style="padding-bottom:8px;align-items:stretch">
        <div style="width:34px;flex:none;padding-top:13px"><span class="lbl" style="letter-spacing:.04em">${d}</span></div>
        <div class="card grow" style="padding:11px 12px;${done ? '' : 'border-style:dashed;background:transparent'}">
          ${done ? `<div class="row g8">${dot(c)}<span class="h3 grow trunc" style="font-size:14px">${n}</span>${ic('right', 14, 'color:var(--ink-3)')}</div>
            ${p ? `<div class="small dim" style="font-size:12.5px;margin-top:6px">${p}</div>` : ''}`
            : `<div class="row g8" style="justify-content:center;padding:4px 0">${ic('plus', 14, 'color:var(--ink-3)')}<span class="small dim" style="font-size:13px">${p}</span></div>`}
        </div>
      </div>`).join('')}
  </div>
  <div style="padding:6px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(20)}
        <span class="small grow" style="font-size:12.5px;line-height:1.45;color:var(--ink)">Wave 3 is the heaviest week. Want me to drop Friday to a deload and push the test week back one?</span></div>
      <div class="row g6" style="margin-top:11px"><span class="chip chip-sm">Do it</span><span class="chip chip-sm">Not this block</span></div>
    </div>
  </div>
</div>`;

  const session = () => `
${subBar('Monday — Strength', `<span class="chip chip-sm">${ic('copy', 12)}Copy</span>`)}
<div class="scrollarea">
  ${tabs(['Session', 'Who sees it', 'Results'], 'Session')}
  <div style="padding:14px 16px 0">
    ${field('Title', 'Strength — Back squat')}
  </div>
  ${lbl('Blocks', `<span class="chip chip-sm">${ic('plus', 11)}Add block</span>`)}
  <div style="padding:0 16px">
    ${[['A1', 'Back squat', '5 × 3', '82.5% of 1RM'],
       ['A2', 'Barbell row', '5 × 6', 'RPE 7'],
       ['B', 'Bulgarian split squat', '3 × 8 e/s', 'Bodyweight + 2×16kg']]
      .map(([k, n, s, p]) => `
      <div class="listrow" style="align-items:flex-start">
        <span class="badge" style="margin-top:2px">${k}</span>
        <div class="stack g2 grow" style="min-width:0">
          <span class="h3 trunc" style="font-size:14px">${n}</span>
          <span class="small dim trunc" style="font-size:12.5px">${s} · ${p}</span>
        </div>
        ${ic('right', 15, 'color:var(--ink-3)')}
      </div>`).join('')}
  </div>
  ${lbl('Conditioning')}
  <div style="padding:0 16px">
    ${field('', '12 min AMRAP — 10 cal row · 8 burpees over the bar · 6 hang cleans @ 60 kg', { area: true })}
  </div>
  <div style="padding:14px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10">${ic('people', 16, 'color:var(--ink-3)')}<span class="small grow" style="font-size:12.5px">Visible to everyone · 32 members have this on Monday</span></div>
    </div>
  </div>
</div>
<div class="row g8" style="padding:12px 16px 8px;border-top:1px solid var(--line)">
  <span class="btn btn-plain">Preview</span><span class="btn btn-accent grow">Publish to Monday</span>
</div>`;

  const analysis = () => `
${subBar('Analysis', `<span class="chip chip-sm">${ic('cal', 12)}8 weeks</span>`)}
<div class="scrollarea">
  <div style="padding:4px 16px 14px">
    <div class="card">
      <div class="row" style="align-items:stretch">${stat('68%', 'Squat')}${divider()}${stat('22%', 'Press')}${divider()}${stat('10%', 'Pull')}</div>
      <div class="rule" style="margin:14px 0 12px"></div>
      <span class="lbl">Volume by pattern, 8 weeks</span>
      <div class="stack g8" style="margin-top:11px">
        ${[['Squat', 68], ['Hinge', 41], ['Press', 22], ['Pull', 10], ['Carry', 4]]
          .map(([n, v]) => `
          <div class="row g10"><span class="small" style="width:52px;font-size:12.5px">${n}</span>
            <div class="bar grow"><i style="width:${v}%"></i></div>
            <span class="num" style="font-size:12.5px;width:28px;text-align:right">${v}</span></div>`).join('')}
      </div>
    </div>
  </div>
  <div style="padding:0 16px">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(20)}
        <span class="small grow" style="font-size:12.5px;line-height:1.45;color:var(--ink)">Pull is at a tenth of squat volume across the block. Three members have flagged shoulder niggles this month.</span></div>
      <div class="row g6" style="margin-top:11px"><span class="chip chip-sm">Show me who</span><span class="chip chip-sm">Add pull work</span></div>
    </div>
  </div>
  ${lbl('Movements trending down')}
  <div style="padding:0 16px">
    ${[['Strict pull-up', '−18%', '14 members'], ['Overhead press', '−11%', '9 members'], ['Farmer carry', '−31%', '6 members']]
      .map(([n, d, c]) => `
      <div class="listrow">
        <div class="stack g2 grow"><span class="h3" style="font-size:14px">${n}</span><span class="small dim" style="font-size:12.5px">${c} logging it</span></div>
        <span class="chip chip-sm chip-bad">${d}</span>
      </div>`).join('')}
  </div>
</div>`;

  return page({
    title: 'Staff — Programming and Analysis',
    sub: 'Pattern 8, the Workspace, folded onto a phone: the week is the canvas, a session is a page rather than a modal because it deep-links and needs a back. Analysis is the Dashboard pattern with the agent reading the chart out loud.',
    extraCss: WIDE,
    content: row(
      phone(editor(), { label: 'The week' }) +
      phone(session(), { label: 'A session' }) +
      phone(analysis(), { label: 'Analysis' }) +
      phone(editor(), { dark: true, label: 'The week — dark' }),
    ),
  });
}

/* ============================================================= 15 members */

export function membersBoard() {
  const members = () => `
${staffBar('manage')}
<div class="scrollarea">
  ${pagehead('Members', '214 active · 6 joined this month · 3 lapsing', `<span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Invite</span>`)}
  <div style="padding:0 16px 12px"><div class="field" style="min-height:40px;padding-left:14px;font-size:14px">${ic('search', 15, 'color:var(--ink-3)')}<span class="grow">Search members</span></div></div>
  ${chips([['All', true], ['Lapsing', false], ['New', false], ['Owing', false], ['Coaches', false]], '0 16px 12px')}
  <div style="padding:0 16px">
    <div class="ruled">
      ${[['Amara Nwosu', 'Trained 4× this week', 'Payment failed', 'chip-bad'],
         ['Marcus Bell', 'Joined today', 'Unlimited', 'chip-ok'],
         ['Priya Raman', 'Coached 3 classes today', 'Coach', ''],
         ['Jonah Ellis', 'From the join link · 11:20', 'Requested', 'chip-warn'],
         ['Sam Whitlock', '2 credits · last in 21 Jul', 'Lapsing', 'chip-warn'],
         ['Leila Karim', 'Trained 12× this month', 'Unlimited', 'chip-ok'],
         ['Rosa Oduya', '5 credits left', '10-class pack', '']]
        .map(([n, s, p, tone]) => `
        <div class="listrow">
          ${AV(n.split(' ').map((x) => x[0].toLowerCase()).join(''), 32)}
          <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:14px">${n}</span><span class="small dim trunc" style="font-size:12.5px">${s}</span></div>
          <span class="chip chip-sm ${tone}">${p}</span>
        </div>`).join('')}
    </div>
  </div>
</div>`;

  const profile = () => `
${subBar('Amara Nwosu', `<span class="chip chip-sm">${ic('chat', 12)}Message</span>`)}
<div class="scrollarea">
  <div style="padding:2px 16px 12px">
    <div class="card">
      <div class="row g12">
        ${AV('an', 52)}
        <div class="stack g2 grow"><span class="h2" style="font-size:18px">Amara Nwosu</span><span class="small dim" style="font-size:12.5px">Member since Mar 2025 · amara@nwosu.co</span></div>
      </div>
      <div class="row g6 wrap" style="margin-top:13px">
        <span class="chip chip-sm chip-bad">Payment failed</span>
        <span class="chip chip-sm">Evenings</span><span class="chip chip-sm">Metcon</span>
        <span class="chip chip-sm">${ic('plus', 11)}Tag</span>
      </div>
      <div class="rule" style="margin:14px 0"></div>
      <div class="row" style="align-items:stretch">${stat(4, 'This week')}${divider()}${stat(52, 'This year')}${divider()}${stat('11mo', 'Member for')}</div>
    </div>
  </div>
  ${tabs(['Overview', 'Plan', 'Training', 'Health'], 'Overview')}
  ${lbl('Needs attention')}
  <div style="padding:0 16px 14px">
    <div class="card" style="border-color:var(--warn)">
      <div class="row g10"><span style="color:var(--warn)">${ic('card', 17)}</span><span class="h3 grow" style="font-size:14px">£48 failed twice</span></div>
      <div class="body" style="font-size:13px;margin-top:6px">Card expired last month. She has trained four times since.</div>
      <div class="row g8" style="margin-top:12px"><span class="btn btn-dark btn-sm">Ask her to update it</span><span class="btn btn-plain btn-sm">Refund</span></div>
    </div>
  </div>
  ${lbl('Plan')}
  <div style="padding:0 16px">
    <div class="ruled">
      ${listrow({ lead: ic('card', 17, 'color:var(--ink-3)'), title: 'Unlimited monthly', sub: '£48 · renews 3 Sep', chip: '<span class="chip chip-sm chip-bad">Failing</span>' })}
      ${listrow({ lead: ic('bolt', 17, 'color:var(--ink-3)'), title: '10-class pack', sub: '2 credits left', chip: '<span class="chip chip-sm">Credits</span>' })}
    </div>
  </div>
  ${lbl('Recent')}
  <div style="padding:0 16px">
    ${[['Thu 21 Aug', '07:15 Metcon', 'Checked in'], ['Tue 19 Aug', '06:00 Strength', 'Checked in'], ['Sun 17 Aug', '10:00 Open Gym', 'No-show']]
      .map(([d, c, s]) => `<div class="listrow"><div class="stack g2 grow"><span class="h3" style="font-size:14px">${c}</span><span class="small dim" style="font-size:12.5px">${d}</span></div><span class="chip chip-sm ${s === 'No-show' ? 'chip-warn' : ''}">${s}</span></div>`).join('')}
  </div>
</div>`;

  const invite = () => `
${staffBar('manage')}
<div class="scrollarea" style="opacity:.5">
  ${pagehead('Members', '214 active · 6 joined this month', `<span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Invite</span>`)}
  <div style="padding:0 16px"><div class="card" style="height:280px"></div></div>
</div>
${sheet({
  title: 'Invite members',
  sub: 'They get an email and a link that expires in 14 days',
  body: `
    <div class="stack g12">
      ${field('Email addresses', 'amara@nwosu.co, kai@mensah.io', { area: true })}
      <div class="stack g6">
        <span class="lbl" style="letter-spacing:.06em">Put them on</span>
        <div class="row g6 wrap">
          <span class="chip chip-sm chip-on">Unlimited monthly</span>
          <span class="chip chip-sm">10-class pack</span>
          <span class="chip chip-sm">No plan yet</span>
        </div>
      </div>
      <div class="card" style="padding:13px">
        <div class="row g12"><div class="stack g2 grow"><span class="h3" style="font-size:14px">Skip health screening</span><span class="small dim" style="font-size:12.5px">Only if you already hold a current PAR-Q on paper</span></div>${sw(false)}</div>
      </div>
      <div class="rule"></div>
      <div class="row g12" style="align-items:center">
        <div style="width:64px;height:64px;border-radius:12px;background:var(--surface-2);display:flex;align-items:center;justify-content:center">${ic('qr', 30, 'color:var(--ink-2)')}</div>
        <div class="stack g2 grow"><span class="h3" style="font-size:14px">Or share the join link</span><span class="small dim" style="font-size:12.5px">jointemple.io/forge-barbell</span></div>
        <span class="chip chip-sm">${ic('copy', 11)}Copy</span>
      </div>
    </div>`,
  actions: `<span class="btn btn-plain">Cancel</span><span class="btn btn-accent" style="flex:1.4">Send 2 invites</span>`,
})}`;

  const tagRules = () => `
${subBar('Tags')}
<div class="scrollarea">
  ${lbl('Automatic', '<span class="small dim" style="font-size:12.5px">Applied nightly</span>')}
  <div style="padding:0 16px">
    ${[['Lapsing', 'No visit in 21 days', 42, true], ['New', 'Joined in the last 30 days', 6, true],
       ['Evenings', 'Most classes after 17:00', 88, true], ['Owing', 'A payment has failed', 3, true]]
      .map(([t, r, n, on]) => `
      <div class="listrow">
        <div class="stack g2 grow" style="min-width:0"><span class="h3" style="font-size:14px">${t}</span><span class="small dim trunc" style="font-size:12.5px">${r}</span></div>
        <span class="badge">${n}</span>${sw(on)}
      </div>`).join('')}
  </div>
  ${lbl('By hand')}
  <div style="padding:0 16px">
    ${[['Barbell Club', 12], ['Comp team', 5], ['Injured', 3]].map(([t, n]) => `
      <div class="listrow"><span class="h3 grow" style="font-size:14px">${t}</span><span class="badge">${n}</span>${ic('right', 15, 'color:var(--ink-3)')}</div>`).join('')}
  </div>
  <div style="padding:16px 16px 0"><span class="btn btn-plain btn-full">${ic('plus', 15)}New rule</span></div>
</div>`;

  return page({
    title: 'Staff — Members, a member, inviting, tags',
    sub: 'Pattern 3 (Directory) into Pattern 4 (Record). The directory is one ruled card because it is a table; the member page leads with identity and the thing that needs attention, then tabs for everything else.',
    extraCss: WIDE,
    content: row(
      phone(members(), { label: 'Members' }) +
      phone(profile(), { label: 'A member' }) +
      phone(invite(), { label: 'Invite — sheet' }) +
      phone(tagRules(), { label: 'Tags' }),
    ),
  });
}

/* =============================================================== 16 money */

export function moneyBoard() {
  const plans = () => `
${subBar('Plans', `<span class="chip chip-sm">${ic('plus', 12)}Add</span>`)}
<div class="scrollarea">
  ${lbl('Live', '<span class="small dim" style="font-size:12.5px">£14,280 a month</span>')}
  <div style="padding:0 16px">
    ${[['Unlimited monthly', '£48', '/mo', 186, 'chip-ok'],
       ['10-class pack', '£85', 'one-off', 22, ''],
       ['Off-peak monthly', '£32', '/mo', 6, ''],
       ['Juniors', '£24', '/mo', 14, '']]
      .map(([n, p, per, count, tone]) => `
      <div class="listrow">
        <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:14px">${n}</span><span class="small dim" style="font-size:12.5px">${count} members</span></div>
        <div class="stack g2" style="align-items:flex-end"><span class="num" style="font-size:16px">${p}</span><span class="lbl" style="letter-spacing:.04em;font-size:9.5px">${per}</span></div>
        ${ic('right', 15, 'color:var(--ink-3)')}
      </div>`).join('')}
  </div>
  ${lbl('Archived')}
  <div style="padding:0 16px">
    ${listrow({ title: 'Founder rate', sub: '3 members still on it · not sellable', chip: '<span class="chip chip-sm">Archived</span>', right: '' })}
  </div>
  <div style="padding:16px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${ic('link', 16, 'color:var(--ink-3);margin-top:1px')}
        <span class="small grow" style="font-size:12.5px;line-height:1.45">Members already on a plan you archive keep it until they cancel. Nobody new can pick it.</span></div>
    </div>
  </div>
</div>`;

  const billing = () => `
${subBar('Billing')}
<div class="scrollarea">
  <div style="padding:4px 16px 14px">
    <div class="card">
      <div class="row g10">
        <span class="empty-icon" style="width:38px;height:38px;border-radius:11px">${ic('card', 18)}</span>
        <div class="stack g2 grow"><span class="h3">Stripe connected</span><span class="small dim" style="font-size:12.5px">acct_1P… · payouts daily to ••4471</span></div>
        <span class="chip chip-sm chip-ok">Live</span>
      </div>
      <div class="rule" style="margin:14px 0"></div>
      <div class="row" style="align-items:stretch">${stat('£14,280', 'This month')}${divider()}${stat('£1,102', 'In transit')}${divider()}${stat('3', 'Failing')}</div>
    </div>
  </div>
  ${lbl('Needs a decision')}
  <div style="padding:0 16px 14px">
    ${[['Amara Nwosu', '£48 · 2 attempts', 'Card expired'], ['Sam Whitlock', '£85 · 1 attempt', 'Insufficient funds'], ['Kai Mensah', '£48 · 3 attempts', 'Card declined']]
      .map(([n, a, why]) => `
      <div class="listrow">
        ${AV(n.split(' ').map((x) => x[0].toLowerCase()).join(''), 30)}
        <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:14px">${n}</span><span class="small dim trunc" style="font-size:12.5px">${a} · ${why}</span></div>
        <span class="chip chip-sm">Chase</span>
      </div>`).join('')}
  </div>
  ${lbl('Settings')}
  <div style="padding:0 16px">
    ${setting({ title: 'Require a plan to book', sub: 'Off means membership alone is enough to take a class.', control: sw(true) })}
    ${setting({ title: 'Notice period', sub: 'How long a cancellation takes to bite.', control: `<span class="chip chip-sm">30 days${ic('down', 11)}</span>` })}
  </div>
</div>`;

  const earnings = () => `
${subBar('Coach earnings', `<span class="chip chip-sm">${ic('cal', 12)}August</span>`)}
<div class="scrollarea">
  <div style="padding:4px 16px 14px">
    <div class="card">
      <div class="row" style="align-items:stretch">${stat('£2,140', 'To pay')}${divider()}${stat(64, 'Classes')}${divider()}${stat('£33', 'Average')}</div>
    </div>
  </div>
  ${lbl('By coach')}
  <div style="padding:0 16px">
    <div class="ruled">
      ${[['Dani Okafor', 28, '£980'], ['Priya Raman', 21, '£735'], ['Marcus Bell', 15, '£425']]
        .map(([n, c, a]) => `
        <div class="listrow">
          ${AV(n.split(' ').map((x) => x[0].toLowerCase()).join(''), 30)}
          <div class="stack g2 grow"><span class="h3" style="font-size:14px">${n}</span><span class="small dim" style="font-size:12.5px">${c} classes</span></div>
          <span class="num" style="font-size:16px">${a}</span>
        </div>`).join('')}
    </div>
  </div>
  <div style="padding:16px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10">${ic('doc', 16, 'color:var(--ink-3)')}<span class="small grow" style="font-size:12.5px">Temple works out what is owed. Paying it is still on you.</span><span class="chip chip-sm">Export</span></div>
    </div>
  </div>
</div>`;

  const refund = () => `
${subBar('Amara Nwosu')}
<div class="scrollarea" style="opacity:.5">
  <div style="padding:2px 16px 12px"><div class="card" style="height:150px"></div></div>
  <div style="padding:0 16px"><div class="card" style="height:120px"></div></div>
</div>
${sheet({
  title: 'Refund £48.00?',
  sub: 'Charged 3 August · Unlimited monthly',
  body: `
    <div class="stack g10">
      <div class="row g10"><span class="radio on"></span><div class="stack g2 grow"><span class="h3" style="font-size:14px">Full refund — £48.00</span><span class="small dim" style="font-size:12.5px">Back on her card in 5–10 days</span></div></div>
      <div class="row g10"><span class="radio"></span><div class="stack g2 grow"><span class="h3" style="font-size:14px">Part refund</span><span class="small dim" style="font-size:12.5px">Choose an amount up to £48.00</span></div></div>
    </div>
    <div class="rule" style="margin:14px 0"></div>
    <div class="card" style="padding:13px">
      <div class="row g12"><div class="stack g2 grow"><span class="h3" style="font-size:14px">Also cancel her plan</span><span class="small dim" style="font-size:12.5px">Off means she keeps access and is charged again on 3 Sep</span></div>${sw(false)}</div>
    </div>
    <div style="margin-top:12px">${field('Note for the record', '', { hint: 'Charged in error after she paused' })}</div>`,
  actions: `<span class="btn btn-plain">Cancel</span><span class="btn" style="background:var(--bad);color:#fff;flex:1">Refund £48.00</span>`,
})}`;

  return page({
    title: 'Staff — Plans, Billing, Earnings, Refund',
    sub: 'Money reads best as plain numbers with a caps label. Nothing here is tinted; the only colour is a status chip, and red still means only one thing.',
    extraCss: WIDE,
    content: row(
      phone(plans(), { label: 'Plans' }) +
      phone(billing(), { label: 'Billing' }) +
      phone(earnings(), { label: 'Coach earnings' }) +
      phone(refund(), { label: 'Refund — sheet' }),
    ),
  });
}

/* ========================================================= 17 comms + leads */

export function commsBoard() {
  const comms = () => `
${subBar('Communications', `<span class="chip chip-sm">${ic('pen', 12)}New</span>`)}
<div class="scrollarea">
  ${tabs(['Campaigns', 'Automations', 'Topics'], 'Campaigns')}
  <div style="padding:14px 16px 0">
    <div class="card">
      <div class="row" style="align-items:stretch">${stat('61%', 'Opened')}${divider()}${stat('214', 'Recipients')}${divider()}${stat(4, 'Sent · Aug')}</div>
    </div>
  </div>
  ${lbl('Recent')}
  <div style="padding:0 16px">
    ${[['August newsletter', 'Sent 19 Aug · 214 people', '61%', 'chip-ok'],
       ['Closed Monday', 'Sent 17 Aug · 214 people', '78%', 'chip-ok'],
       ['Autumn cycle starts', 'Draft · not sent', '—', '']]
      .map(([t, s, o, tone]) => `
      <div class="listrow">
        <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:14px">${t}</span><span class="small dim trunc" style="font-size:12.5px">${s}</span></div>
        <span class="chip chip-sm ${tone}">${o}</span>${ic('right', 15, 'color:var(--ink-3)')}
      </div>`).join('')}
  </div>
  ${lbl('Running by themselves')}
  <div style="padding:0 16px">
    ${[['Welcome sequence', '3 emails over 2 weeks', true], ['Lapsing nudge', 'After 21 quiet days', true], ['Birthday note', 'On the day', false]]
      .map(([t, s, on]) => `
      <div class="listrow">
        <div class="stack g2 grow"><span class="h3" style="font-size:14px">${t}</span><span class="small dim" style="font-size:12.5px">${s}</span></div>${sw(on)}
      </div>`).join('')}
  </div>
</div>`;

  const composer = () => `
${subBar('August newsletter', `<span class="chip chip-sm">Draft</span>`)}
<div class="scrollarea">
  <div style="padding:12px 16px 0" class="stack g12">
    ${field('Subject', 'Three PRs, a new coach, and the autumn cycle')}
    <div class="stack g6">
      <span class="lbl" style="letter-spacing:.06em">To</span>
      <div class="row g6 wrap">
        <span class="chip chip-sm chip-on">Everyone · 214</span>
        <span class="chip chip-sm">Lapsing · 42</span>
        <span class="chip chip-sm">${ic('plus', 11)}Segment</span>
      </div>
    </div>
  </div>
  <div style="padding:14px 16px 0">
    <div class="card" style="padding:0;overflow:hidden">
      <div class="row g8" style="padding:9px 12px;border-bottom:1px solid var(--line)">
        ${['B', 'I', '“', '≡'].map((g) => `<span class="chip chip-sm" style="width:26px;padding:0;justify-content:center">${g}</span>`).join('')}
        <span class="grow"></span><span class="chip chip-sm">${ic('image', 11)}Image</span>
      </div>
      <div class="stack g10" style="padding:14px">
        <span class="h3">Morning all,</span>
        <span class="small" style="font-size:13.5px;line-height:1.6;color:var(--ink)">Three people hit squat PRs this month and Priya has joined us on Tuesdays and Thursdays. The autumn cycle starts on the 1st — eight weeks, heavier than the summer block.</span>
        <span class="skel" style="width:70%;height:8px"></span>
      </div>
    </div>
  </div>
  <div style="padding:14px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(20)}
        <span class="small grow" style="font-size:12.5px;line-height:1.45;color:var(--ink)">Want me to pull the three PRs and the class-count for August into this?</span></div>
      <div class="row g6" style="margin-top:11px"><span class="chip chip-sm">Yes, add them</span><span class="chip chip-sm">No thanks</span></div>
    </div>
  </div>
</div>
<div class="row g8" style="padding:12px 16px 8px;border-top:1px solid var(--line)">
  <span class="btn btn-plain">Send test</span><span class="btn btn-accent grow">Send to 214</span>
</div>`;

  const leads = () => `
${subBar('Leads', `<span class="chip chip-sm">${ic('plus', 12)}Add</span>`)}
<div class="scrollarea">
  <div style="padding:4px 16px 14px">
    <div class="card">
      <div class="row" style="align-items:stretch">${stat(18, 'New')}${divider()}${stat(7, 'Intro booked')}${divider()}${stat('34%', 'Convert')}</div>
    </div>
  </div>
  ${chips([['All stages', true], ['New', false], ['Talking', false], ['Intro booked', false], ['Cold', false]], '0 16px 12px')}
  <div style="padding:0 16px">
    ${[['Jonah Ellis', 'Website · asked about evening classes', 'Talking', 'chip-ok', true],
       ['Nia Baptiste', 'Instagram · wants a trial', 'New', '', true],
       ['Owen Pryce', 'Referral from Leila Karim', 'Intro booked', 'chip-ok', false],
       ['Hana Ito', 'Website · no reply in 9 days', 'Cold', 'chip-warn', false]]
      .map(([n, s, stage, tone, ai]) => `
      <div class="listrow">
        ${AV(n.split(' ').map((x) => x[0].toLowerCase()).join(''), 32)}
        <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:14px">${n}</span><span class="small dim trunc" style="font-size:12.5px">${s}</span></div>
        ${ai ? orb(16) : ''}<span class="chip chip-sm ${tone}">${stage}</span>
      </div>`).join('')}
  </div>
</div>`;

  const conversation = () => `
${subBar('Jonah Ellis', `<span class="chip chip-sm">Talking</span>`)}
<div class="scrollarea">
  <div style="padding:4px 16px 12px">
    <div class="card" style="padding:12px">
      <div class="row g10">${orb(22)}<span class="h3 grow" style="font-size:14px">Front desk is handling this</span>${sw(true)}</div>
      <div class="small dim" style="font-size:12px;margin-top:8px;line-height:1.4">It answers questions and books intros. It will hand over the moment he asks for a person, or if it is unsure.</div>
    </div>
  </div>
  <div class="stack g12" style="padding:0 16px">
    <div class="row g10" style="align-items:flex-end">
      ${AV('je', 26)}
      <div class="card" style="padding:11px 13px;border-bottom-left-radius:6px;max-width:246px">
        <span class="small" style="font-size:13.5px;line-height:1.45;color:var(--ink)">Hi — do you do classes after 6pm? I finish work at 5:30.</span></div>
    </div>
    <div class="row" style="justify-content:flex-end">
      <div class="card" style="padding:11px 13px;border-bottom-right-radius:6px;max-width:246px;background:var(--surface-2);border-color:transparent">
        <div class="row g6" style="margin-bottom:5px">${orb(13)}<span class="lbl" style="letter-spacing:.05em;font-size:9.5px">Front desk</span></div>
        <span class="small" style="font-size:13.5px;line-height:1.45;color:var(--ink)">We do — Metcon at 17:30 and Barbell Club at 18:45, Monday to Thursday. Want me to put you in for a free intro this week?</span></div>
    </div>
    <div class="row g10" style="align-items:flex-end">
      ${AV('je', 26)}
      <div class="card" style="padding:11px 13px;border-bottom-left-radius:6px;max-width:246px">
        <span class="small" style="font-size:13.5px;line-height:1.45;color:var(--ink)">Thursday would work. What does membership cost?</span></div>
    </div>
  </div>
  <div style="padding:14px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${orb(20)}
        <span class="small grow" style="font-size:12.5px;line-height:1.45;color:var(--ink)">He asked about price — your rules say quote the plan, book the intro. Shall I?</span></div>
      <div class="row g6" style="margin-top:11px"><span class="chip chip-sm">Go ahead</span><span class="chip chip-sm">I'll take it</span></div>
    </div>
  </div>
</div>
<div style="padding:10px 16px 6px">
  <div class="field"><span class="grow">Reply as yourself…</span><span class="btn btn-dark btn-sm" style="width:34px;padding:0;border-radius:999px">${ic('up', 15)}</span></div>
</div>`;

  return page({
    title: 'Staff — Communications, a campaign, Leads, a conversation',
    sub: 'Every surface where the agent does work carries the orb and never anything else — so "a machine did this" is one glyph across the whole product rather than five different amber banners.',
    extraCss: WIDE,
    content: row(
      phone(comms(), { label: 'Communications' }) +
      phone(composer(), { label: 'A campaign' }) +
      phone(leads(), { label: 'Leads' }) +
      phone(conversation(), { label: 'A conversation' }),
    ),
  });
}

/* ============================================================= 18 desktop */

export function desktopBoard() {
  const navRow = (icon, label, { on, trail, orbIcon } = {}) => `
    <div class="navrow ${on ? 'on' : ''}">
      ${orbIcon ? orb(19) : `<span style="color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${ic(icon, 19)}</span>`}
      <span class="grow">${label}</span>${trail ?? ''}
    </div>`;

  const side = (dark, active) => `
    <div class="side">
      <div class="row between" style="padding:2px 4px 0">${lockup(17, dark ? '#f4f5f6' : '#14161a')}<span style="color:var(--ink-3)">${ic('panel', 17)}</span></div>
      <div class="card" style="padding:9px 11px;border-radius:var(--r-ctl)">
        <div class="row g10">${gymTile('F')}
          <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:13.5px">Forge Barbell Club</span><span class="small dim trunc" style="font-size:12px">Dani Okafor · Owner</span></div>
          ${ic('right', 14, 'color:var(--ink-3)')}</div>
      </div>
      <span class="btn btn-dark btn-full" style="height:40px;border-radius:var(--r-ctl)">${ic('plus', 16)}Create</span>
      <div class="stack g2">
        ${navRow('chat', 'Timeline', { on: active === 'timeline' })}
        ${navRow('barbell', 'Programming', { on: active === 'programming' })}
        ${navRow('cal', 'Classes', { on: active === 'classes' })}
        ${navRow('grid', 'Manage', { on: active === 'manage' })}
        ${navRow('', 'Co—Agent', { orbIcon: true })}
        ${navRow('bell', 'Notifications')}
      </div>
      <div class="stack g2" style="margin-top:4px">
        <span class="lbl" style="padding:8px 12px 4px">The gym</span>
        ${navRow('people', 'Members', { on: active === 'members', trail: '<span class="small dim" style="font-size:12.5px">214</span>' })}
        ${navRow('card', 'Billing', { trail: '<span class="small dim" style="font-size:12.5px">£14.3k</span>' })}
        ${navRow('mail', 'Communications')}
        ${navRow('gear', 'Settings', { on: active === 'settings' })}
      </div>
      <div style="margin-top:auto">
        <div class="card" style="padding:12px;border-radius:var(--r-ctl)">
          <div class="row g10">${orb(26)}<div class="stack g2 grow" style="min-width:0"><span class="h3" style="font-size:13px">Finish setting up</span><span class="small dim" style="font-size:11.5px">3 of 8 left</span></div></div>
          <div class="bar" style="margin-top:10px"><i style="width:62%"></i></div>
        </div>
      </div>
    </div>`;

  const kpi = (label, value, delta, sub) => `
    <div class="card grow" style="min-width:0">
      <span class="lbl">${label}</span>
      <div class="num" style="font-size:32px;margin-top:8px">${value}</div>
      <div class="row g6" style="margin-top:8px"><span class="chip chip-sm chip-ok">${delta}</span><span class="small dim" style="font-size:12px">${sub}</span></div>
    </div>`;

  const membersDesk = (dark) => `
<div class="app ${dark ? 'dark' : ''}" style="background:var(--bg);color:var(--ink)">
  <div class="deskbar"><b></b><b></b><b></b><span class="url">app.jointemple.io/management/members</span></div>
  <div style="display:flex;align-items:stretch;min-height:700px">
    ${side(dark, 'members')}
    <div class="grow" style="padding:22px 24px 30px;min-width:0">
      <div class="row between" style="align-items:flex-end">
        <div class="stack g4"><span class="h1" style="font-size:30px">Members</span><span class="body">214 active · 6 joined this month · 3 lapsing</span></div>
        <div class="row g8"><span class="chip">${ic('cal', 14)}This month</span><span class="btn btn-plain btn-sm">Import</span><span class="btn btn-accent btn-sm">${ic('plus', 15)}Invite</span></div>
      </div>
      <div class="row g12" style="margin-top:20px">
        ${kpi('Revenue', '£14,280', '+8.2%', 'vs previous period')}
        ${kpi('Members', '214', '+3.4%', 'vs previous period')}
        ${kpi('Attendance', '62%', '+2pp', 'of members checked in')}
      </div>
      <div class="card flush" style="margin-top:18px">
        <div class="row g12" style="padding:13px 16px;border-bottom:1px solid var(--line)">
          <div class="field grow" style="min-height:36px;padding-left:14px;font-size:14px">${ic('search', 15, 'color:var(--ink-3)')}<span class="grow">Search members</span></div>
          <span class="chip chip-sm">All plans</span><span class="chip chip-sm">All tags</span><span class="chip chip-sm">${ic('doc', 12)}Export</span>
        </div>
        <div class="row g12" style="padding:9px 16px;border-bottom:1px solid var(--line)">
          <span style="width:30px"></span><span class="lbl" style="width:200px">Member</span><span class="lbl" style="width:148px">Plan</span><span class="lbl grow">Tags</span>
        </div>
        ${[['an', 'Amara Nwosu', 'Payment failed', 'chip-bad', 'Trained 4× this week', ['Evenings', 'Metcon']],
           ['mb', 'Marcus Bell', 'Unlimited', 'chip-ok', 'Joined today', ['New']],
           ['pr', 'Priya Raman', 'Coach — staff', '', 'Coached 3 classes today', ['Coach']],
           ['je', 'Jonah Ellis', 'Requested', 'chip-warn', 'From the join link · 11:20', ['Lead']],
           ['sw', 'Sam Whitlock', '10-class pack', '', '2 credits left · last in 21 Jul', ['Lapsing']]]
          .map(([i, n, p, tone, last, tags]) => `
          <div class="row g12" style="padding:12px 16px;border-bottom:1px solid var(--line)">
            ${AV(i)}
            <div class="stack g2" style="width:200px"><span class="h3" style="font-size:14px">${n}</span><span class="small dim" style="font-size:12.5px">${last}</span></div>
            <div style="width:148px"><span class="chip chip-sm ${tone}">${p}</span></div>
            <div class="row g6 grow">${tags.map((t) => `<span class="chip chip-sm">${t}</span>`).join('')}</div>
            <span class="chip chip-sm">Open</span>
          </div>`).join('')}
      </div>
    </div>
    <div style="width:296px;flex:none;padding:22px 20px 30px;min-width:0">
      <div class="row between"><span class="lbl">Waiting on you</span><span class="small" style="font-size:12.5px;color:var(--link)">View all</span></div>
      <div class="card lift" style="margin-top:10px;padding:13px">
        <div class="row g8"><span style="color:var(--warn)">${ic('card', 15)}</span><span class="h3 grow" style="font-size:13.5px">Payment failed</span></div>
        <div class="small" style="margin-top:6px;font-size:12.5px">Amara Nwosu · £48 · 2 attempts</div>
        <div class="row g6" style="margin-top:11px"><span class="btn btn-dark btn-sm" style="height:30px;font-size:12.5px">Chase it</span><span class="btn btn-plain btn-sm" style="height:30px;font-size:12.5px">Details</span></div>
      </div>
      <div class="lbl" style="margin-top:22px">Today at the gym</div>
      <div class="stack g10" style="margin-top:10px">
        ${[['06:00', 'Strength', 'Dani Okafor', '12/20', ['jm', 'ro', 'ka']],
           ['07:15', 'Metcon', 'Dani Okafor', '18/20', ['an', 'lk', 'tm']],
           ['17:30', 'Metcon', 'Priya Raman', '17/20', ['lk', 'mb', 'ro']],
           ['18:45', 'Barbell Club', 'Marcus Bell', '20/20', ['tm', 'jm', 'ka']]]
          .map(([t, n, c, cap, who]) => `
          <div class="row g10">
            <span class="num" style="font-size:12.5px;width:38px;color:var(--ink-2)">${t}</span>
            <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:13.5px">${n}</span><span class="small dim" style="font-size:12px">${c} · ${cap}</span></div>
            ${avstack(who, 20)}
          </div>`).join('')}
      </div>
      <div class="lbl" style="margin-top:22px">This week</div>
      <div class="stack g12" style="margin-top:10px">
        ${[['Attendance is up 6%', 'Evening Metcon is filling earlier than it did in July.'],
           ['Three members are lapsing', 'No visit in 21 days. Two are on credit packs with credits left.']]
          .map(([t, d]) => `<div class="stack g2"><span class="h3" style="font-size:13.5px">${t}</span><span class="small dim" style="font-size:12.5px;line-height:1.4">${d}</span></div>`).join('')}
      </div>
    </div>
  </div>
</div>`;

  const settingsDesk = () => `
<div class="app" style="background:var(--bg);color:var(--ink)">
  <div class="deskbar"><b></b><b></b><b></b><span class="url">app.jointemple.io/management/settings</span></div>
  <div style="display:flex;align-items:stretch;min-height:660px">
    ${side(false, 'settings')}
    <div class="grow" style="padding:22px 24px 30px;min-width:0;max-width:760px">
      <div class="stack g4"><span class="h1" style="font-size:30px">Settings</span><span class="body">Every card saves on its own. Nothing here waits for a Save at the bottom of the page.</span></div>
      <div style="margin-top:20px">
        ${setting({ title: 'Gym name', sub: 'What members see everywhere in the app and in every email.', control: field('', 'Forge Barbell Club'), wide: true, save: { hint: 'Last saved 3 days ago' } })}
        ${setting({ title: 'Brand colour', sub: 'Used on your logo tile and on the one primary action per screen.', control: `<div class="row g8">${['#c2410c', '#3b6ba5', '#0f766e', '#7c3aed', '#b91c1c', '#14161a'].map((c, i) => `<span style="width:34px;height:34px;border-radius:10px;background:${c};${i === 0 ? 'box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--ink)' : ''}"></span>`).join('')}</div>`, wide: true, save: {} })}
        ${setting({ title: 'Week starts on', sub: 'Drives every calendar, every streak and every report.', control: `<div class="segmented"><span class="on">Monday</span><span>Sunday</span></div>` })}
        ${setting({ title: 'Weights shown in', sub: 'Stored in kilograms either way — this only changes the display.', control: `<div class="segmented"><span class="on">kg</span><span>lb</span></div>` })}
        ${setting({ title: 'Booking opens', sub: 'How far ahead members can take a spot.', control: `<span class="chip">7 days${ic('down', 12)}</span>` })}
        ${setting({ title: 'Cancellation cutoff', sub: 'Cancel later than this and the credit is not returned.', control: `<span class="chip">4 hours${ic('down', 12)}</span>` })}
        ${setting({ title: 'Public join page', sub: 'jointemple.io/forge-barbell — anyone with the link can request to join.', control: sw(true) })}
      </div>
    </div>
  </div>
</div>`;

  return page({
    title: 'Staff on desktop — the three-column shell',
    sub: 'The same parts, re-laid for a wide screen: the bar becomes a sidebar, the page keeps its head and its one primary action, and the right rail holds what is happening now. Settings is the same shell with a single 760px column.',
    extraCss: '.board-row{flex-wrap:nowrap}body.board{width:max-content;min-width:100%}.board-head{max-width:none}',
    content:
      row(`<div class="frame-wrap"><div class="frame-label">Members · light</div><div class="desk">${membersDesk(false)}</div></div>
           <div class="frame-wrap"><div class="frame-label">Members · dark</div><div class="desk">${membersDesk(true)}</div></div>`) +
      row(`<div class="frame-wrap"><div class="frame-label">Settings · one card, one save</div><div class="desk">${settingsDesk()}</div></div>`, 'margin-top:34px'),
  });
}
