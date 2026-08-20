// Board 23 — the four decisions still open.
//
// Each one is drawn as a comparison rather than a proposal, because each
// is genuinely a choice and two of them cost real work to reverse. Where
// there is a recommendation it says so and says why; where the trade is
// close it says that instead.
import {
  AV,
  chips,
  dot,
  gymTile,
  ic,
  listrow,
  memberBar,
  note,
  orb,
  page,
  pagehead,
  phone,
  row,
  staffBar,
  TYPE,
  wordmark,
  mark,
} from './kit.mjs';

/* ============================================ 1. the staff navigation */

const navRow = (icon, label, { on, trail, orbIcon } = {}) => `
  <div class="navrow ${on ? 'on' : ''}">
    ${orbIcon ? orb(19) : `<span style="color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${ic(icon, 19)}</span>`}
    <span class="grow">${label}</span>${trail ?? ''}
  </div>`;

const sidebar = () => `
  <div class="side">
    <div class="row between" style="padding:2px 4px 0">${wordmark(17, 'var(--ink)')}<span style="color:var(--ink-3)">${ic('panel', 17)}</span></div>
    <div class="card" style="padding:9px 11px;border-radius:var(--r-ctl)">
      <div class="row g10">${gymTile('F')}
        <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:13.5px">Forge Barbell Club</span><span class="small dim trunc" style="font-size:12px">Dani Okafor · Owner</span></div>
        ${ic('right', 14, 'color:var(--ink-3)')}</div>
    </div>
    <span class="btn btn-dark btn-full" style="height:40px;border-radius:var(--r-ctl)">${ic('plus', 16)}Create</span>
    <div class="stack g2">
      ${navRow('chat', 'Timeline')}
      ${navRow('barbell', 'Programming')}
      ${navRow('cal', 'Classes')}
      ${navRow('grid', 'Manage')}
      ${navRow('', 'Co—Agent', { orbIcon: true })}
    </div>
    <div class="stack g2" style="margin-top:4px">
      <span class="lbl" style="padding:8px 12px 4px">The gym</span>
      ${navRow('people', 'Members', { on: true, trail: '<span class="small dim" style="font-size:12.5px">214</span>' })}
      ${navRow('card', 'Billing', { trail: '<span class="small dim" style="font-size:12.5px">£14.3k</span>' })}
      ${navRow('mail', 'Communications')}
      ${navRow('gear', 'Settings')}
    </div>
  </div>`;

const memberTableRow = (init, name, plan, tone, tags, first) => `
  <div class="row g12" style="padding:10px 16px;${first ? '' : 'border-top:1px solid var(--line)'}">
    ${AV(init, 30)}
    <span class="h3" style="width:200px;font-size:14px">${name}</span>
    <span style="width:148px"><span class="chip chip-sm ${tone}">${plan}</span></span>
    <span class="row g6 grow">${tags.map((t) => `<span class="chip chip-sm">${t}</span>`).join('')}</span>
    ${ic('right', 14, 'color:var(--ink-3)')}
  </div>`;

const membersTable = `
  <div class="card flush" style="margin-top:18px">
    <div class="row g12" style="padding:13px 16px;border-bottom:1px solid var(--line)">
      <div class="field grow" style="min-height:36px;padding-left:14px;font-size:14px">${ic('search', 15, 'color:var(--ink-3)')}<span class="grow dim">Search members</span></div>
      <span class="chip chip-sm">All plans</span><span class="chip chip-sm">All tags</span>
    </div>
    ${memberTableRow('an', 'Amara Nwosu', 'Payment failed', 'chip-bad', ['Evenings', 'Metcon'], true)}
    ${memberTableRow('mb', 'Marcus Bell', 'Unlimited', 'chip-ok', ['New'])}
    ${memberTableRow('lk', 'Leila Karim', '10-class pack', 'chip-ok', ['Mornings'])}
    ${memberTableRow('ro', 'Ravi Oduya', 'Unlimited', 'chip-ok', ['Coach'])}
  </div>`;

const membersHead = `
  <div class="row between" style="align-items:flex-end">
    <div class="stack g4"><span class="h1" style="font-size:28px">Members</span><span class="body">214 active · 6 joined this month · 3 lapsing</span></div>
    <div class="row g8"><span class="btn btn-plain btn-sm">Import</span><span class="btn btn-accent btn-sm">${ic('plus', 15)}Invite</span></div>
  </div>`;

const desk = (inner, url) => `
<div class="app" style="background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:14px;overflow:hidden">
  <div class="deskbar"><b></b><b></b><b></b><span class="url">${url}</span></div>
  ${inner}
</div>`;

const deskToday = desk(
  `<div style="min-height:560px">
     ${staffBar('manage')}
     <div style="padding:22px 26px 30px;max-width:none">
       ${membersHead}
       ${membersTable}
     </div>
   </div>`,
  'app.jointemple.io/management/members',
);

const deskSidebar = desk(
  `<div style="display:flex;align-items:stretch;min-height:560px">
     ${sidebar()}
     <div class="grow" style="padding:22px 24px 30px;min-width:0">
       ${membersHead}
       ${membersTable}
     </div>
   </div>`,
  'app.jointemple.io/management/members',
);

/* =================================================== 2. the type face */

const typeSpecimen = (fontVar, name, sub) => `
  <div class="card grow" style="min-width:0;padding:18px 20px;font-family:${fontVar}">
    <span class="lbl">${name}</span>
    <div style="font-size:28px;font-weight:700;letter-spacing:-0.032em;line-height:1.1;margin-top:10px">Thursday 21 August</div>
    <div style="font-size:15px;line-height:1.5;color:var(--ink-2);margin-top:6px">${sub}</div>
    <div class="rule" style="margin:14px 0"></div>
    <div class="row between">
      <div class="stack g2">
        <span style="font-size:15.5px;font-weight:600;letter-spacing:-0.014em">Metcon</span>
        <span style="font-size:12.5px;color:var(--ink-3)">17:30 · Priya Raman · 60 min</span>
      </div>
      <span style="font-size:22px;font-weight:700;letter-spacing:-0.03em;font-variant-numeric:tabular-nums">17/20</span>
    </div>
    <div class="rule" style="margin:14px 0"></div>
    <div class="row g8">
      <span style="font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)">Your next class</span>
    </div>
    <div style="font-size:13.5px;line-height:1.45;color:var(--ink-2);margin-top:8px">
      Handles ambiguous shapes: 1 l I i · 0 O o · rn m · £68.00 · 06:00
    </div>
  </div>`;

/* ====================================================== 3. the mark */

const currentMark = (size) => `
<svg viewBox="-18 -8 108 108" width="${size}" height="${size}" fill="none" style="flex:none;display:block">
  <rect x="20" y="20" width="72" height="72" rx="5" fill="#E8B620"/>
  <rect x="47" y="40" width="20" height="52" fill="#F4F2ED"/><ellipse cx="57" cy="40" rx="10" ry="7.5" fill="#F4F2ED"/>
  <rect x="10" y="10" width="72" height="72" rx="5" fill="#3B6BA5"/>
  <rect x="37" y="30" width="20" height="52" fill="#F4F2ED"/><ellipse cx="47" cy="30" rx="10" ry="7.5" fill="#F4F2ED"/>
  <rect x="0" y="0" width="72" height="72" rx="5" fill="#111111"/>
  <rect x="27" y="30" width="18" height="42" rx="0.5" fill="#F4F2ED"/><ellipse cx="36" cy="31.5" rx="9" ry="6" fill="#F4F2ED"/>
</svg>`;

// The current mark, monochrome: the two cards behind become hairlines and
// the column is knocked out of the front card. `hole` has to be passed
// explicitly rather than read from a CSS variable — the mark is drawn on
// a dark tile as well as a light one, and there the knockout is the tile.
const flatMark = (size, color = '#14161a', hole) => `
<svg viewBox="-18 -8 108 108" width="${size}" height="${size}" fill="none" style="flex:none;display:block">
  <rect x="20.8" y="20.8" width="70.4" height="70.4" rx="5" fill="none" stroke="${color}" stroke-width="2" stroke-opacity=".3"/>
  <rect x="10.8" y="10.8" width="70.4" height="70.4" rx="5" fill="none" stroke="${color}" stroke-width="2" stroke-opacity=".55"/>
  <rect x="0" y="0" width="72" height="72" rx="5" fill="${color}"/>
  <rect x="27" y="30" width="18" height="42" rx="0.5" fill="${hole ?? '#F7F7F8'}"/>
  <ellipse cx="36" cy="31.5" rx="9" ry="6" fill="${hole ?? '#F7F7F8'}"/>
</svg>`;

const upperWordmark = (size) => `
  <span style="font-weight:800;letter-spacing:${(size * 0.14).toFixed(1)}px;font-size:${size}px;color:var(--ink)">TEMPLE</span>`;

const markOption = ({ tag, name, glyph, word, tagline, why, rec }) => `
  <div class="card grow" style="min-width:0;padding:0;overflow:hidden;${rec ? 'border-color:var(--ink)' : ''}">
    <div class="row between" style="padding:12px 16px;border-bottom:1px solid var(--line)">
      <span class="lbl">${tag}</span>${rec ? '<span class="badge">Recommended</span>' : ''}
    </div>
    <div style="padding:22px 16px;display:flex;flex-direction:column;align-items:center;gap:18px;background:var(--surface-2)">
      <div class="row" style="gap:12px;align-items:center">${glyph(44)}
        <div class="stack" style="gap:1px;align-items:flex-start">${word(26)}${
          tagline
            ? `<span style="font-size:8px;letter-spacing:2.4px;font-weight:500;color:#5A5550">TECHNOLOGY</span>`
            : ''
        }</div></div>
      <div class="row" style="gap:22px;align-items:center">
        ${glyph(15)}${glyph(22)}${glyph(30)}
      </div>
      <div class="row" style="gap:10px;align-items:center">
        <span style="width:52px;height:52px;border-radius:12px;background:var(--surface);border:1px solid var(--line-strong);display:flex;align-items:center;justify-content:center">${glyph(30)}</span>
        <span style="width:52px;height:52px;border-radius:12px;background:#0a0b0d;display:flex;align-items:center;justify-content:center">${glyph(30, '#f4f5f6')}</span>
      </div>
    </div>
    <div style="padding:13px 16px"><span class="small" style="font-size:12.5px;line-height:1.45">${name} — ${why}</span></div>
  </div>`;

/* ============================================ 4. the primary action */

const bookRow = (typeColor, name, when, count, btnClass) => `
  <div class="row g12" style="padding:12px 14px;border-top:1px solid var(--line)">
    ${dot(typeColor)}
    <div class="stack g2 grow" style="min-width:0">
      <span class="h3" style="font-size:14.5px">${name}</span>
      <span class="small dim" style="font-size:12.5px">${when} · ${count}</span>
    </div>
    <span class="btn ${btnClass} btn-sm">Book</span>
  </div>`;

const bookPhone = (btnClass, primaryClass, label) =>
  phone(
    `${memberBar('book')}
     <div class="scrollarea">
       ${pagehead('Book', 'Thursday 21 August')}
       ${chips([['All', true], ['Strength', false, dot(TYPE.strength)], ['Metcon', false, dot(TYPE.metcon)]])}
       <div style="padding:0 16px">
         <div class="card flush">
           <div class="row g12" style="padding:12px 14px">
             ${dot(TYPE.strength)}
             <div class="stack g2 grow" style="min-width:0">
               <span class="h3" style="font-size:14.5px">Strength</span>
               <span class="small dim" style="font-size:12.5px">06:00 · Priya · 12/16</span>
             </div>
             <span class="btn ${btnClass} btn-sm">Book</span>
           </div>
           ${bookRow(TYPE.metcon, 'Metcon', '17:30 · Priya', '17/20', btnClass)}
           ${bookRow(TYPE.open, 'Open gym', '19:00', '4/30', btnClass)}
           ${bookRow(TYPE.barbell, 'Barbell club', '20:00 · Ravi', '6/12', btnClass)}
         </div>
         <div style="height:12px"></div>
         <div class="card" style="padding:14px">
           <span class="lbl">Your next class</span>
           <div class="row between" style="margin-top:9px">
             <div class="stack g2"><span class="h3">Metcon</span><span class="small dim" style="font-size:12.5px">Thursday at 17:30</span></div>
             <span class="btn ${primaryClass} btn-sm">Check in</span>
           </div>
         </div>
       </div>
     </div>`,
    { label },
  );

/* =========================================================== the board */

const section = (n, title, blurb, inner) => `
  <div style="margin-top:34px">
    <div class="row g10" style="align-items:baseline">
      <span class="lbl">Decision ${n}</span>
      <span class="h2" style="font-size:19px">${title}</span>
    </div>
    <div class="small" style="margin-top:7px;font-size:13.5px;max-width:820px">${blurb}</div>
    ${inner}
  </div>`;

export function decisionsBoard() {
  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="card" style="padding:20px 22px">
    <span class="lbl">Where this is</span>
    <div class="h2" style="margin-top:8px;font-size:19px">The system is live. The pages are not.</div>
    <div class="small" style="margin-top:8px;font-size:13.5px;max-width:780px">
      The ramp, the page parts, the one modal and the app shell are in
      production. What is still on the old classes is the inside of every
      page — Book, Timeline, Track, Manage. Four decisions come before that
      work rather than after it, because each one changes what those pages
      get migrated <i>to</i>, and doing them in the other order means
      restyling the same ninety screens twice.
    </div>
  </div>

  ${section(
    1,
    'Where staff navigation lives on a desktop',
    'The phone is unchanged either way — this is only about 768px and up. Today the four staff sections are a pill bar centred in a wide window, which leaves the top third of a 1400px screen doing nothing and gives a nested page nowhere to put Members, Billing, Communications and Settings except behind Manage. A sidebar puts the whole gym one click deep and gives the agent a permanent home. It is also the only proposal here with routing work behind it: the staff group would need a layout that renders a persistent rail above the tab router.',
    `<div class="stack g20" style="margin-top:18px">
       <div class="stack g10">
         <span class="frame-label">A · Today — the pill bar, at desktop width</span>
         ${deskToday}
       </div>
       <div class="stack g10">
         <span class="frame-label">B · Proposed — a left sidebar above 768px</span>
         ${deskSidebar}
       </div>
     </div>`,
  )}

  ${section(
    2,
    'Whether to ship a typeface at all',
    'Temple has never loaded one. Every screen you have ever seen renders in the platform default — San Francisco on iPhone, Roboto on Android, and whatever the browser picks on web, which is why the app looks subtly like three different products. tailwind.config.js names a `display` family that nothing uses and nothing loads. Geist is a neutral, tightly-spaced grotesque with real tabular figures, which matters on a screen that is mostly times and counts. The cost is honest: React Native has no font inheritance, so every Text needs the family set, and the web build pays a download before first paint.',
    `<div class="row g16" style="margin-top:18px;align-items:stretch">
       ${typeSpecimen('system-ui, -apple-system, sans-serif', 'A · Today — the platform default', 'Nothing is loaded. This renders differently on every device.')}
       ${typeSpecimen("'Geist', system-ui, sans-serif", 'B · Proposed — Geist everywhere', 'One face on every platform, with tabular figures.')}
     </div>
     ${note('Whichever way this goes, it wants deciding before the page migration: setting the family on every Text is cheap while a page is being rewritten anyway and tedious afterwards.')}`,
  )}

  ${section(
    3,
    'Whether the Temple mark changes',
    'The current mark is a considered identity with a documented palette, not a placeholder — three offset cards, gold and steel-blue behind ink, each holding a column. What has changed underneath it is the system: the new one gets depth from a hairline and a tone step, uses no gradients, and puts colour only in content. The current mark is built on the two things that system removed. Three ways out, and the middle one keeps the equity.',
    `<div class="row g16" style="margin-top:18px;align-items:stretch">
       ${markOption({
         tag: 'A · Keep it',
         name: 'Three cards, colour',
         glyph: (s) => currentMark(s),
         word: (s) => upperWordmark(s),
         tagline: true,
         why: 'Nothing to do, and the identity stays recognisable. It is also the only place left in the product with a drop-shadow-and-colour idea, so it will read as older than the app around it.',
       })}
       ${markOption({
         tag: 'B · Flatten it',
         name: 'Three cards, one ink',
         glyph: (s, c) => flatMark(s, c ?? '#14161a', c ? '#0a0b0d' : undefined),
         word: (s) => wordmark(s, 'var(--ink)'),
         why: 'Same silhouette and the same story, monochrome: the two cards behind become hairlines. Keeps what people already recognise and drops the two things the system rejects.',
         rec: true,
       })}
       ${markOption({
         tag: 'C · Replace it',
         name: 'Portico',
         glyph: (s, c) => mark('portico', s, c ?? '#14161a'),
         word: (s) => wordmark(s, 'var(--ink)'),
         why: 'A single flat glyph that still reads as a building at 15px. Cleanest fit with the system and the biggest throw-away: new favicon, app icon, marketing, anything printed.',
       })}
     </div>
     ${note('The lowercase serif <i>temple</i> travels with B and C and can be taken separately from either — it is a change in voice, warmer and less monumental, and it is the one thing here you can undo in an afternoon.')}`,
  )}

  ${section(
    4,
    'Whether the primary action keeps the gym’s colour',
    'The reference makes every primary button near-black and lets colour arrive only from content. Temple sells "make it look like your gym", so the boards kept the accent on the one action per page. The open question is the repeated case: a list of eight classes is eight Book buttons, and eight accent pills is a wall of colour that stops meaning "this is the thing to press". The boards already say repeated row actions are ink; this is asking whether that is the rule or whether the gym’s colour wins everywhere.',
    `${row(
      `${bookPhone('btn-accent', 'btn-accent', 'A · The gym’s colour on every action')}
       ${bookPhone('btn-plain', 'btn-accent', 'B · Rows are ink, the page’s one action is the gym’s')}
       ${bookPhone('btn-plain', 'btn-dark', 'C · Ink everywhere; colour only in content')}`,
      'margin-top:18px;gap:22px;justify-content:center;zoom:.86',
    )}
     ${note('B is what the boards drew. A is what the app does today. C is what the reference does, and it is the one that makes Temple look least like the gym using it.')}`,
  )}

</div>`;

  return page({
    title: 'Four decisions before the pages',
    sub: 'Each drawn as a comparison. Two of them cost real work to reverse, and all four change what the remaining ninety screens get migrated to.',
    content,
  });
}
