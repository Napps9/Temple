// Board 27 — the page head, adopted.
//
// Forty-one screens were carrying a hand-rolled title block: a bare
// `<View className="gap-1">` with a 24px semibold Text and a 16px
// subtitle under it. Each was written separately, so each was slightly
// different — gap-1 or gap-2, semibold or bold, a subtitle at body size
// or at text-sm.
//
// They now all call PageHead. Same three things on every screen, at one
// size, in one order: what the page is, what it is showing, and at most
// one action. Drawn here on the two screens where the difference is
// easiest to read — Members, which had the longest subtitle in the
// product, and Plans.
import {
  AV,
  body,
  chips,
  field,
  ic,
  note,
  page,
  phone,
  row,
  staffBar,
} from './kit.mjs';

/* ------------------------------------------------------------- the heads */

// What 41 screens had: text-2xl (24px) semibold, subtitle at body size.
const oldHead = (title, sub) => `
<div style="display:flex;flex-direction:column;gap:8px;padding:0 16px 2px">
  <span style="font-size:24px;font-weight:600;letter-spacing:-.01em;line-height:1.2">${title}</span>
  ${sub ? `<span class="body" style="font-size:16px;line-height:1.4">${sub}</span>` : ''}
</div>`;

// PageHead: 26px bold, tighter tracking, subtitle at 14px/20px.
const newHead = (title, sub, action = '') => `
<div style="display:flex;align-items:flex-start;gap:12px;padding:0 16px">
  <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
    <span style="font-size:26px;font-weight:700;letter-spacing:-.8px;line-height:29px">${title}</span>
    ${sub ? `<span class="body" style="font-size:14px;line-height:20px">${sub}</span>` : ''}
  </div>
  ${action}
</div>`;

/* ----------------------------------------------------------- the screens */

const back = `
<div style="padding:0 16px">
  <span class="chip chip-sm" style="padding-left:7px">${ic('left', 13)}Back</span>
</div>`;

const memberCard = (initials, name, meta, badge) => `
<div class="card" style="padding:14px;gap:8px">
  <div class="row g12">
    ${AV(initials, 36)}
    <div class="stack g2 grow" style="min-width:0">
      <span class="h3 trunc">${name}</span>
      <span class="small dim trunc" style="font-size:12px">${meta}</span>
    </div>
    ${badge}
  </div>
</div>`;

const badge = (label, color) =>
  `<span class="chip chip-sm" style="border-color:${color}55;color:${color};background:${color}14">${label}</span>`;

const stack = (parts) =>
  `<div style="display:flex;flex-direction:column;gap:16px;padding-bottom:20px">${parts.join('')}</div>`;

const membersBody = (head) =>
  stack([
    back,
    head,
    `<div style="padding:0 16px">
  <span class="chip chip-sm">${ic('down', 12)}Export members CSV</span>
</div>`,
    `<div style="padding:0 16px">
  <div class="card" style="padding:14px;gap:10px">
    <div class="stack g2">
      <span class="h3">Invite members</span>
      <span class="small dim" style="font-size:12.5px">Email a member an invite to join your gym.</span>
    </div>
    ${field('Email address', '', { hint: 'member@example.com' })}
    <span class="btn btn-accent btn-full">Email member invite</span>
  </div>
</div>`,
    `<div style="padding:0 16px">${field('Search', '', { hint: 'Name' })}</div>`,
    chips([['All', true], ['Intro', false], ['Expiring', false], ['Expired', false], ['Active', false], ['Children', false]], '0 16px'),
    `<div class="stack g10" style="padding:0 16px">
  ${memberCard('an', 'Amara Nwosu', 'Unlimited · joined Mar 2025', badge('Active', '#059669'))}
  ${memberCard('mb', 'Marcus Bell', '10-class pack · 3 cr left', badge('Expiring', '#D97706'))}
  ${memberCard('bh', 'Bea Hollins', 'Intro offer · 2 sessions in', badge('Intro', '#4F46E5'))}
</div>`,
  ]);

const planCard = (name, price, meta) => `
<div class="card" style="padding:14px;gap:6px">
  <div class="row between">
    <span class="h3">${name}</span>
    <span class="num" style="font-size:15px">${price}</span>
  </div>
  <span class="small dim" style="font-size:12.5px">${meta}</span>
</div>`;

const plansBody = (head) =>
  stack([
    back,
    head,
    `<div class="stack g10" style="padding:0 16px">
  ${planCard('Unlimited', '£89/mo', '54 subscribers · unlimited classes')}
  ${planCard('10-class pack', '£95', '31 subscribers · credits never expire')}
  ${planCard('Intro offer', '£25', '8 subscribers · 2 weeks, then converts')}
  <span class="btn btn-accent btn-full">Add a plan</span>
</div>`,
  ]);

/* -------------------------------------------------------------- the board */

const MEMBERS_SUB =
  '214 members. Filter by cohort or search by name. Tap a member to open their detail page.';
const PLANS_SUB =
  'Define your membership plans. Existing subscribers keep the price and credits they signed up with — editing a plan only changes what new subscribers get.';

export const headsBoard = () =>
  page({
    title: 'The page head, adopted',
    sub: 'Forty-one screens had written their own title block. They now call one part — so a title is the same size, weight and tracking on every page, and a subtitle is the same size as every other subtitle in the product.',
    content: `
${row(
  phone(body(staffBar('manage') + membersBody(oldHead('Members', MEMBERS_SUB))), {
    label: 'before — hand-rolled',
  }) +
    phone(body(staffBar('manage') + membersBody(newHead('Members', MEMBERS_SUB))), {
      label: 'after — PageHead',
    }) +
    phone(body(staffBar('manage') + plansBody(newHead('Plans', PLANS_SUB))), {
      label: 'after — dark',
      dark: true,
    }),
)}
${note(
  'The title goes from 24px semibold to 26px bold at -0.8px tracking, and the subtitle from body size down to 14px/20px — so the head reads as one thing with a caption rather than two paragraphs. The part draws no padding of its own: every screen ScrollView already carries <code>px-4</code> and a stack gap, and a head that added its own sat indented from the cards beneath it.',
)}
${row(
  phone(
    body(
      staffBar('manage') +
        stack([
          back,
          newHead(
            'Leads',
            'Track prospects from first contact through conversion.',
            '<span class="btn btn-accent btn-sm">Add lead</span>',
          ),
          chips([['All', true], ['New', false], ['Contacted', false], ['Trial', false]], '0 16px'),
          `<div class="stack g10" style="padding:0 16px">
          ${memberCard('jt', 'Jonah Tait', 'Instagram · 2 days ago', badge('New', '#4F46E5'))}
          ${memberCard('pk', 'Priya Kaur', 'Walk-in · contacted', badge('Contacted', '#0891B2'))}
          ${memberCard('sd', 'Sam Doyle', 'Website · trial booked', badge('Trial', '#059669'))}
        </div>`,
        ]),
    ),
    { label: 'one action, in the head' },
  ) +
    phone(
      body(
        staffBar('manage') +
          stack([
            back,
            newHead(
              'Edit campaign',
              'Build your email, choose who gets it, then send.',
              '<span class="chip chip-sm">Saved</span>',
            ),
            `<div class="stack g10" style="padding:0 16px">
            <div class="card" style="padding:14px;gap:10px">
              ${field('Title', 'March newsletter')}
              ${field('Subject', 'What is on this month at Forge')}
            </div>
            <div class="card stack g4" style="padding:14px">
              <span class="lbl">Audience</span>
              <span class="h3">All active members</span>
              <span class="small dim" style="font-size:12.5px">214 recipients · 3 unsubscribed from this topic</span>
            </div>
          </div>`,
          ]),
      ),
      { label: 'a save state, in the head' },
    ),
)}
${note(
  'The one action a page has moves into the head, where it is the only thing allowed to carry the gym’s colour. Campaign’s save button and Leads’ “Add lead” were both sitting in a hand-built flex row beside the title; they are now the head’s <code>action</code> slot, so they line up with the title’s first line on every screen that has one.',
)}
`,
  });
