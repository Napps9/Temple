// Board 25 — the staff rail, as shipped.
//
// Drawn from src/components/SideNav.tsx rather than proposed: the groups,
// the labels and the capability gates below are the ones in the code.
// The rail cannot be screenshotted from the exported bundle because every
// staff route redirects to sign-in without a session, so this is the
// record until someone photographs it signed in.
import { AV, gymTile, ic, note, page, phone, memberBar, pagehead, row, staffBar, TYPE, dot, listrow, wordmark } from './kit.mjs';

const navRow = (icon, label, { on, trail } = {}) => `
  <div class="navrow ${on ? 'on' : ''}">
    <span style="color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${ic(icon, 18)}</span>
    <span class="grow">${label}</span>${trail ?? ''}
  </div>`;

const rail = `
  <div class="side" style="width:246px;gap:14px">
    <div style="padding:2px 4px 0">${wordmark(17, 'var(--ink)')}</div>
    <div class="card" style="padding:8px 10px;border-radius:var(--r-ctl)">
      <div class="row g10">${gymTile('F', 30, 9)}
        <div class="stack g2 grow" style="min-width:0">
          <span class="h3 trunc" style="font-size:13.5px">Forge Barbell Club</span>
          <span class="small dim trunc" style="font-size:12px">Owner</span>
        </div>
      </div>
    </div>
    <div class="stack g2">
      ${navRow('chat', 'Timeline')}
      ${navRow('barbell', 'Programming')}
      ${navRow('cal', 'Classes')}
      ${navRow('grid', 'Manage')}
    </div>
    <div class="stack g2" style="margin-top:2px">
      <span class="lbl" style="padding:6px 12px 4px">The gym</span>
      ${navRow('people', 'Members', { on: true })}
      ${navRow('card', 'Plans')}
      ${navRow('mail', 'Communications')}
      ${navRow('bag', 'Billing')}
    </div>
    <div style="margin-top:auto" class="stack g10">
      <span class="chip" style="border-color:#3b82f666;background:#3b82f61a;color:#3B82F6;border-radius:var(--r-ctl);height:34px;justify-content:flex-start">
        ${ic('refresh', 14)}Viewing Staff
      </span>
      <div style="border-top:1px solid var(--line);padding-top:8px">
        <div class="row g10">${AV('DO', 30)}<span class="h3 grow" style="font-size:13.5px">Dani Okafor</span></div>
      </div>
    </div>
  </div>`;

const members = `
  <div style="padding:22px 24px 30px;min-width:0" class="grow">
    <div class="row between" style="align-items:flex-end">
      <div class="stack g4"><span class="h1" style="font-size:28px">Members</span><span class="body">214 active · 6 joined this month · 3 lapsing</span></div>
      <div class="row g8"><span class="btn btn-plain btn-sm">Import</span><span class="btn btn-accent btn-sm">${ic('plus', 15)}Invite</span></div>
    </div>
    <div class="card flush" style="margin-top:18px">
      <div class="row g12" style="padding:13px 16px;border-bottom:1px solid var(--line)">
        <div class="field grow" style="min-height:36px;padding-left:14px;font-size:14px">${ic('search', 15, 'color:var(--ink-3)')}<span class="grow dim">Search members</span></div>
        <span class="chip chip-sm">All plans</span><span class="chip chip-sm">All tags</span>
      </div>
      ${[['an','Amara Nwosu','Payment failed','chip-bad',['Evenings','Metcon']],
         ['mb','Marcus Bell','Unlimited','chip-ok',['New']],
         ['lk','Leila Karim','10-class pack','chip-ok',['Mornings']],
         ['ro','Ravi Oduya','Unlimited','chip-ok',['Coach']]]
        .map(([i, n, p, tone, tags], k) => `
        <div class="row g12" style="padding:10px 16px;${k ? 'border-top:1px solid var(--line)' : ''}">
          ${AV(i, 30)}<span class="h3" style="width:200px;font-size:14px">${n}</span>
          <span style="width:148px"><span class="chip chip-sm ${tone}">${p}</span></span>
          <span class="row g6 grow">${tags.map((t) => `<span class="chip chip-sm">${t}</span>`).join('')}</span>
          ${ic('right', 14, 'color:var(--ink-3)')}
        </div>`).join('')}
    </div>
  </div>`;

const GATES = [
  ['Timeline · Programming · Classes · Manage', 'the four sections', 'unchanged — same routes, same tab router'],
  ['Members', '/management/members', 'staff access, which the layout already enforces'],
  ['Plans', '/management/plans', 'can_manage_plans'],
  ['Communications', '/management/communications', 'can_manage_comms'],
  ['Billing', '/management/billing', 'owner only — the gate its own hub tile uses'],
];

export function railBoard() {
  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="card" style="padding:20px 22px">
    <span class="lbl">Shipped</span>
    <div class="h2" style="margin-top:8px;font-size:19px">A rail at 768 and up. Chrome only.</div>
    <div class="small" style="margin-top:8px;font-size:13.5px;max-width:790px">
      Four sections centred in a 1400px window left the top third of the
      screen doing nothing, and gave the gym's own destinations nowhere to
      live except behind Manage. They are one click deep now.
      <br><br>
      Nothing about navigation changed. The tab router underneath, its
      backBehavior="history" fix and every route are untouched — the
      destinations in "The gym" are ordinary pushes to routes that already
      existed. The 768 breakpoint is the same constant a modal uses to
      become a dialog, so a window has one idea of how big it is.
    </div>
  </div>

  <div style="margin-top:20px">
    <span class="frame-label">Desktop — the rail</span>
    <div class="app" style="margin-top:10px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:14px;overflow:hidden">
      <div class="deskbar"><b></b><b></b><b></b><span class="url">app.jointemple.io/management/members</span></div>
      <div style="display:flex;align-items:stretch;min-height:520px">${rail}${members}</div>
    </div>
  </div>

  ${row(
    `${phone(
      `${staffBar('timeline')}
       <div class="scrollarea">
         ${pagehead('Timeline', 'Thursday 21 August')}
         <div style="padding:0 16px">
           ${listrow({ lead: AV('PR', 30), title: 'Priya Raman', sub: 'Asked for cover on Friday 06:00', ruled: false })}
           ${listrow({ lead: AV('TM', 30), title: 'Tom Mercer', sub: 'Claimed Wednesday 19:00 Open gym', ruled: false })}
           ${listrow({ lead: dot(TYPE.metcon), title: 'Metcon filled up', sub: '17:30 · 20 of 20 · 3 waiting', ruled: false })}
         </div>
       </div>`,
      { label: 'Phone — unchanged' },
    )}
     <div class="stack g10" style="flex:1;min-width:0;max-width:520px">
       <span class="frame-label">What is in the rail, and what gates it</span>
       <div class="card flush">
         ${GATES.map(([name, where, gate], i) => `
           <div class="stack g2" style="padding:11px 16px;${i ? 'border-top:1px solid var(--line)' : ''}">
             <span class="h3" style="font-size:13.5px">${name}</span>
             <span class="small dim" style="font-size:12px">${where} — ${gate}</span>
           </div>`).join('')}
       </div>
       <p class="board-sub" style="text-align:left;margin:0;font-size:12.5px">
         A rail that showed a coach a link they cannot open would be worse
         than not having the link, so each destination carries the gate its
         own page checks.
       </p>
     </div>`,
    'margin-top:24px;gap:24px;align-items:flex-start',
  )}

  ${note('The account menu — messages, theme, account, membership, store — was lifted out of the top bar into one component both navs render. Two navs that each owned their own menu would drift, and an item that existed only on a phone is exactly how.')}
</div>`;

  return page({
    title: 'The staff rail',
    sub: 'Phase 2. Drawn from the component, not proposed — the groups, labels and capability gates below are the ones in the code.',
    content,
  });
}
