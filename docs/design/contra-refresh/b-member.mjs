// Boards 05-11: every member-facing surface, as instances of the patterns.
import {
  ic, icf, lockup, wordmark, starfield, AV, avstack, orb, MEDIA, TYPE, mark,
  page, phone, row, sheet, field, sw, radio, checkbox, listrow, setting,
  memberBar, subBar, pagehead, lbl, chips, segmented, tabs, stat, divider,
  media, emptyState, gymTile, dot, skel,
} from './kit.mjs';

export const WIDE = '.board-row{flex-wrap:nowrap}body.board{width:max-content;min-width:100%}.board-head{max-width:none}';

/* ---------------------------------------------------------- book pieces */

const dayStrip = (sel = 3) =>
  `<div class="row g4" style="padding:2px 14px 12px">
    ${[['M', 18], ['T', 19], ['W', 20], ['T', 21], ['F', 22], ['S', 23], ['S', 24]]
      .map(([d, n], i) => `<div class="daycell ${i === sel ? 'on' : ''} ${i === 2 ? 'today' : ''}"><span class="d">${d}</span><span class="n">${n}</span></div>`)
      .join('')}
  </div>`;

const typeFilters = () =>
  chips([['All', true], ['Strength', false, dot(TYPE.strength)], ['Metcon', false, dot(TYPE.metcon)], ['Open Gym', false, dot(TYPE.open)]], '0 16px 14px');

function agendaRow({ time, dur, name, colour, coach, status, tone, action, who, rec }) {
  const toneStyle = tone === 'ok' ? 'color:var(--ok)' : tone === 'warn' ? 'color:var(--warn)' : 'color:var(--ink-3)';
  const cta =
    action === 'booked' ? `<span class="chip chip-sm chip-ok">${ic('check', 12)}Booked</span>`
    : action === 'waitlist' ? `<span class="chip chip-sm">Waitlist</span>`
    : `<span class="btn btn-dark btn-sm">Book</span>`;
  return `
<div class="row g12" style="padding:0 16px 10px;align-items:stretch">
  <div style="width:44px;flex:none;padding-top:14px;text-align:right">
    <div class="num" style="font-size:14.5px">${time}</div>
    <div class="lbl" style="letter-spacing:.05em;font-size:10px;margin-top:2px">${dur}</div>
  </div>
  <div class="card grow" style="padding:12px 13px">
    <div class="row g8">
      ${dot(colour)}<span class="h3 grow trunc">${name}</span>
      ${rec ? `<span class="chip chip-sm chip-accent">${icf('spark', 11)}For you</span>` : ''}${cta}
    </div>
    <div class="row between g8" style="margin-top:9px">
      <span class="small trunc" style="font-size:13px">${coach ? `${coach} <span class="dim">·</span> ` : ''}<b style="${toneStyle}">${status}</b></span>
      ${who ? avstack(who, 21) : ''}
    </div>
  </div>
</div>`;
}

const nextClassCard = () => `
  <div style="padding:0 16px 14px">
    <div class="card" style="padding:13px 14px">
      <div class="row g10">
        <div class="stack g2 grow" style="min-width:0">
          <span class="lbl">Your next class</span>
          <span class="h3" style="margin-top:3px;font-size:16px">Thu 21 Aug at 18:00</span>
        </div>
        <span class="chip chip-sm">${dot(TYPE.metcon)}Metcon</span>${ic('right', 15, 'color:var(--ink-3)')}
      </div>
    </div>
  </div>`;

export const bookScreen = () => `
${memberBar('book')}
<div class="scrollarea">
  ${dayStrip(3)}${typeFilters()}${nextClassCard()}
  ${lbl('Thursday 21 August', '<span class="small dim" style="font-size:12.5px">5 classes</span>')}
  ${agendaRow({ time: '06:00', dur: '60 min', name: 'Strength', colour: TYPE.strength, coach: 'Dani Okafor', status: '8 spots left', tone: 'ok', who: ['jm', 'ro', 'ka'] })}
  ${agendaRow({ time: '07:15', dur: '45 min', name: 'Metcon', colour: TYPE.metcon, coach: 'Dani Okafor', status: 'You are in', tone: 'ok', action: 'booked', who: ['an', 'lk', 'tm', 'bh'] })}
  ${agendaRow({ time: '12:00', dur: '90 min', name: 'Open Gym', colour: TYPE.open, coach: null, status: '14 spots left', tone: 'ok', who: ['sw'] })}
  ${agendaRow({ time: '17:30', dur: '45 min', name: 'Metcon', colour: TYPE.metcon, coach: 'Priya Raman', status: '3 spots left', tone: 'warn', rec: true, who: ['lk', 'mb', 'ro'] })}
  ${agendaRow({ time: '18:45', dur: '60 min', name: 'Barbell Club', colour: TYPE.barbell, coach: 'Marcus Bell', status: 'Full — 2 waiting', tone: 'dim', action: 'waitlist', who: ['tm', 'jm', 'ka', 'bh'] })}
</div>`;

/* ================================================================ 05 auth */

export function authBoard() {
  const landing = (dark) => `
<div class="scrollarea starfield" style="background-image:${starfield('portico', dark ? '%23ffffff' : '%2314161a', dark ? 0.1 : 0.09)}">
  <div class="row between" style="padding:6px 18px 0">
    ${lockup(20, dark ? '#f4f5f6' : '#14161a')}
    <span class="row g8"><span class="chip chip-sm">Log in</span><span class="btn btn-dark btn-sm">Sign up</span></span>
  </div>
  <div style="padding:30px 18px 18px;text-align:center">
    <div class="display" style="font-size:38px">Welcome to Temple</div>
    <div class="body" style="margin:12px auto 0;font-size:15px;max-width:300px">Pick how you'll use it — swipe through, you can always switch later.</div>
  </div>
  <div style="padding:0 18px">
    <div style="position:relative;height:404px">
      <div style="position:absolute;left:20px;right:0;top:22px;bottom:0;border-radius:16px;background:var(--surface-3)"></div>
      <div style="position:absolute;left:10px;right:10px;top:11px;bottom:11px;border-radius:16px;background:var(--surface-2);border:1px solid var(--line)"></div>
      <div class="media" style="position:absolute;left:0;right:20px;top:0;bottom:22px;background-image:${MEDIA.owner}">
        <div class="top">
          <span class="appicon">${ic('grid', 13)}</span>
          <span style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;opacity:.92">Owner</span>
          <span class="grow"></span>${ic('arrow', 17, 'opacity:.9')}
        </div>
        <div style="font-size:27px;font-weight:700;letter-spacing:-.035em;line-height:1.06">The whiteboard,<br>the front desk,<br>the books — one app.</div>
        <div class="stack g6" style="margin-top:14px;font-size:12.5px;line-height:1.35;opacity:.92">
          ${['Programming, schedules and bookings on one calendar', 'Members, plans and comms in one place', "A public join link the moment you're ready", "Insights that tell you what's working", 'Make it look like your gym, not a template']
            .map((b) => `<div class="row g8">${ic('check', 13, 'opacity:.8;margin-top:2px')}<span>${b}</span></div>`).join('')}
        </div>
        <div class="row between g10" style="margin-top:16px">
          <span class="btn" style="background:#fff;color:#14161a;height:40px">Get set up</span>${avstack(['dk', 'pr', 'mb'], 22, true)}
        </div>
      </div>
    </div>
  </div>
  <div class="row g10" style="justify-content:center;padding:20px 0 0">
    <span class="chip" style="width:30px;padding:0;justify-content:center">${ic('left', 14)}</span>
    <span class="row g6"><i class="dot" style="width:8px;height:8px;background:var(--ink)"></i>${dot('var(--line-strong)')}${dot('var(--line-strong)')}</span>
    <span class="chip" style="width:30px;padding:0;justify-content:center">${ic('right', 14)}</span>
  </div>
  <div class="stack g8" style="align-items:center;padding:22px 18px 0">
    <span class="h3" style="font-size:14px">Already have an account? <span style="color:var(--link)">Sign in</span></span>
  </div>
</div>`;

  const signIn = () => `
<div class="scrollarea">
  <div class="row" style="padding:10px 18px 0">${lockup(19, '#14161a')}</div>
  <div style="padding:44px 20px 0">
    <div class="display" style="font-size:32px">Sign in</div>
    <div class="body" style="margin-top:10px;font-size:14.5px">Welcome back. Your gyms are where you left them.</div>
    <div class="stack g14" style="margin-top:26px">
      ${field('Email', 'dani@forgebarbell.co')}
      ${field('Password', '••••••••••', { trail: `<span class="small" style="font-size:12.5px;color:var(--link)">Show</span>` })}
      <div class="row between"><span class="small" style="font-size:13px;color:var(--link)">Forgot your password?</span></div>
    </div>
  </div>
</div>
<div style="padding:12px 20px 8px">
  <span class="btn btn-accent btn-full btn-lg">Sign in</span>
  <div class="row" style="justify-content:center;margin-top:14px">
    <span class="small" style="font-size:13px">No account yet? <b style="color:var(--link)">Get started</b></span>
  </div>
</div>`;

  const createGym = () => `
${subBar('Start a gym')}
<div class="scrollarea">
  <div style="padding:6px 18px 0">
    <div class="row g8"><span class="badge">Step 2 of 3</span><span class="small dim" style="font-size:12.5px">About a minute left</span></div>
    <div class="bar" style="margin-top:9px"><i style="width:66%"></i></div>
    <div class="h1" style="margin-top:20px;font-size:26px">What is your gym called?</div>
    <div class="body" style="margin-top:8px;font-size:14px">This is the name members will see. You can change it later.</div>
  </div>
  <div class="stack g14" style="padding:24px 18px 0">
    ${field('Gym name', 'Forge Barbell Club')}
    ${field('Join link', 'jointemple.io/forge-barbell', { trail: ic('copy', 15, 'color:var(--ink-3)') })}
    <div class="stack g6">
      <span class="lbl" style="letter-spacing:.06em">Brand colour</span>
      <div class="row g8">
        ${['#c2410c', '#3b6ba5', '#0f766e', '#7c3aed', '#b91c1c', '#14161a'].map((c, i) => `<span style="width:38px;height:38px;border-radius:11px;background:${c};display:flex;align-items:center;justify-content:center;${i === 0 ? 'box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--ink)' : ''}">${i === 0 ? ic('check', 16, 'color:#fff') : ''}</span>`).join('')}
      </div>
    </div>
    <div class="inset">
      <div class="row g10">${gymTile('F', 34, 10)}
        <div class="stack g2 grow"><span class="h3" style="font-size:14px">Forge Barbell Club</span><span class="small dim" style="font-size:12px">This is how it looks to members</span></div>
      </div>
    </div>
  </div>
</div>
<div style="padding:12px 18px 8px;border-top:1px solid var(--line)"><span class="btn btn-accent btn-full btn-lg">Continue</span></div>`;

  const acceptInvite = () => `
<div class="scrollarea">
  <div class="row" style="padding:10px 18px 0">${lockup(19, '#14161a')}</div>
  <div style="padding:34px 20px 0;text-align:center">
    <div style="display:flex;justify-content:center">${gymTile('F', 60, 18)}</div>
    <div class="h1" style="margin-top:18px;font-size:26px">Forge Barbell Club<br>invited you</div>
    <div class="body" style="margin:10px auto 0;font-size:14.5px;max-width:280px">Dani Okafor added you as a member. Set a password and you are in.</div>
  </div>
  <div class="stack g14" style="padding:26px 20px 0">
    ${field('Your name', 'Amara Nwosu')}
    ${field('Email', 'amara@nwosu.co', { trail: `<span class="chip chip-sm chip-ok">${ic('check', 11)}Invited</span>` })}
    ${field('Choose a password', '', { hint: 'At least 8 characters' })}
  </div>
</div>
<div style="padding:12px 20px 8px">
  <span class="btn btn-accent btn-full btn-lg">Join Forge Barbell Club</span>
  <div class="small dim" style="font-size:11.5px;text-align:center;margin-top:12px;line-height:1.45">By continuing you agree to the Terms and Privacy Policy.</div>
</div>`;

  return page({
    title: 'Getting in — landing, sign-in, start a gym, accept an invite',
    sub: 'Pattern 7, the Form: one job per screen, back replaces the nav, the action sticks to the foot, and a wizard states where it is and how much is left. The landing is the one place Temple’s own identity leads.',
    extraCss: WIDE,
    content: row(
      phone(landing(false), { label: 'Landing' }) +
      phone(signIn(), { label: 'Sign in' }) +
      phone(createGym(), { label: 'Start a gym — step 2' }) +
      phone(acceptInvite(), { label: 'Accept an invite' }),
    ),
  });
}

/* ================================================== 06 book + programming */

export function bookBoard() {
  const programming = () => `
${memberBar('programming')}
<div class="scrollarea">
  ${dayStrip(3)}
  ${lbl('Thursday 21 August', `<span class="chip chip-sm">${ic('cal', 12)}Week</span>`)}
  <div style="padding:0 16px">
    <div class="card" style="padding:0;overflow:hidden">
      <div class="row g10" style="padding:13px 14px;border-bottom:1px solid var(--line)">
        ${dot(TYPE.strength)}<span class="h3 grow">Strength — Back squat</span><span class="chip chip-sm">Wave 3</span>
      </div>
      <div class="stack g10" style="padding:13px 14px">
        ${[['A1', 'Back squat', '5 × 3 @ 82.5%', '116 kg'], ['A2', 'Barbell row', '5 × 6 @ RPE 7', ''], ['B', 'Bulgarian split squat', '3 × 8 each side', '']]
          .map(([k, n, p, w]) => `
          <div class="row g10" style="align-items:flex-start">
            <span class="badge" style="margin-top:2px">${k}</span>
            <div class="stack g2 grow"><span class="h3" style="font-size:14px">${n}</span><span class="small dim" style="font-size:12.5px">${p}</span></div>
            ${w ? `<span class="num" style="font-size:14px">${w}</span>` : ''}
          </div>`).join('')}
      </div>
      <div class="rule"></div>
      <div class="stack g8" style="padding:13px 14px">
        <span class="lbl" style="letter-spacing:.05em">Conditioning</span>
        <span class="small" style="font-size:13.5px;line-height:1.5;color:var(--ink)">12 min AMRAP<br>10 cal row · 8 burpees over the bar · 6 hang cleans @ 60 kg</span>
      </div>
      <div class="rule"></div>
      <div class="row between" style="padding:11px 14px">
        <span class="small dim" style="font-size:12.5px">Written by Dani Okafor</span>
        <span class="btn btn-dark btn-sm">Log this</span>
      </div>
    </div>
  </div>
  ${lbl('Coach’s note', '')}
  <div style="padding:0 16px">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="small" style="font-size:13.5px;line-height:1.5;color:var(--ink)">Wave 3 is the heavy one. If bar speed drops off on set 4, stop there — we are not grinding singles this block.</div>
    </div>
  </div>
</div>`;

  const bookings = () => `
${subBar('My bookings', `<span class="chip chip-sm">${ic('cal', 12)}Past</span>`)}
<div class="scrollarea">
  ${lbl('This week')}
  <div style="padding:0 16px">
    ${[['Thu 21 Aug', '07:15', 'Metcon', TYPE.metcon, 'Dani Okafor', 'ok', 'Booked'],
       ['Thu 21 Aug', '18:00', 'Metcon', TYPE.metcon, 'Priya Raman', 'ok', 'Booked'],
       ['Sat 23 Aug', '09:00', 'Barbell Club', TYPE.barbell, 'Marcus Bell', 'warn', '2nd in line']]
      .map(([d, t, n, c, coach, tone, state]) => `
      <div class="listrow">
        <div class="stack g2" style="width:60px">
          <span class="lbl" style="letter-spacing:.04em;font-size:9.5px">${d}</span>
          <span class="num" style="font-size:15px">${t}</span>
        </div>
        <div class="stack g2 grow" style="min-width:0">
          <span class="row g8"><span class="h3 trunc">${n}</span></span>
          <span class="small dim trunc" style="font-size:12.5px">${coach}</span>
        </div>
        ${dot(c)}
        <span class="chip chip-sm ${tone === 'ok' ? 'chip-ok' : 'chip-warn'}">${state}</span>
      </div>`).join('')}
  </div>
  ${lbl('Next week')}
  <div style="padding:0 16px">
    ${['Mon 25 Aug', 'Wed 27 Aug'].map((d, i) => `
      <div class="listrow">
        <div class="stack g2" style="width:60px"><span class="lbl" style="letter-spacing:.04em;font-size:9.5px">${d}</span><span class="num" style="font-size:15px">${i ? '17:30' : '06:00'}</span></div>
        <div class="stack g2 grow"><span class="h3">${i ? 'Metcon' : 'Strength'}</span><span class="small dim" style="font-size:12.5px">${i ? 'Priya Raman' : 'Dani Okafor'}</span></div>
        ${dot(i ? TYPE.metcon : TYPE.strength)}<span class="chip chip-sm chip-ok">Booked</span>
      </div>`).join('')}
  </div>
  <div style="padding:16px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10">${ic('clock', 17, 'color:var(--ink-3)')}
        <span class="small grow" style="font-size:13px">Cancelling more than 4 hours before gives your credit back.</span></div>
    </div>
  </div>
</div>`;

  return page({
    title: 'Member — Book, Programming, My bookings',
    sub: 'Pattern 2, the Agenda: a day strip, type filters, then one card per thing with the time in a gutter. Programming is the same shape holding a different payload; bookings is the Directory shape scoped to you.',
    extraCss: WIDE,
    content: row(
      phone(bookScreen(), { label: 'Book — light' }) +
      phone(bookScreen(), { dark: true, label: 'Book — dark' }) +
      phone(programming(), { label: 'Programming' }) +
      phone(bookings(), { label: 'My bookings' }),
    ),
  });
}

/* ================================================= 07 membership + store */

export function planStoreBoard() {
  const membership = () => `
${subBar('Membership')}
<div class="scrollarea">
  <div style="padding:4px 16px 14px">
    <div class="card">
      <div class="row g10">
        <div class="stack g2 grow"><span class="lbl">Current plan</span><span class="h2" style="margin-top:3px">Unlimited monthly</span></div>
        <span class="chip chip-sm chip-ok">Active</span>
      </div>
      <div class="rule" style="margin:14px 0"></div>
      <div class="row" style="align-items:stretch">
        ${stat('£48', 'Per month')}${divider()}${stat('3 Sep', 'Renews')}${divider()}${stat('∞', 'Classes')}
      </div>
      <div class="row g8" style="margin-top:15px">
        <span class="btn btn-plain btn-sm">Switch plan</span>
        <span class="btn btn-plain btn-sm">Payment method</span>
      </div>
    </div>
  </div>
  ${lbl('Also on your account')}
  <div style="padding:0 16px">
    ${listrow({ lead: ic('bolt', 18, 'color:var(--ink-3)'), title: '10-class pack', sub: '2 credits left · expires 30 Sep', chip: '<span class="chip chip-sm">Credits</span>' })}
    ${listrow({ lead: ic('heart', 18, 'color:var(--ink-3)'), title: 'Comp grant — injury return', sub: '4 classes · given by Dani Okafor', chip: '<span class="chip chip-sm chip-ok">Free</span>' })}
  </div>
  ${lbl('Invoices', '<span class="small" style="font-size:12.5px;color:var(--link)">See all</span>')}
  <div style="padding:0 16px">
    <div class="ruled">
      ${[['3 Aug 2026', '£48.00', 'Paid'], ['3 Jul 2026', '£48.00', 'Paid'], ['3 Jun 2026', '£48.00', 'Paid']]
        .map(([d, a, s]) => `<div class="listrow"><span class="h3 grow" style="font-size:14px">${d}</span><span class="num" style="font-size:14px">${a}</span><span class="chip chip-sm chip-ok">${s}</span><span class="chip chip-sm">PDF</span></div>`).join('')}
    </div>
  </div>
  <div style="padding:16px 16px 0">
    <span class="small" style="font-size:13px;color:var(--bad)">Cancel membership</span>
  </div>
</div>`;

  const store = () => `
${subBar('Store', `<span class="chip chip-sm">${ic('bag', 12)}2</span>`)}
<div class="scrollarea">
  ${chips([['All', true], ['Kit', false], ['Programmes', false], ['Events', false]], '4px 16px 12px')}
  <div style="padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${[['Forge water bottle', '£18', MEDIA.gym, '3 left', ''],
       ['Club tee — black', '£28', MEDIA.strength, '', ''],
       ['12-week squat cycle', '£45', MEDIA.metcon, '', 'Digital'],
       ['Locker rental', '£12/mo', MEDIA.owner, '', 'Monthly']]
      .map(([n, p, bg, stock, tag]) => `
      <div class="card" style="padding:0;overflow:hidden">
        <div style="height:96px;background-image:${bg};position:relative">
          ${tag ? `<span class="badge" style="position:absolute;top:8px;left:8px;background:rgba(255,255,255,.92);color:#14161a">${tag}</span>` : ''}
          <span class="row g4" style="position:absolute;bottom:7px;left:0;right:0;justify-content:center">
            ${[1, 0, 0].map((a) => `<i style="width:5px;height:5px;border-radius:99px;background:#fff;opacity:${a ? 1 : 0.45};display:block"></i>`).join('')}
          </span>
        </div>
        <div class="stack g2" style="padding:10px 11px 11px">
          <span class="h3 trunc" style="font-size:13.5px">${n}</span>
          <div class="row between" style="margin-top:3px">
            <span class="num" style="font-size:15px">${p}</span>
            ${stock ? `<span class="chip chip-sm chip-warn">${stock}</span>` : ''}
          </div>
        </div>
      </div>`).join('')}
  </div>
</div>`;

  const productSheet = () => `
${subBar('Store', `<span class="chip chip-sm">${ic('bag', 12)}2</span>`)}
<div class="scrollarea" style="opacity:.5">
  ${chips([['All', true], ['Kit', false], ['Programmes', false]], '4px 16px 12px')}
  <div style="padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${[0, 1, 2, 3].map(() => `<div class="card" style="height:150px"></div>`).join('')}
  </div>
</div>
${sheet({
  title: 'Club tee — black',
  sub: 'Physical · shipped in 3–5 days',
  body: `
    <div style="height:128px;border-radius:12px;background-image:${MEDIA.strength};position:relative">
      <span class="row g4" style="position:absolute;bottom:9px;left:0;right:0;justify-content:center">
        ${[1, 0, 0, 0].map((a) => `<i style="width:5px;height:5px;border-radius:99px;background:#fff;opacity:${a ? 1 : 0.45};display:block"></i>`).join('')}
      </span>
    </div>
    <div class="row between" style="margin-top:14px">
      <span class="num" style="font-size:24px">£28.00</span>
      <span class="small dim" style="font-size:12.5px">+ £4.50 shipping</span>
    </div>
    <div class="stack g8" style="margin-top:14px">
      <span class="lbl" style="letter-spacing:.05em">Size</span>
      <div class="row g6">${['S', 'M', 'L', 'XL'].map((s, i) => `<span class="chip chip-sm ${i === 1 ? 'chip-on' : ''}">${s}</span>`).join('')}</div>
    </div>
    <div class="small" style="margin-top:14px;font-size:13px;line-height:1.5">Heavyweight cotton, printed at the gym. Runs true to size.</div>`,
  actions: `<span class="btn btn-plain">Add to bag</span><span class="btn btn-accent" style="flex:1.5">Buy now — £32.50</span>`,
})}`;

  const purchases = () => `
${subBar('Purchases')}
<div class="scrollarea">
  ${lbl('Subscriptions')}
  <div style="padding:0 16px">
    <div class="card">
      <div class="row g10">
        <div class="stack g2 grow"><span class="h3">Locker rental</span><span class="small dim" style="font-size:12.5px">£12/month · next charge 3 Sep</span></div>
        <span class="chip chip-sm chip-ok">Active</span>
      </div>
      <div class="row g8" style="margin-top:13px"><span class="btn btn-plain btn-sm">Manage</span><span class="btn btn-plain btn-sm">Cancel</span></div>
    </div>
  </div>
  ${lbl('Orders')}
  <div style="padding:0 16px">
    ${[['12 Aug 2026', '£45.00', '12-week squat cycle', 'Download', 'chip-ok'],
       ['28 Jul 2026', '£32.50', 'Club tee — black · M', 'Shipped', 'chip-ok'],
       ['14 Jul 2026', '£18.00', 'Forge water bottle', 'Packing', 'chip-warn']]
      .map(([d, a, n, s, tone]) => `
      <div class="listrow">
        <div class="stack g2 grow" style="min-width:0">
          <span class="h3 trunc" style="font-size:14px">${n}</span>
          <span class="small dim" style="font-size:12.5px">${d} · ${a}</span>
        </div>
        <span class="chip chip-sm ${tone}">${s}</span>
      </div>`).join('')}
  </div>
</div>`;

  return page({
    title: 'Member — Membership, Store, Purchases',
    sub: 'Money surfaces. The plan card is the Record pattern reduced to one entity; the store is the Directory pattern with photography doing the work; buying is a sheet, not a route, because it is a decision rather than a place.',
    extraCss: WIDE,
    content: row(
      phone(membership(), { label: 'Membership' }) +
      phone(store(), { label: 'Store' }) +
      phone(productSheet(), { label: 'Buy — sheet' }) +
      phone(purchases(), { label: 'Purchases' }),
    ),
  });
}

/* =============================================================== 08 track */

export function trackBoard() {
  const heat = () => {
    const seed = [3, 0, 2, 0, 3, 1, 0, 2, 3, 0, 2, 0, 1, 0, 3, 2, 0, 3, 0, 2, 0, 1, 3, 2, 0, 3, 0, 0, 2, 0, 3, 1, 2, 0, 0, 3, 2, 0, 3, 0, 1, 0, 0, 3, 2, 0, 3, 0, 2, 2, 0, 3, 1, 0, 2, 0, 3, 0, 2, 3, 0, 1, 0, 2, 0, 3, 1, 0, 3, 0, 3, 2, 0, 2, 0, 3, 0, 1, 2, 3, 0, 2, 0, 0];
    const cols = [];
    for (let w = 0; w < 12; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const v = seed[(w * 7 + d) % seed.length];
        col.push(`<i style="${v === 0 ? '' : `background:var(--accent);opacity:${v === 1 ? 0.3 : v === 2 ? 0.6 : 1}`}"></i>`);
      }
      cols.push(`<div>${col.join('')}</div>`);
    }
    return `<div class="heat">${cols.join('')}</div>`;
  };

  const tile = (icon, title, sub, badge) => `
    <div class="card" style="padding:12px;display:flex;flex-direction:column;min-height:86px">
      <div class="row between">
        <span style="color:var(--ink-2)">${ic(icon, 19)}</span>
        ${badge ? `<span class="badge">${badge}</span>` : ic('right', 15, 'color:var(--ink-3)')}
      </div>
      <div class="stack g2" style="margin-top:auto">
        <span class="h3" style="font-size:14.5px">${title}</span>
        <span class="small dim" style="font-size:12px;line-height:1.3">${sub}</span>
      </div>
    </div>`;

  const track = () => `
${memberBar('track')}
<div class="scrollarea">
  ${pagehead('Track', 'Log workouts and PRs across movements.', `<span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Record</span>`)}
  <div style="padding:0 16px 14px">
    <div class="card">
      <div class="row" style="align-items:stretch">${stat(4, 'Day streak')}${divider()}${stat(6, 'Week streak')}${divider()}${stat(11, 'This month')}</div>
      <div class="rule" style="margin:14px 0 12px"></div>
      <div class="row between"><span class="lbl">Last 12 weeks</span><span class="small dim" style="font-size:12px">42 sessions</span></div>
      <div style="margin-top:9px;width:176px">${heat()}</div>
    </div>
  </div>
  ${lbl('Your movements', '<span class="small" style="font-size:12.5px;color:var(--link)">See all</span>')}
  <div style="padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${tile('book', 'Journal', '38 sessions logged')}
    ${tile('trophy', 'Leaderboards', 'Heaviest, fastest, hardest')}
    ${tile('library', 'Movement Library', 'Search &amp; star all movements')}
    ${tile('body', 'Injury tracker', '1 open injury', '1 due')}
  </div>
  <div style="padding:10px 16px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    ${[['Squat', '6 moves', '142.5', 'Back squat · 3 wks ago', '0,18 12,15 24,16 36,10 48,8 60,3'],
       ['Press', '4 moves', '62.5', 'Strict press · 6 days ago', '0,14 12,15 24,11 36,12 48,7 60,6']]
      .map(([name, moves, kg, sub, pts]) => `
      <div class="card" style="padding:12px">
        <div class="row between"><span class="h3" style="font-size:14px">${name}</span><span class="lbl" style="letter-spacing:.05em">${moves}</span></div>
        <div class="row between" style="margin-top:7px;align-items:flex-end">
          <span class="num" style="font-size:21px">${kg}<span style="font-size:11px;font-weight:600"> kg</span></span>
          <svg viewBox="0 0 60 22" style="width:52px;height:18px;flex:none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="small dim" style="font-size:11px;margin-top:4px">${sub}</div>
      </div>`).join('')}
  </div>
</div>`;

  const movement = () => `
${subBar('Back squat', `<span class="chip chip-sm">${ic('plus', 12)}Log</span>`)}
<div class="scrollarea">
  <div style="padding:2px 16px 14px">
    <div class="card">
      <div class="row between" style="align-items:flex-end">
        <div class="stack g2"><span class="lbl">Best</span><span class="num" style="font-size:34px;margin-top:2px">142.5<span style="font-size:14px;font-weight:600"> kg</span></span></div>
        <span class="chip chip-sm chip-accent">${icf('spark', 11)}PR · 3 wks ago</span>
      </div>
      <svg viewBox="0 0 300 70" style="width:100%;height:70px;margin-top:14px">
        <polyline points="0,58 40,52 80,54 120,40 160,34 200,36 240,20 300,8" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${[[0, 58], [40, 52], [80, 54], [120, 40], [160, 34], [200, 36], [240, 20], [300, 8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.6"/>`).join('')}
      </svg>
      <div class="row between"><span class="lbl" style="letter-spacing:.05em">Feb</span><span class="lbl" style="letter-spacing:.05em">Aug</span></div>
    </div>
  </div>
  ${tabs(['History', 'Percentages', 'Leaderboard'], 'History')}
  <div style="padding:14px 16px 0">
    <div class="ruled">
      ${[['3 wks ago', '142.5 kg', '3 × 3', true], ['5 wks ago', '137.5 kg', '5 × 3', false], ['8 wks ago', '135 kg', '5 × 5', false], ['11 wks ago', '130 kg', '5 × 5', false]]
        .map(([d, w, s, pr]) => `
        <div class="listrow">
          <div class="stack g2 grow"><span class="h3" style="font-size:14px">${w}</span><span class="small dim" style="font-size:12.5px">${s} · ${d}</span></div>
          ${pr ? `<span class="chip chip-sm chip-accent">PR</span>` : ''}
          ${ic('right', 15, 'color:var(--ink-3)')}
        </div>`).join('')}
    </div>
  </div>
</div>`;

  const journal = () => `
${subBar('Journal', `<span class="chip chip-sm">${ic('filter', 12)}Filter</span>`)}
<div class="scrollarea">
  ${lbl('August')}
  <div style="padding:0 16px">
    ${[['Thu 21', 'Metcon — 12 min AMRAP', '6 rounds + 8 reps', TYPE.metcon, ['an', 'lk']],
       ['Tue 19', 'Strength — Back squat', '5 × 3 @ 116 kg', TYPE.strength, ['jm']],
       ['Sun 17', 'Open Gym', 'Snatch technique · 40 min', TYPE.open, []],
       ['Fri 15', 'Metcon — Fran', '4:12 — 22 s off PR', TYPE.metcon, ['ro', 'ka', 'tm']]]
      .map(([d, n, r, c, who]) => `
      <div class="listrow">
        <div class="stack g2" style="width:46px"><span class="lbl" style="letter-spacing:.04em;font-size:9.5px">${d.split(' ')[0]}</span><span class="num" style="font-size:16px">${d.split(' ')[1]}</span></div>
        <div class="stack g2 grow" style="min-width:0">
          <span class="row g8">${dot(c)}<span class="h3 trunc" style="font-size:14px">${n}</span></span>
          <span class="small dim trunc" style="font-size:12.5px">${r}</span>
        </div>
        ${who.length ? avstack(who, 20) : ''}
      </div>`).join('')}
  </div>
</div>`;

  const recordSheet = () => `
${memberBar('track')}
<div class="scrollarea" style="opacity:.5">
  ${pagehead('Track', 'Log workouts and PRs across movements.', `<span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Record</span>`)}
  <div style="padding:0 16px"><div class="card" style="height:170px"></div></div>
</div>
${sheet({
  title: 'Record a workout',
  sub: 'Thursday 21 August',
  body: `
    <div class="stack g12">
      ${field('What was it', 'Metcon — 12 min AMRAP')}
      <div class="row g10">
        <div class="grow">${field('Result', '6 rounds + 8')}</div>
        <div style="width:104px">${field('Feel', 'RPE 8')}</div>
      </div>
      <div class="stack g8">
        <span class="lbl" style="letter-spacing:.05em">Movements hit</span>
        <div class="row g6 wrap">
          <span class="chip chip-sm chip-on">${ic('check', 11)}Row</span>
          <span class="chip chip-sm chip-on">${ic('check', 11)}Hang clean</span>
          <span class="chip chip-sm">Burpee</span>
          <span class="chip chip-sm">${ic('plus', 11)}Add</span>
        </div>
      </div>
      ${field('Notes', '', { hint: 'Anything worth remembering next time', area: true })}
    </div>`,
  actions: `<span class="btn btn-plain">Cancel</span><span class="btn btn-accent" style="flex:1.4">Save workout</span>`,
})}`;

  return page({
    title: 'Member — Track, Journal, Movement, Record',
    sub: 'Pattern 5 (Dashboard) at the top level, Pattern 4 (Record) for a single movement, Pattern 3 (Directory) for the journal — and logging is a Form sheet because it is a decision, not a destination.',
    extraCss: WIDE,
    content: row(
      phone(track(), { label: 'Track' }) +
      phone(movement(), { label: 'Movement — record' }) +
      phone(journal(), { label: 'Journal' }) +
      phone(recordSheet(), { label: 'Record — sheet' }),
    ),
  });
}

/* ============================================================== 09 health */

export function healthBoard() {
  const parq = () => `
${subBar('Health screening')}
<div class="scrollarea">
  <div style="padding:4px 18px 0">
    <div class="row g8"><span class="badge">3 of 7</span><span class="small dim" style="font-size:12.5px">Once a year, then you are done</span></div>
    <div class="bar" style="margin-top:9px"><i style="width:43%"></i></div>
    <div class="h1" style="margin-top:22px;font-size:24px">Has a doctor ever said you have a heart condition?</div>
    <div class="body" style="margin-top:8px;font-size:14px">Only your coaches see this, and only while you are a member here.</div>
  </div>
  <div class="stack g10" style="padding:24px 18px 0">
    ${[['No', false], ['Yes', true]].map(([l, on]) => `
      <div class="card" style="padding:14px;${on ? 'border-color:var(--ink)' : ''}">
        <div class="row g12">${radio(on)}<span class="h3 grow">${l}</span></div>
      </div>`).join('')}
    <div class="stack g6" style="margin-top:2px">
      ${field('Add detail (optional but helpful)', '', { hint: 'Diagnosed 2019, managed with medication', area: true })}
    </div>
  </div>
</div>
<div class="row g8" style="padding:12px 18px 8px;border-top:1px solid var(--line)">
  <span class="btn btn-plain" style="flex:none;width:52px;padding:0">${ic('left', 17)}</span>
  <span class="btn btn-accent grow btn-lg">Next</span>
</div>`;

  const waiver = () => `
${subBar('Liability waiver')}
<div class="scrollarea">
  <div style="padding:4px 16px 12px">
    <div class="card" style="padding:0;overflow:hidden">
      <div class="row g10" style="padding:12px 14px;border-bottom:1px solid var(--line)">
        ${ic('doc', 17, 'color:var(--ink-3)')}
        <div class="stack g2 grow"><span class="h3" style="font-size:14px">Forge Barbell Club waiver</span><span class="small dim" style="font-size:12px">Version 3 · 2 pages</span></div>
        <span class="chip chip-sm">Open</span>
      </div>
      <div class="stack g8" style="padding:13px 14px">
        ${[80, 96, 70, 92, 60].map((w) => `<i class="skel" style="width:${w}%;height:7px"></i>`).join('')}
        <div class="small dim" style="font-size:12px;margin-top:4px">Scroll to the end to sign</div>
      </div>
    </div>
  </div>
  <div style="padding:0 16px 12px">
    <div class="row g10" style="align-items:flex-start">${checkbox(true)}
      <span class="small grow" style="font-size:13px;line-height:1.5;color:var(--ink)">I have read the waiver and I accept the risks of training here.</span></div>
  </div>
  ${lbl('Sign here')}
  <div style="padding:0 16px">
    <div class="card" style="height:132px;padding:0;display:flex;align-items:center;justify-content:center;position:relative;background:var(--surface-2);border-style:dashed;border-color:var(--line-strong)">
      <svg viewBox="0 0 240 60" style="width:200px;height:52px"><path d="M12 44c14-26 22 8 34-10s16 16 30-4 20 12 34-6 22 10 34-8 24 6 34-6" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/></svg>
      <span class="chip chip-sm" style="position:absolute;right:10px;bottom:10px">Clear</span>
    </div>
    <div class="small dim" style="font-size:12px;margin-top:8px">Signed as Amara Nwosu · 21 Aug 2026</div>
  </div>
</div>
<div style="padding:12px 16px 8px;border-top:1px solid var(--line)"><span class="btn btn-accent btn-full btn-lg">Sign and continue</span></div>`;

  const injury = () => `
${subBar('Injury check-in')}
<div class="scrollarea">
  <div style="padding:4px 16px 0">
    <div class="card">
      <div class="row g10">
        <span style="color:var(--warn)">${ic('body', 18)}</span>
        <div class="stack g2 grow"><span class="h3">Right shoulder</span><span class="small dim" style="font-size:12.5px">Logged 14 Jul · checked in 3 times</span></div>
        <span class="chip chip-sm chip-warn">Open</span>
      </div>
    </div>
  </div>
  <div style="padding:16px 16px 0">
    <span class="lbl">How is it today?</span>
    <div class="row g6" style="margin-top:10px">
      ${['Worse', 'Same', 'Better', 'Gone'].map((l, i) => `<span class="chip ${i === 2 ? 'chip-on' : ''}" style="flex:1;justify-content:center">${l}</span>`).join('')}
    </div>
  </div>
  <div style="padding:18px 16px 0">
    <span class="lbl">Pain, 0 to 10</span>
    <div class="row g10" style="margin-top:12px;align-items:center">
      <div class="bar grow" style="height:6px"><i style="width:30%"></i></div>
      <span class="num" style="font-size:20px">3</span>
    </div>
    <div class="row between" style="margin-top:6px"><span class="small dim" style="font-size:11.5px">None</span><span class="small dim" style="font-size:11.5px">Unbearable</span></div>
  </div>
  <div style="padding:20px 16px 0">${field('What aggravates it', 'Overhead press, anything above shoulder height', { area: true })}</div>
  <div style="padding:16px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${ic('shield', 17, 'color:var(--ink-3);margin-top:1px')}
        <span class="small grow" style="font-size:12.5px;line-height:1.45">Coaches see this so they can scale your session. It is deleted when you leave the gym, and after three months either way.</span></div>
    </div>
  </div>
</div>
<div style="padding:12px 16px 8px;border-top:1px solid var(--line)"><span class="btn btn-accent btn-full btn-lg">Save check-in</span></div>`;

  const consent = () => `
<div class="scrollarea">
  <div class="row" style="padding:10px 18px 0">${lockup(19, '#14161a')}</div>
  <div style="padding:36px 20px 0">
    <span class="empty-icon" style="width:52px;height:52px;border-radius:16px">${ic('shield', 24)}</span>
    <div class="h1" style="margin-top:18px;font-size:26px">Before we start</div>
    <div class="body" style="margin-top:10px;font-size:14.5px">Your gym needs two things from you. Both are yours to withdraw at any time from Account.</div>
  </div>
  <div class="stack g10" style="padding:24px 20px 0">
    ${[['Health data', 'PAR-Q answers and any injuries you log. Special-category data — only your coaches at this gym can see it, and it is erased when you leave.', true],
       ['Class photos', 'Optional. Lets the gym use photos you appear in on their public page. Saying no changes nothing else.', false]]
      .map(([t, d, on]) => `
      <div class="card" style="padding:14px">
        <div class="row g12" style="align-items:flex-start">
          ${checkbox(on)}
          <div class="stack g4 grow">
            <span class="h3">${t}</span>
            <span class="small dim" style="font-size:12.5px;line-height:1.45">${d}</span>
          </div>
        </div>
      </div>`).join('')}
  </div>
</div>
<div style="padding:12px 20px 8px">
  <span class="btn btn-accent btn-full btn-lg">Agree and continue</span>
  <div class="row" style="justify-content:center;margin-top:12px"><span class="small" style="font-size:12.5px;color:var(--link)">Read the privacy notice</span></div>
</div>`;

  return page({
    title: 'Member — health, waiver, consent',
    sub: 'The most legally-loaded screens in the product, and the ones where the pattern matters most. One question per screen, progress stated in words as well as a bar, and every screen says who sees the answer and for how long.',
    extraCss: WIDE,
    content: row(
      phone(consent(), { label: 'Consent gate' }) +
      phone(parq(), { label: 'PAR-Q — one question' }) +
      phone(waiver(), { label: 'Waiver — sign' }) +
      phone(injury(), { label: 'Injury check-in' }),
    ),
  });
}

/* =============================================================== 10 inbox */

export function inboxBoard() {
  const inbox = () => `
${subBar('Inbox', `<span class="chip chip-sm">${ic('pen', 12)}New</span>`)}
<div class="scrollarea">
  ${chips([['All', true], ['From the gym', false], ['Direct', false]], '4px 16px 12px')}
  <div style="padding:0 16px 12px">
    <div class="card" style="border-color:var(--warn)">
      <div class="row g10">
        <span style="color:var(--warn)">${ic('card', 17)}</span>
        <div class="stack g2 grow"><span class="h3">We couldn't take your payment</span><span class="small dim" style="font-size:12.5px">£48 · your card expired</span></div>
      </div>
      <div class="row g8" style="margin-top:12px"><span class="btn btn-dark btn-sm">Update card</span><span class="btn btn-plain btn-sm">Not now</span></div>
    </div>
  </div>
  ${lbl('From the gym')}
  <div style="padding:0 16px">
    ${[['Closed Monday', 'Cleaning the floor — reopening Tuesday at 6am.', '2d', true, 'F'],
       ['Class times changed', 'Evening Metcon moves to 17:45 from September.', '5d', false, 'F'],
       ['August newsletter', 'Three new PRs, a new coach, and the autumn cycle.', '1w', false, 'F']]
      .map(([t, p, w, pin, av]) => `
      <div class="listrow">
        ${gymTile(av, 32, 10)}
        <div class="stack g2 grow" style="min-width:0">
          <span class="row g6"><span class="h3 trunc">${t}</span>${pin ? `<span class="badge">Pinned</span>` : ''}</span>
          <span class="small dim trunc" style="font-size:12.5px">${p}</span>
        </div>
        <span class="lbl" style="letter-spacing:.04em">${w}</span>
      </div>`).join('')}
  </div>
  ${lbl('Direct')}
  <div style="padding:0 16px">
    ${[['Dani Okafor', 'Nice work on the squat triple today.', '4h', true],
       ['Priya Raman', 'Shoulder feeling any better this week?', '3d', false]]
      .map(([n, p, w, unread]) => `
      <div class="listrow">
        ${AV(n.split(' ').map((x) => x[0].toLowerCase()).join(''), 32)}
        <div class="stack g2 grow" style="min-width:0">
          <span class="h3 trunc">${n}</span>
          <span class="small ${unread ? 'strong' : 'dim'} trunc" style="font-size:12.5px">${p}</span>
        </div>
        ${unread ? `<i class="dot" style="width:8px;height:8px;background:var(--accent)"></i>` : ''}
        <span class="lbl" style="letter-spacing:.04em">${w}</span>
      </div>`).join('')}
  </div>
</div>`;

  const broadcast = () => `
${subBar('From the gym')}
<div class="scrollarea">
  <div style="padding:4px 16px 0">
    <div class="row g10">${gymTile('F', 34, 10)}
      <div class="stack g2 grow"><span class="h3">Forge Barbell Club</span><span class="small dim" style="font-size:12.5px">Dani Okafor · 19 Aug, 08:12</span></div>
      <span class="badge">Pinned</span>
    </div>
    <div class="h1" style="margin-top:18px;font-size:24px">Closed Monday</div>
    <div class="body" style="margin-top:12px;font-size:14.5px;line-height:1.6;color:var(--ink)">
      We are resealing the platform floor on Monday, so the gym is shut all
      day. Everything booked for Monday has been cancelled and your credits
      are already back on your account — you do not need to do anything.
    </div>
    <div class="body" style="margin-top:12px;font-size:14.5px;line-height:1.6;color:var(--ink)">
      We reopen Tuesday at 6am as normal. The Tuesday evening Metcon has two
      extra spots to soak up the demand.
    </div>
  </div>
  <div style="padding:20px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row between"><span class="small" style="font-size:13px">Read by 186 of 214 members</span>${ic('check', 15, 'color:var(--ok)')}</div>
    </div>
  </div>
  <div style="padding:16px 16px 0">
    ${lbl('What changed for you', '')}
    <div class="ruled">
      ${listrow({ lead: dot(TYPE.strength), title: 'Mon 25 Aug · 06:00 Strength', sub: 'Cancelled — 1 credit returned', right: `<span class="chip chip-sm chip-ok">Refunded</span>` })}
    </div>
  </div>
</div>
<div style="padding:12px 16px 8px;border-top:1px solid var(--line)">
  <div class="row g8"><span class="btn btn-plain grow">Got it</span><span class="btn btn-plain">${ic('mail', 15)}</span></div>
</div>`;

  const thread = () => `
${subBar('Dani Okafor', `<span class="chip chip-sm">Coach</span>`)}
<div class="scrollarea">
  <div class="stack g12" style="padding:8px 16px 0">
    <div class="row" style="justify-content:center"><span class="lbl">Tuesday</span></div>
    <div class="row g10" style="align-items:flex-end">
      ${AV('do', 28)}
      <div class="card" style="padding:11px 13px;border-bottom-left-radius:6px;max-width:250px">
        <span class="small" style="font-size:13.5px;line-height:1.45;color:var(--ink)">Nice work on the squat triple today — that moved a lot better than the 137.5 did.</span>
      </div>
    </div>
    <div class="row" style="justify-content:flex-end">
      <div class="card" style="padding:11px 13px;border-bottom-right-radius:6px;max-width:250px;background:var(--ink);border-color:var(--ink)">
        <span class="small" style="font-size:13.5px;line-height:1.45;color:var(--surface)">Felt strong. Shoulder was fine on the rack position too.</span>
      </div>
    </div>
    <div class="row g10" style="align-items:flex-end">
      ${AV('do', 28)}
      <div class="card" style="padding:11px 13px;border-bottom-left-radius:6px;max-width:250px">
        <span class="small" style="font-size:13.5px;line-height:1.45;color:var(--ink)">Good. Keep the check-ins going and we will push overhead again in two weeks.</span>
      </div>
    </div>
    <div class="row" style="justify-content:center"><span class="lbl">Today</span></div>
    <div class="row g10" style="align-items:flex-end">
      ${AV('do', 28)}
      <div class="card" style="padding:11px 13px;border-bottom-left-radius:6px;max-width:250px">
        <span class="small" style="font-size:13.5px;line-height:1.45;color:var(--ink)">Shoulder feeling any better this week?</span>
      </div>
    </div>
  </div>
</div>
<div style="padding:10px 16px 6px">
  <div class="field"><span class="grow">Message Dani…</span><span class="btn btn-dark btn-sm" style="width:34px;padding:0;border-radius:999px">${ic('up', 15)}</span></div>
</div>`;

  const empty = () => `
${subBar('Inbox', `<span class="chip chip-sm">${ic('pen', 12)}New</span>`)}
<div class="scrollarea">
  ${chips([['All', true], ['From the gym', false], ['Direct', false]], '4px 16px 12px')}
  ${emptyState({
    icon: 'mail',
    title: 'Nothing here yet',
    body: 'Notices from Forge Barbell Club and messages from your coaches land here. You will get a dot on your avatar when one does.',
    action: `<span class="btn btn-plain btn-sm">Message a coach</span>`,
  })}
</div>`;

  return page({
    title: 'Member — Inbox, notice, thread, empty',
    sub: 'Pattern 1, the Feed, at three depths. Anything that needs the member to act keeps a card and buttons; everything else is a row. The empty state names what will appear and gives one thing to do.',
    extraCss: WIDE,
    content: row(
      phone(inbox(), { label: 'Inbox' }) +
      phone(broadcast(), { label: 'A notice' }) +
      phone(thread(), { label: 'Direct thread' }) +
      phone(empty(), { label: 'Empty' }),
    ),
  });
}

/* ============================================================= 11 account */

export function accountBoard() {
  const account = () => `
${subBar('Account')}
<div class="scrollarea">
  <div style="padding:4px 16px 14px">
    <div class="card">
      <div class="row g12">
        ${AV('an', 52)}
        <div class="stack g2 grow"><span class="h2" style="font-size:18px">Amara Nwosu</span><span class="small dim" style="font-size:12.5px">amara@nwosu.co</span></div>
        <span class="chip chip-sm">${ic('pen', 11)}Edit</span>
      </div>
    </div>
  </div>
  ${lbl('Your gyms')}
  <div style="padding:0 16px 14px">
    <div class="ruled">
      ${listrow({ lead: gymTile('F', 30, 9), title: 'Forge Barbell Club', sub: 'Member since March 2025', chip: '<span class="chip chip-sm chip-ok">Active</span>' })}
      ${listrow({ lead: gymTile('S', 30, 9) .replace('var(--accent)', '#3b6ba5'), title: 'Southbank S&amp;C', sub: 'Left in Jan 2025 · history kept', chip: '<span class="chip chip-sm">Past</span>' })}
    </div>
  </div>
  ${lbl('Settings')}
  <div style="padding:0 16px">
    ${setting({ title: 'Dark mode', sub: 'Follows nothing — this is your choice, on every device.', control: sw(false) })}
    ${setting({ title: 'Class reminders', sub: 'A push an hour before anything you are booked into.', control: sw(true) })}
    ${setting({ title: 'Email from the gym', sub: 'Newsletters and notices. Booking and payment emails always send.', control: sw(true) })}
    ${setting({ title: 'Show me on leaderboards', sub: 'Off hides your name from everyone but you and your coaches.', control: sw(true) })}
  </div>
  ${lbl('Your data')}
  <div style="padding:0 16px 16px">
    ${setting({ title: 'Health data', sub: 'PAR-Q answers and injuries. Withdraw and it is erased within the hour.', control: `<span class="btn btn-plain btn-sm">Withdraw</span>` })}
    ${setting({ title: 'Download everything', sub: 'A copy of your training history, bookings and messages.', control: `<span class="btn btn-plain btn-sm">Request</span>` })}
  </div>
  <div style="padding:0 16px 4px">
    <div class="row between" style="padding:14px 15px;border:1px solid var(--bad);border-radius:var(--r-card)">
      <div class="stack g2 grow"><span class="h3" style="color:var(--bad)">Leave Forge Barbell Club</span><span class="small dim" style="font-size:12.5px">Cancels your plan. Your training history stays yours.</span></div>
    </div>
  </div>
</div>`;

  const leaveConfirm = () => `
${subBar('Account')}
<div class="scrollarea" style="opacity:.5">
  <div style="padding:4px 16px 14px"><div class="card" style="height:76px"></div></div>
  <div style="padding:0 16px">${[0, 1, 2].map(() => `<div class="setting" style="height:64px"></div>`).join('')}</div>
</div>
${sheet({
  title: 'Leave Forge Barbell Club?',
  body: `
    <div class="small" style="font-size:13.5px;line-height:1.55">
      Your Unlimited monthly plan is cancelled today and you will not be
      charged again. Your 2 remaining pack credits are lost.
    </div>
    <div class="stack g10" style="margin-top:14px">
      ${[['Your training history stays with you', 'Every lift and PR you have logged follows you to any gym.', 'check'],
         ['Your health data is erased', 'PAR-Q answers and injuries go within the hour.', 'shield'],
         ['Your waiver is kept', 'Signed waivers are retained as a liability record.', 'doc']]
        .map(([t, d, i]) => `
        <div class="row g10" style="align-items:flex-start">
          ${ic(i, 16, 'color:var(--ink-3);margin-top:2px')}
          <div class="stack g2 grow"><span class="h3" style="font-size:13.5px">${t}</span><span class="small dim" style="font-size:12.5px;line-height:1.4">${d}</span></div>
        </div>`).join('')}
    </div>`,
  actions: `<span class="btn btn-plain">Stay a member</span><span class="btn" style="background:var(--bad);color:#fff;flex:1">Leave the gym</span>`,
})}`;

  const family = () => `
${subBar('Family')}
<div class="scrollarea">
  ${pagehead('Family', 'Book and track for the people you look after.', `<span class="btn btn-accent btn-sm" style="height:36px">${ic('plus', 15)}Add</span>`)}
  <div style="padding:0 16px">
    ${[['Kai Nwosu', '11 · Juniors', 'ok', 'PAR-Q done'], ['Ada Nwosu', '8 · Juniors', 'warn', 'PAR-Q due']]
      .map(([n, s, tone, state]) => `
      <div class="listrow">
        ${AV(n.split(' ').map((x) => x[0].toLowerCase()).join(''), 36)}
        <div class="stack g2 grow" style="min-width:0"><span class="h3">${n}</span><span class="small dim" style="font-size:12.5px">${s}</span></div>
        <span class="chip chip-sm ${tone === 'ok' ? 'chip-ok' : 'chip-warn'}">${state}</span>
      </div>`).join('')}
  </div>
  <div style="padding:16px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10" style="align-items:flex-start">${ic('shield', 17, 'color:var(--ink-3);margin-top:1px')}
        <span class="small grow" style="font-size:12.5px;line-height:1.45">You answer their health screening and sign their waiver. They do not get their own login until they turn 16.</span></div>
    </div>
  </div>
</div>`;

  const emails = () => `
${subBar('Email preferences')}
<div class="scrollarea">
  <div style="padding:4px 16px 0">
    <div class="body" style="font-size:14px">Booking confirmations, payment receipts and anything about your account always send — the rest is up to you.</div>
  </div>
  <div style="padding:16px 16px 0">
    ${lbl('From Forge Barbell Club')}
    ${setting({ title: 'Newsletter', sub: 'Monthly. What happened, what is coming.', control: sw(true) })}
    ${setting({ title: 'Class and schedule changes', sub: 'Only when something you booked moves or is cancelled.', control: sw(true) })}
    ${setting({ title: 'Offers and events', sub: 'Competitions, socials, anything being sold.', control: sw(false) })}
    ${setting({ title: 'Coaching nudges', sub: 'When a coach thinks you have been quiet for a while.', control: sw(false) })}
  </div>
  <div style="padding:16px 16px 0">
    <div class="card" style="background:var(--surface-2);border-color:transparent">
      <div class="row g10">${ic('mail', 17, 'color:var(--ink-3)')}
        <span class="small grow" style="font-size:12.5px;line-height:1.45">Every email we send carries this page as a one-tap link, so you never have to hunt for it.</span></div>
    </div>
  </div>
</div>`;

  return page({
    title: 'Member — Account, leaving, family, email',
    sub: 'Pattern 6, Settings: one card per decision with its own save, no page-level Save spanning several cards. Destructive lives at the bottom in its own bordered block and always opens the full consequence sheet.',
    extraCss: WIDE,
    content: row(
      phone(account(), { label: 'Account' }) +
      phone(leaveConfirm(), { label: 'Leaving — consequence sheet' }) +
      phone(family(), { label: 'Family' }) +
      phone(emails(), { label: 'Email preferences' }),
    ),
  });
}
