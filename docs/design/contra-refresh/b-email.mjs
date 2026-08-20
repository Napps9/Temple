// Board 32 — Email: seven routes to four.
//
// Communications was seven screens for three jobs. Three of them were a
// Screen, a BackLink and a PageHead wrapped around something small
// enough to be a section of the page that linked to it:
//
//   /communications/automations   a list of four rows and a switch each
//   /communications/topics        one decision, and the form to add one
//   /communications/new           a spinner that inserted a row and
//                                 redirected, on screen for a second
//
// The directory had a card for each, so the owner tapped a card to reach
// a page whose body would have fitted on the card's own page. That is
// three taps and three back-navigations to see what is now visible at
// once.
//
// The two records stay. A campaign has an audience and a send; an
// automation has a trigger and a wait. They are different objects and
// merging them would cost more than the route saved.
import { AV, ic, note, page, phone, row, staffBar, body, sw } from './kit.mjs';

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

const stats = `
<div class="row g10" style="padding:0 16px">
  ${[['Campaigns', '12'], ['Sent', '9'], ['Emails delivered', '1,824']]
    .map(
      ([l, v]) => `<div class="card grow" style="padding:12px 14px;min-width:96px">
        <span class="num" style="font-size:22px">${v}</span>
        <span class="lbl" style="display:block;margin-top:2px">${l}</span>
      </div>`,
    )
    .join('')}
</div>`;

const doorCard = (icon, title, blurb) => `
<div style="padding:0 16px">
  <div class="card" style="padding:14px;flex-direction:row;align-items:center;gap:12px;display:flex">
    <span style="width:36px;height:36px;border-radius:10px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex:none">${ic(icon, 17, 'color:var(--ink-2)')}</span>
    <div class="stack g2 grow" style="min-width:0">
      <span class="h3">${title}</span>
      <span class="small dim" style="font-size:12px">${blurb}</span>
    </div>
    ${ic('right', 15, 'color:var(--ink-3)')}
  </div>
</div>`;

const campaignRow = (title, sub, status, tone) => `
<div class="card" style="padding:14px;flex-direction:row;align-items:center;gap:12px;display:flex">
  <div class="stack g2 grow" style="min-width:0">
    <div class="row g8"><span class="h3 trunc">${title}</span><span class="chip chip-sm ${tone}">${status}</span></div>
    <span class="small dim trunc" style="font-size:12px">${sub}</span>
  </div>
  ${ic('right', 15, 'color:var(--ink-3)')}
</div>`;

const automationRow = (name, trigger, on) => `
<div class="card" style="padding:14px;flex-direction:row;align-items:center;gap:12px;display:flex">
  <div class="stack g2 grow" style="min-width:0">
    <span class="h3 trunc">${name}</span>
    <span class="small dim trunc" style="font-size:12px">${trigger}</span>
  </div>
  ${sw(on)}
</div>`;

const section = (label, right, rows) => `
<div class="stack g8" style="padding:0 16px">
  <div class="row between"><span class="lbl">${label}</span>${right}</div>
  <div class="stack g8">${rows}</div>
</div>`;

/* -------------------------------------------------------------- before */

const before = stack([
  back,
  head('Email campaigns', 'Design, send and analyse email campaigns to your members.'),
  stats,
  doorCard('gear', 'Sender & footer', 'From name, reply-to, and the required postal-address footer.'),
  doorCard('panel', 'Email topics', 'Let members subscribe and unsubscribe per topic.'),
  doorCard('bolt', 'Automations', 'Emails that send themselves — welcome, win-back, lead nurture.'),
  `<div style="padding:0 16px"><span class="btn btn-accent btn-full">${ic('plus', 16)}New campaign</span></div>`,
  `<div class="stack g8" style="padding:0 16px">
    ${campaignRow('March newsletter', 'What is on this month · sent 4 Mar', 'Sent', 'chip-ok')}
    ${campaignRow('Easter timetable', 'No subject yet', 'Draft', '')}
  </div>`,
]);

/* --------------------------------------------------------------- after */

const after = stack([
  back,
  head(
    'Email',
    'Campaigns you send, and the ones that send themselves.',
    '<span class="btn btn-accent btn-sm">New campaign</span>',
  ),
  stats,
  section(
    'Campaigns',
    '',
    campaignRow('March newsletter', 'What is on this month · sent 4 Mar', 'Sent', 'chip-ok') +
      campaignRow('Easter timetable', 'No subject yet', 'Draft', ''),
  ),
  section(
    'Automations',
    '<span class="btn btn-plain btn-sm">New</span>',
    automationRow('Welcome', 'When a member joins', true) +
      automationRow('First class follow-up', 'After a member’s first class', true) +
      automationRow('Win-back', 'When a member goes quiet', false),
  ),
  doorCard(
    'gear',
    'Email settings',
    'Sender, the postal-address footer, and the topics members can unsubscribe from.',
  ),
]);

const settings = stack([
  back,
  head(
    'Email settings',
    'How your emails are addressed, the footer every marketing email must carry, and what a member can unsubscribe from separately.',
  ),
  `<div style="padding:0 16px">
    <div class="card" style="padding:14px;gap:10px">
      <span class="h3">Sender</span>
      <div class="stack g6"><span class="lbl">From name</span><div class="input">Forge Barbell Club</div></div>
      <div class="stack g6"><span class="lbl">Reply-to</span><div class="input">hello@forge.club</div></div>
      <div class="row" style="justify-content:flex-end"><span class="btn btn-dark btn-sm">Save</span></div>
    </div>
  </div>`,
  section(
    'Topics',
    '',
    `<div class="card" style="padding:14px;gap:10px">
      <div class="stack g2">
        <span class="h3">Add a topic</span>
        <span class="small dim" style="font-size:12.5px">Someone who unsubscribes from “Promos” still gets “Billing reminders”.</span>
      </div>
      <div class="stack g6"><span class="lbl">Label</span><div class="input empty">Newsletter</div></div>
      <div class="row" style="justify-content:flex-end"><span class="btn btn-dark btn-sm">Add topic</span></div>
    </div>
    <div class="card" style="padding:14px;flex-direction:row;align-items:flex-start;gap:12px;display:flex">
      <div class="stack g2 grow"><span class="h3">Newsletter</span><span class="small dim" style="font-size:12px">What is on this month</span></div>
      ${ic('close', 15, 'color:var(--ink-3)')}
    </div>`,
  ),
]);

/* -------------------------------------------------------------- the board */

export const emailBoard = () =>
  page({
    title: 'Email: seven routes to four',
    sub: 'Three of the seven were a Screen, a BackLink and a heading around something small enough to be a section of the page that linked to it. They are sections and a button now.',
    content: `
${row(
  phone(body(staffBar('manage') + before), { label: 'before — three doors' }) +
    phone(body(staffBar('manage') + after), { label: 'after — one page' }) +
    phone(body(staffBar('manage') + settings), { label: 'settings — dark', dark: true }),
)}
${note(
  'On the left the owner sees three cards describing lists they cannot see, then their campaigns. On the right the automations are on the page — with their switches, so turning one off is one tap from the directory rather than three. The settings card is the only door left, because sender, footer, suppressed addresses and topics are genuinely a settings page.',
)}
${row(
  `<div class="card flush" style="max-width:900px;width:100%">
    <div class="row g12" style="padding:12px 16px">
      <span class="lbl" style="width:280px;flex:none">Route</span>
      <span class="lbl grow">What happened</span>
    </div>
    ${[
      ['/communications', 'the directory — campaigns and automations, both visible'],
      ['/communications/[id]', 'the campaign record, unchanged'],
      ['/communications/automations/[id]', 'the automation record, unchanged'],
      ['/communications/settings', 'sender, footer, suppressed addresses, and now topics'],
      ['<s>/communications/automations</s>', 'a section of the directory'],
      ['<s>/communications/topics</s>', 'a section of settings'],
      ['<s>/communications/new</s>', 'a button with a loading state'],
    ]
      .map(
        ([a, b]) => `<div class="row g12" style="padding:11px 16px;border-top:1px solid var(--line)">
          <span class="small" style="width:280px;flex:none;font-size:12.5px;font-family:ui-monospace,monospace">${a}</span>
          <span class="small dim grow" style="font-size:12.5px">${b}</span>
        </div>`,
      )
      .join('')}
  </div>`,
)}
${note(
  'The two records stay. A campaign has an audience and a send; an automation has a trigger and a wait. They are different objects, and merging them would cost more than the route saved. Each retirement is recorded in <code>RETIRED_ROUTES</code> with its reason, which a test asserts — the burndown counts 12 now, from 9.',
)}
`,
  });
