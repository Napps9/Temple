// Board 26 — Lead settings, rebuilt on the page parts.
//
// The first staff surface through Phase 3. Drawn from the code: the
// sections, cards and copy below are the ones in
// src/app/(staff)/management/leads/settings.tsx.
import { ic, note, page, phone, row, setting, sw, staffBar, radio } from './kit.mjs';

const label = (t) => `<div class="lbl" style="padding:0 16px 10px">${t}</div>`;

const card = (inner) => `<div class="card" style="padding:16px;gap:12px;display:flex;flex-direction:column">${inner}</div>`;

const routeOption = (on, title, blurb) => `
  <div class="card" style="padding:12px;border-radius:var(--r-ctl);${on ? 'border-color:var(--ink);background:var(--surface-2)' : ''}">
    <div class="row g8">${radio(on)}<span class="h3" style="font-size:14px">${title}</span></div>
    <div class="small dim" style="margin:3px 0 0 26px;font-size:12.5px">${blurb}</div>
  </div>`;

const before = `
<div class="stack g10">
  <span class="frame-label" style="text-align:left">Before — four groups, brand-barred, on shadowed cards</span>
  <div class="legacy" style="background:var(--l-bg);border:1px solid var(--l-line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:14px">
    <div style="font-size:22px;font-weight:600;color:var(--l-ink)">Settings</div>
    ${['When a lead comes in', 'Call Recording & Consent', 'Usage & Data', 'Data Retention']
      .map(
        (g) => `<div>
          <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px">
            <span style="width:4px;height:14px;border-radius:99px;background:#2563EB"></span>
            <span style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--l-ink-2)">${g}</span>
          </div>
          <div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 4px 14px rgba(15,23,42,.08);height:54px"></div>
        </div>`,
      )
      .join('')}
  </div>
</div>`;

const after = `
<div class="stack g10">
  <span class="frame-label" style="text-align:left">After — three sections, hairline cards, the two retention groups merged</span>
  <div class="app" style="background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:18px 0 20px">
    <div style="padding:0 16px 14px">
      <div class="h1" style="font-size:26px">Lead settings</div>
      <div class="body" style="margin-top:4px;font-size:14px">How leads are routed, recorded, and how long any of it is kept.</div>
    </div>

    ${label('When a lead comes in')}
    <div style="padding:0 16px 18px;display:flex;flex-direction:column;gap:8px">
      ${routeOption(true, 'Round robin', 'Each new lead goes to the next coach in the list.')}
      ${routeOption(false, 'One person', 'Everything lands with the same coach.')}
      ${routeOption(false, 'Nobody — I’ll assign', 'Leads sit unassigned until someone picks them up.')}
    </div>

    ${label('Recording and consent')}
    <div style="padding:0 16px 18px;display:flex;flex-direction:column;gap:8px">
      ${setting({ title: 'Record calls', sub: 'Both sides hear a notice before the assistant starts.', control: sw(true) })}
      ${setting({ title: 'Delete recordings after', sub: 'Audio only — the transcript is kept under the window below.', control: '<span class="field" style="width:150px;min-height:36px;font-size:14px">30 days</span>', save: 'Save' })}
    </div>

    ${label('Limits and retention')}
    <div style="padding:0 16px;display:flex;flex-direction:column;gap:8px">
      ${setting({ title: 'Daily message cap', sub: 'How many texts the assistant may send in 24 hours.', control: '<span class="field" style="width:110px;min-height:36px;font-size:14px">200</span>' })}
      ${setting({ title: 'Delete conversations after', sub: 'Transcripts and any recording metadata.', control: '<span class="field" style="width:150px;min-height:36px;font-size:14px">6 months</span>' })}
      ${setting({ title: 'Delete leads after', sub: 'Leads that never convert. Converted leads become members and are kept.', control: '<span class="field" style="width:150px;min-height:36px;font-size:14px">365 days</span>', save: 'Save' })}
    </div>
  </div>
</div>`;

const TABS = [
  ['Leads', 'the pipeline', 'on'],
  ['AI Agent', 'front desk + what it knows', ''],
  ['Conversations', 'what the agent said', ''],
  ['Settings', 'routing, recording, retention', ''],
];

export function leadsBoard() {
  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="card" style="padding:20px 22px">
    <span class="lbl">Shipped</span>
    <div class="h2" style="margin-top:8px;font-size:19px">The first staff surface on the page parts.</div>
    <div class="small" style="margin-top:8px;font-size:13.5px;max-width:790px">
      Four section groups become three. "Usage &amp; Data" and "Data
      Retention" were the same question asked twice — how much the agent may
      do, and how long any of it is kept — so the daily cap now sits with
      the two retention windows instead of a group away from them.
      <br><br>
      Every group had its own brand-coloured bar and every card its own drop
      shadow. The label is the shared SectionLabel now and the card is a
      hairline and a tone step, which is what the rest of the system uses.
      The nav went with it: a selected tab was a brand-filled pill with a
      shadow, and a nav is never the one action a page exists for.
    </div>
  </div>

  ${row(`${before}${after}`, 'margin-top:20px;gap:22px;align-items:flex-start')}

  <div class="lbl" style="margin-top:26px">Still four tabs, and that is the next thing</div>
  <div class="card flush" style="margin-top:10px">
    ${TABS.map(
      ([n, w, on], i) => `<div class="row g12" style="padding:11px 16px;${i ? 'border-top:1px solid var(--line)' : ''}">
        <span class="h3" style="width:150px;flex:none;font-size:14px">${n}</span>
        <span class="small dim grow" style="font-size:12.5px">${w}</span>
        ${n === 'AI Agent' || n === 'Settings' ? '<span class="chip chip-sm chip-warn">both are settings</span>' : ''}
      </div>`,
    ).join('')}
  </div>
  ${note('AI Agent and Settings are one screen wearing two tabs: the front desk, what it knows, how leads route, what is recorded and what is kept are all configuration. Merging them is the next push — 982 lines into 765, with per-card saves that have to survive it.')}
</div>`;

  return page({
    title: 'Lead settings',
    sub: 'Phase 3 begins. Drawn from the code — sections, cards and copy are the ones that shipped.',
    content,
  });
}
