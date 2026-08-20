// Board 33 — a modal never opens another modal.
//
// Board 04 set the rule and Phase 4 got every bespoke modal onto Sheet,
// but the largest of them kept opening more sheets from inside itself.
// Record a workout had four: pick a category, pick a scoring format, tag
// a movement, edit that tag's rep scheme. On a phone that is a sheet over
// a sheet — two grabbers, two backdrops, the form you were filling in
// still scrolled behind whatever landed on top of it, and a back gesture
// that could dismiss either one.
//
// They are steps of the same sheet now. The container stays where it is,
// the head names the step, a back chevron returns to the form, and close
// still means close. Nothing about what the form does changed.
import { body, ic, note, page, phone, row, memberBar } from './kit.mjs';

/* ------------------------------------------------------------ the sheets */

const grab = `<div style="display:flex;justify-content:center;padding:8px 0 2px"><span style="width:36px;height:4px;border-radius:999px;background:var(--surface-3);display:block"></span></div>`;

const sheetHead = (title, sub, back = false) => `
<div style="display:flex;align-items:flex-start;gap:12px;padding:8px 16px 12px">
  ${back ? `<span style="width:30px;height:30px;border-radius:999px;border:1px solid var(--line-strong);display:flex;align-items:center;justify-content:center;flex:none">${ic('left', 15, 'color:var(--ink-2)')}</span>` : ''}
  <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
    <span style="font-size:19px;font-weight:700;letter-spacing:-.5px">${title}</span>
    ${sub ? `<span class="small dim" style="font-size:13px">${sub}</span>` : ''}
  </div>
  <span style="width:30px;height:30px;border-radius:999px;border:1px solid var(--line-strong);display:flex;align-items:center;justify-content:center;flex:none">${ic('close', 14, 'color:var(--ink-2)')}</span>
</div>`;

const sheetFoot = (buttons) => `
<div style="display:flex;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--line)">${buttons}</div>`;

const sheet = (inner, { offset = 0 } = {}) => `
<div style="position:absolute;left:0;right:0;bottom:${offset}px;background:var(--surface);border:1px solid var(--line);border-bottom:0;border-radius:22px 22px 0 0;box-shadow:var(--shadow-float);max-height:78%;display:flex;flex-direction:column;overflow:hidden">
  ${grab}${inner}
</div>`;

const backdrop = `<div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div>`;

const stage = (inner) =>
  `<div style="position:relative;flex:1;display:flex;flex-direction:column">${inner}</div>`;

/* ------------------------------------------------------------- the forms */

const field = (label, value, hint) => `
<div class="stack g6">
  <span class="lbl">${label}</span>
  <div class="input ${value ? '' : 'empty'}"><span class="grow">${value || hint}</span></div>
</div>`;

const sectionCard = `
<div class="card" style="padding:14px;gap:10px">
  <div class="row between"><span class="h3">Section 1</span>${ic('close', 14, 'color:var(--ink-3)')}</div>
  <div class="row g8">
    <span class="chip chip-sm grow" style="justify-content:space-between">Strength${ic('down', 12)}</span>
    <span class="chip chip-sm grow" style="justify-content:space-between">For time${ic('down', 12)}</span>
  </div>
  <div class="row g6 wrap">
    <span class="chip chip-sm chip-on">Back squat · 3RM</span>
    <span class="chip chip-sm">${ic('plus', 12)}Tag a movement</span>
  </div>
</div>`;

const recordBody = `
<div style="padding:0 16px 8px;display:flex;flex-direction:column;gap:14px;overflow:hidden">
  ${field('Date', '12 March 2026')}
  ${field('Workout title (optional)', '', 'Morning session')}
  ${sectionCard}
</div>`;

const pickerBody = `
<div style="padding:0 16px 8px">
  <div class="card flush">
    ${['Strength', 'Metcon', 'Gymnastics', 'Accessory', 'Skill']
      .map(
        (l, i) =>
          `<div style="padding:12px 14px;${i ? 'border-top:1px solid var(--line)' : ''}"><span style="font-size:14.5px">${l}</span></div>`,
      )
      .join('')}
  </div>
</div>`;

const tagBody = `
<div style="padding:0 16px 8px;display:flex;flex-direction:column;gap:10px">
  <div class="row g8" style="background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-ctl);padding:0 12px;align-items:center">
    ${ic('search', 15, 'color:var(--ink-3)')}
    <span class="small dim grow" style="padding:10px 0;font-size:14px">Search all movements</span>
  </div>
  ${['Barbell', 'Gymnastics', 'Monostructural']
    .map(
      (g) =>
        `<div class="row between" style="background:var(--surface-2);border-radius:var(--r-ctl);padding:10px 12px">
          <span class="h3" style="font-size:14px">${g}</span>${ic('down', 15, 'color:var(--ink-3)')}
        </div>`,
    )
    .join('')}
</div>`;

/* ------------------------------------------------------------ the screens */

const trackBehind = `
<div style="padding:16px;display:flex;flex-direction:column;gap:14px;opacity:1">
  <div class="row between">
    <span style="font-size:26px;font-weight:700;letter-spacing:-.8px">Track</span>
    <span class="btn btn-accent btn-sm">${ic('plus', 15)}Record</span>
  </div>
  <div class="card" style="padding:14px;gap:10px">
    <div class="row g10">
      ${['4', '12', '9'].map((n, i) => `<div class="stack g2 grow"><span class="num" style="font-size:22px">${n}</span><span class="lbl">${['days in a row', 'weeks in a row', 'this month'][i]}</span></div>`).join('')}
    </div>
  </div>
</div>`;

/* -------------------------------------------------------------- the board */

export const stepsBoard = () =>
  page({
    title: 'A modal never opens another modal',
    sub: 'Record a workout opened four more sheets from inside itself. On a phone that is a sheet over a sheet: two grabbers, two backdrops, and the form you were filling in still scrolled behind the thing on top of it.',
    content: `
${row(
  phone(
    body(
      memberBar('track') +
        stage(
          trackBehind +
            backdrop +
            sheet(sheetHead('Record workout', 'Add sections and log your results.') + recordBody + sheetFoot('<span class="btn btn-plain grow">Cancel</span><span class="btn btn-accent" style="flex:1.4">Save workout</span>'), { offset: 0 }) +
            `<div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div>` +
            sheet(sheetHead('Pick a category') + pickerBody + sheetFoot('<span class="btn btn-plain btn-full">Cancel</span>'), { offset: 0 }),
        ),
    ),
    { label: 'before — a sheet on a sheet' },
  ) +
    phone(
      body(
        memberBar('track') +
          stage(
            trackBehind +
              backdrop +
              sheet(sheetHead('Pick a category', '', true) + pickerBody, { offset: 0 }),
          ),
      ),
      { label: 'after — a step of the same sheet' },
    ) +
    phone(
      body(
        memberBar('track') +
          stage(
            trackBehind +
              backdrop +
              sheet(
                sheetHead(
                  'Tag a movement',
                  'Optionally with a rep scheme, so it lands in your Journal.',
                  true,
                ) + tagBody,
                { offset: 0 },
              ),
          ),
      ),
      { label: 'after — dark', dark: true },
    ),
)}
${note(
  'On the left the two sheets are the same shape at the same edge, so which grabber belongs to which is a guess, and a swipe down is ambiguous. On the right there is one sheet the whole time: the head names the step, the chevron goes back to the form, and the close still closes the lot. The four steps are pick a category, pick a scoring format, tag a movement, and set that tag’s rep scheme.',
)}
${row(
  `<div class="card flush" style="max-width:900px;width:100%">
    <div class="row g12" style="padding:12px 16px">
      <span class="lbl" style="width:230px;flex:none">Was</span>
      <span class="lbl grow">Is</span>
    </div>
    ${[
      ['PickerModal — its own Sheet', 'PickerStep — the body, and the sheet’s head says which picker'],
      ['MovementTagPickerModal', 'MovementTagPickerStep — same search, same groups, same reset'],
      ['TagEditModal', 'TagEditStep — Remove and Done are the sheet’s foot'],
      ['four Modals mounted at once', 'one Sheet, one step at a time'],
    ]
      .map(
        ([a, b]) => `<div class="row g12" style="padding:11px 16px;border-top:1px solid var(--line)">
          <span class="small" style="width:230px;flex:none;font-size:12.5px">${a}</span>
          <span class="small dim grow" style="font-size:12.5px">${b}</span>
        </div>`,
      )
      .join('')}
  </div>`,
)}
${note(
  '<code>Sheet</code> grew one prop for this — <code>onBack</code> — which draws the chevron and nothing else. A sheet with no <code>onBack</code> is unchanged, so the other twenty-one modals did not move.',
)}
`,
  });
