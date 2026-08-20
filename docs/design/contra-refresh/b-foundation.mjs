// Boards 01-04: identity, type, and the two pattern sheets that the rest of
// the product is generated from.
import {
  ic, icf, mark, wordmark, lockup, starfield, AV, avstack, orb, MEDIA, TYPE,
  page, phone, row, note, sheet, dialog, field, sw, radio, checkbox, listrow,
  memberBar, pagehead, lbl, chips, segmented, tabs, setting, gymTile, dot,
} from './kit.mjs';

/* ============================================================ 01 identity */

export function identityBoard() {
  const swatch = (name, hex, n) => `
    <div class="stack g8" style="width:124px">
      <div style="height:60px;border-radius:12px;background:${hex};border:1px solid var(--line)"></div>
      <div class="stack g2">
        <span class="h3" style="font-size:13px">${name}</span>
        <span class="lbl" style="letter-spacing:.05em">${hex}</span>
        <span class="small" style="font-size:11.5px;line-height:1.35">${n}</span>
      </div>
    </div>`;

  const dir = (kind, name, blurb, rec) => `
  <div class="card" style="width:205px;padding:14px;${rec ? 'border-color:var(--ink)' : ''}">
    <div class="row between" style="height:22px">
      <span class="lbl">${rec ? 'Recommended' : 'Alternative'}</span>
      ${rec ? `<span class="badge" style="background:var(--ink);color:#fff">Pick this</span>` : ''}
    </div>
    <div class="row g14" style="margin-top:16px;align-items:flex-end;height:60px">
      ${mark(kind, 54, '#14161a')}${mark(kind, 25, '#14161a')}${mark(kind, 15, '#14161a')}
    </div>
    <div class="row g8" style="margin-top:16px">
      ${['#14161a', '#f1f1f4', '#c2410c']
        .map((bg) => `<span style="width:42px;height:42px;border-radius:11px;background:${bg};display:flex;align-items:center;justify-content:center">${mark(kind, 22, bg === '#f1f1f4' ? '#14161a' : '#ffffff')}</span>`)
        .join('')}
    </div>
    <div class="h2" style="margin-top:15px;font-size:17px">${name}</div>
    <div class="small" style="margin-top:5px;font-size:12.5px;line-height:1.4">${blurb}</div>
  </div>`;

  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">
  <div class="row g24" style="align-items:stretch">
    <div class="card grow starfield" style="padding:34px 30px;background-image:${starfield('portico', '%2314161a', 0.09)};background-color:var(--surface)">
      <span class="lbl">The lockup</span>
      <div style="margin-top:22px">${lockup(40, '#14161a')}</div>
      <div class="small" style="margin-top:22px;font-size:12.5px;max-width:310px">
        A bold lowercase serif beside one solid geometric glyph — the same
        two-part construction the reference uses, and the opposite of an
        illustrated tile.
      </div>
    </div>
    <div class="card grow starfield" style="padding:34px 30px;background-color:#14161a;border-color:#14161a;background-image:${starfield('portico', '%23ffffff', 0.1)}">
      <span class="lbl" style="color:#6c727b">Reversed</span>
      <div style="margin-top:22px">${lockup(40, '#ffffff')}</div>
      <div class="small" style="margin-top:22px;font-size:12.5px;max-width:310px;color:#9aa0a9">
        The mark never sits in a coloured container and never takes a gym's
        brand colour. Inside a gym, the gym's own logo leads.
      </div>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>
  <span class="lbl">Mark directions</span>
  <div class="row wrap" style="margin-top:14px;gap:14px;align-items:stretch">
    ${dir('portico', 'Portico', 'Entablature, three columns, plinth. The only one of the four that still reads as a building at 15px, and it cannot be mistaken for a letter.', true)}
    ${dir('doorway', 'Doorway', 'The gate, squared off. Simplest and boldest — and the most generic; plenty of products own a shape like this already.', false)}
    ${dir('pediment', 'Pediment', 'Roof over two courses of stone, no columns. The most abstract, and the closest in register to a compass-star.', false)}
    ${dir('column', 'Column', 'One column: capital, shaft, base. Quiet and distinctive, but slight enough that it disappears beside the wordmark.', false)}
  </div>

  <div class="rule" style="margin:28px 0"></div>
  <div class="row g36" style="align-items:flex-start">
    <div class="stack g14" style="flex:1">
      <span class="lbl">Applied</span>
      <div class="row g14" style="align-items:flex-end">
        ${[[92, 21, '1024'], [56, 13, '180'], [36, 9, '64'], [20, 5, '32']]
          .map(([s, r, l]) => `
          <div class="stack g8" style="align-items:center">
            <span style="width:${s}px;height:${s}px;border-radius:${r}px;background:#14161a;display:flex;align-items:center;justify-content:center">${mark('portico', Math.round(s * 0.52), '#ffffff')}</span>
            <span class="lbl" style="letter-spacing:.05em">${l}</span>
          </div>`).join('')}
        <div class="stack g8" style="align-items:center">
          <span style="width:36px;height:36px;border-radius:999px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;border:1px solid var(--line)">${mark('portico', 18, '#14161a')}</span>
          <span class="lbl" style="letter-spacing:.05em">avatar</span>
        </div>
      </div>
      <div class="small" style="max-width:400px;font-size:13px">
        One glyph, two fills, and the container is whatever it is sitting in.
        The gold and steel from today's logo stop being structure and become
        two of the grounds it can sit on.
      </div>
      <div class="row g8" style="margin-top:2px">
        ${['#14161a', '#3b6ba5', '#e8b620', '#c2410c']
          .map((c) => `<span style="width:42px;height:42px;border-radius:11px;background:${c};display:flex;align-items:center;justify-content:center">${mark('portico', 22, c === '#e8b620' ? '#14161a' : '#ffffff')}</span>`)
          .join('')}
      </div>
    </div>
    <div class="stack g14" style="flex:1">
      <span class="lbl">Wordmark</span>
      <div class="card" style="padding:22px">
        <div class="stack" style="gap:18px">
          <div class="stack g6">${wordmark(46, '#14161a')}
            <span class="small" style="font-size:12px">Fraunces 700 · opsz 144 · WONK on — logo only, never in the UI.</span></div>
          <div class="rule"></div>
          <div class="stack g6">
            <span style="font-size:34px;font-weight:700;letter-spacing:-.035em;color:#14161a;line-height:1">Book a class</span>
            <span class="small" style="font-size:12px">Geist 700 — every heading, every number, every label.</span></div>
        </div>
      </div>
      <div class="small" style="max-width:400px;font-size:13px">
        Lowercase, not caps. The serif carries all of the warmth in the brand
        so the product itself can stay completely neutral.
      </div>
    </div>
  </div>

  <div class="rule" style="margin:28px 0"></div>
  <span class="lbl">Palette — cool and monochrome; colour arrives from content</span>
  <div class="row g14 wrap" style="margin-top:14px">
    ${swatch('Ink', '#14161A', 'Text, the mark, dark buttons')}
    ${swatch('Ground', '#F7F7F8', 'Behind the cards')}
    ${swatch('Surface', '#FFFFFF', 'Every card')}
    ${swatch('Line', '#E9E9EE', 'Every border')}
    ${swatch('Tint', '#F1F1F4', 'Selected pills, insets')}
    ${swatch('Muted', '#8B909A', 'Labels and meta')}
    ${swatch('Gym accent', '#C2410C', 'Runtime, per gym')}
  </div>
</div>`;

  return page({
    title: 'Identity — wordmark, mark, palette',
    sub: 'A bold lowercase serif wordmark beside one small solid geometric glyph, on a cool monochrome palette.',
    content,
  });
}

/* ================================================================ 02 type */

export function typeBoard() {
  const controls = () => `
  <div class="card">
    <div class="row g10 wrap">
      <span class="btn btn-accent">Book</span>
      <span class="btn btn-dark">Post</span>
      <span class="btn btn-plain">Cancel</span>
      <span class="btn btn-soft">Waitlist</span>
    </div>
    <div class="row g8 wrap" style="margin-top:16px">
      <span class="chip chip-on">For you</span>
      <span class="chip">${ic('cal', 14)}Topics</span>
      <span class="chip chip-ok">${ic('check', 13)}Booked</span>
      <span class="chip chip-warn">3 spots left</span>
      <span class="chip chip-bad">Payment failed</span>
      <span class="chip chip-accent">${icf('spark', 12)}For you</span>
    </div>
    <div class="row g10 wrap" style="margin-top:16px;align-items:center">
      <span class="badge">Pro</span><span class="badge">Coming soon</span>
      ${sw(true)}${sw(false)}${radio(true)}${radio(false)}${checkbox(true)}${checkbox(false)}
      <span class="grow"></span>${avstack(['dk', 'pr', 'mb', 'lk'], 22)}
    </div>
    <div class="row g10" style="margin-top:16px">${segmented(['Day', 'Week', 'Month'], 'Week')}</div>
    <div class="stack g6" style="margin-top:16px">
      <div class="row between"><span class="small" style="font-size:12.5px">Setup</span><span class="small num" style="font-size:12.5px">60%</span></div>
      <div class="bar"><i style="width:60%"></i></div>
    </div>
    <div style="margin-top:16px">${field('Email', 'dani@forgebarbell.co')}</div>
    <div class="glow" style="margin-top:20px">
      <div class="field" style="min-height:52px">
        <span class="grow">Show me a member, change a class…</span>
        <span class="btn btn-dark btn-sm" style="padding-left:8px">${orb(18)}Let's go</span>
      </div>
    </div>
  </div>`;

  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">
  <span class="lbl">Two faces, and that is the whole system</span>
  <div class="row g16" style="margin-top:14px;align-items:stretch">
    <div class="card" style="flex:1;padding:24px">
      <span class="lbl">Wordmark only</span>
      <div style="margin-top:16px">${wordmark(54, '#14161a')}</div>
      <div class="small" style="margin-top:16px;font-size:13px">
        <b class="strong">Fraunces</b> — variable, free, WONK axis on. It
        appears in exactly one place.</div>
    </div>
    <div class="card" style="flex:1.4;padding:24px">
      <span class="lbl">Everything else</span>
      <div style="font-size:44px;font-weight:700;letter-spacing:-.038em;line-height:1.02;margin-top:14px">Book a class</div>
      <div style="font-size:19px;color:var(--ink-2);margin-top:10px">Thursday 21 August · 18:00</div>
      <div class="small" style="margin-top:16px;font-size:13px">
        <b class="strong">Geist</b> — one family for headings, body, numbers
        and labels, so nothing decorative competes with the gym's brand.</div>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <span class="lbl">The scale</span>
  <div style="margin-top:8px">
    ${[
      ['Display', 'font-size:40px;font-weight:700;letter-spacing:-.038em', 'Geist 700 · 40/41 · −0.038em'],
      ['Page title', 'font-size:28px;font-weight:700;letter-spacing:-.032em', 'Geist 700 · 28/31 · −0.032em'],
      ['Card title', 'font-size:20px;font-weight:700;letter-spacing:-.026em', 'Geist 700 · 20/24 · −0.026em'],
      ['Row title', 'font-size:15.5px;font-weight:600;letter-spacing:-.014em', 'Geist 600 · 15.5/20'],
      ['Body', 'font-size:15px;color:var(--ink-2)', 'Geist 400 · 15/22'],
      ['Meta', 'font-size:13.5px;color:var(--ink-2)', 'Geist 400 · 13.5/19'],
    ].map(([l, css, spec]) => `
      <div class="row g16" style="align-items:baseline;padding:11px 0;border-bottom:1px solid var(--line)">
        <span class="lbl" style="width:92px;flex:none">${l}</span>
        <span style="${css};flex:1">The whiteboard, the front desk, the books</span>
        <span class="small" style="font-size:11.5px;width:200px;flex:none;text-align:right">${spec}</span>
      </div>`).join('')}
    <div class="row g16" style="align-items:baseline;padding:11px 0">
      <span class="lbl" style="width:92px;flex:none">Label</span>
      <span class="lbl" style="flex:1">The whiteboard, the front desk, the books</span>
      <span class="small" style="font-size:11.5px;width:200px;flex:none;text-align:right">Geist 600 · 11px · +0.09em · caps</span>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <div class="row g24" style="align-items:flex-start">
    <div class="stack g14" style="flex:1"><span class="lbl">Controls</span>${controls()}</div>
    <div class="stack g14" style="flex:1">
      <span class="lbl">The same set in dark</span>
      <div class="app dark" style="background:var(--bg);border-radius:20px;padding:16px">${controls()}</div>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <div class="row between" style="align-items:flex-end">
    <span class="lbl">Where the gym's colour is allowed to appear</span>
    <span class="small" style="font-size:12.5px">Everything not listed stays monochrome</span>
  </div>
  <div class="row g14 wrap" style="margin-top:14px">
    ${[
      ['Logo tile', gymTile('F', 38, 11)],
      ['The one primary action', `<span class="btn btn-accent btn-sm">Book</span>`],
      ['Class-type dots', `<span class="row g8">${dot(TYPE.strength)}${dot(TYPE.metcon)}${dot(TYPE.open)}</span>`],
      ['A member’s own data', `<span class="row g2">${[0.25, 0.5, 1, 0.4, 1, 0.7].map((o) => `<i style="width:11px;height:11px;border-radius:3px;background:var(--accent);opacity:${o};display:block"></i>`).join('')}</span>`],
      ['The gym’s photography', `<span style="width:86px;height:38px;border-radius:10px;display:block;background:${MEDIA.strength}"></span>`],
    ].map(([label, el]) => `
      <div class="card" style="flex:1;min-width:196px;padding:14px">
        <div style="height:40px;display:flex;align-items:center">${el}</div>
        <div class="small" style="margin-top:10px;font-size:12.5px">${label}</div>
      </div>`).join('')}
  </div>
</div>`;

  return page({
    title: 'Type, controls, and where colour is allowed',
    sub: 'One serif for the wordmark, one sans for the product, and a control set with no shadows except on things that float.',
    content,
  });
}

/* ======================================================= 03 page patterns */

export function pagePatternsBoard() {
  // Wireframe blocks, in the system's own tokens.
  const B = {
    bar: `<div style="height:20px;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:4px;padding:0 7px">
            <i style="width:9px;height:9px;border-radius:3px;background:var(--accent);display:block"></i>
            <i style="width:22px;height:7px;border-radius:99px;background:var(--surface-2);display:block"></i>
            <span style="flex:1"></span><i style="width:9px;height:9px;border-radius:99px;background:var(--surface-2);display:block"></i></div>`,
    head: `<div style="padding:8px 7px 6px"><i style="width:52%;height:10px;border-radius:3px;background:var(--ink);display:block;opacity:.85"></i>
            <i style="width:72%;height:6px;border-radius:3px;background:var(--surface-3);display:block;margin-top:4px"></i></div>`,
    headAction: `<div style="padding:8px 7px 6px;display:flex;align-items:flex-start;gap:6px">
            <div style="flex:1"><i style="width:60%;height:10px;border-radius:3px;background:var(--ink);display:block;opacity:.85"></i>
            <i style="width:85%;height:6px;border-radius:3px;background:var(--surface-3);display:block;margin-top:4px"></i></div>
            <i style="width:26px;height:13px;border-radius:99px;background:var(--accent);display:block"></i></div>`,
    chips: `<div style="display:flex;gap:4px;padding:0 7px 7px">${[26, 34, 30].map((w, i) => `<i style="width:${w}px;height:12px;border-radius:99px;background:${i === 0 ? 'var(--surface-2)' : 'transparent'};border:1px solid var(--line-strong);display:block"></i>`).join('')}</div>`,
    label: `<div style="padding:0 7px 5px"><i style="width:34%;height:5px;border-radius:2px;background:var(--surface-3);display:block"></i></div>`,
    rows: (n = 4, h = 30) => `<div style="padding:0 7px;display:flex;flex-direction:column;gap:5px">${Array.from({ length: n }).map(() => `<div style="height:${h}px;background:var(--surface);border:1px solid var(--line);border-radius:6px;display:flex;align-items:center;gap:5px;padding:0 6px">
            <i style="width:14px;height:14px;border-radius:99px;background:var(--surface-2);display:block"></i>
            <div style="flex:1"><i style="width:62%;height:5px;border-radius:2px;background:var(--ink);opacity:.7;display:block"></i><i style="width:40%;height:4px;border-radius:2px;background:var(--surface-3);display:block;margin-top:3px"></i></div>
            <i style="width:18px;height:10px;border-radius:99px;background:var(--ink);opacity:.85;display:block"></i></div>`).join('')}</div>`,
    ruled: (n = 5) => `<div style="padding:0 7px"><div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow:hidden">${Array.from({ length: n }).map((_, i) => `<div style="height:22px;display:flex;align-items:center;gap:5px;padding:0 6px;${i ? 'border-top:1px solid var(--line)' : ''}">
            <i style="width:11px;height:11px;border-radius:99px;background:var(--surface-2);display:block"></i>
            <i style="width:44%;height:5px;border-radius:2px;background:var(--ink);opacity:.7;display:block"></i>
            <span style="flex:1"></span><i style="width:16px;height:8px;border-radius:99px;background:var(--surface-2);display:block"></i></div>`).join('')}</div></div>`,
    stats: `<div style="padding:0 7px 7px"><div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:8px;display:flex;gap:8px">
            ${[0, 1, 2].map(() => `<div style="flex:1"><i style="width:60%;height:11px;border-radius:2px;background:var(--ink);opacity:.85;display:block"></i><i style="width:80%;height:4px;border-radius:2px;background:var(--surface-3);display:block;margin-top:4px"></i></div>`).join('')}</div></div>`,
    grid: `<div style="padding:0 7px;display:grid;grid-template-columns:1fr 1fr;gap:5px">${Array.from({ length: 4 }).map(() => `<div style="height:38px;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:6px;display:flex;flex-direction:column;justify-content:space-between">
            <i style="width:11px;height:11px;border-radius:3px;background:var(--surface-2);display:block"></i>
            <div><i style="width:66%;height:5px;border-radius:2px;background:var(--ink);opacity:.7;display:block"></i><i style="width:50%;height:4px;border-radius:2px;background:var(--surface-3);display:block;margin-top:3px"></i></div></div>`).join('')}</div>`,
    settings: `<div style="padding:0 7px;display:flex;flex-direction:column;gap:5px">${[0, 1, 2].map(() => `<div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:7px">
            <div style="display:flex;align-items:center;gap:6px"><div style="flex:1"><i style="width:55%;height:5px;border-radius:2px;background:var(--ink);opacity:.75;display:block"></i><i style="width:82%;height:4px;border-radius:2px;background:var(--surface-3);display:block;margin-top:3px"></i></div>
            <i style="width:18px;height:10px;border-radius:99px;background:var(--ink);display:block"></i></div>
            <div style="display:flex;justify-content:flex-end;margin-top:6px"><i style="width:22px;height:9px;border-radius:99px;background:var(--ink);opacity:.85;display:block"></i></div></div>`).join('')}</div>`,
    form: `<div style="padding:0 7px;display:flex;flex-direction:column;gap:7px">${[0, 1, 2].map(() => `<div><i style="width:30%;height:4px;border-radius:2px;background:var(--surface-3);display:block;margin-bottom:3px"></i>
            <i style="width:100%;height:16px;border-radius:5px;background:var(--surface);border:1px solid var(--line-strong);display:block"></i></div>`).join('')}</div>`,
    calendar: `<div style="padding:0 7px 7px"><div style="display:flex;gap:3px;margin-bottom:5px">${Array.from({ length: 7 }).map((_, i) => `<div style="flex:1;height:20px;border-radius:5px;background:${i === 3 ? 'var(--surface)' : 'transparent'};border:1px solid ${i === 3 ? 'var(--line)' : 'transparent'};display:flex;align-items:center;justify-content:center"><i style="width:8px;height:7px;border-radius:2px;background:${i === 3 ? 'var(--ink)' : 'var(--surface-3)'};display:block"></i></div>`).join('')}</div>
            <div style="display:flex;flex-direction:column;gap:4px">${[[10, 40], [26, 62], [8, 30], [30, 50]].map(([off, w]) => `<div style="display:flex;gap:5px;align-items:center"><i style="width:14px;height:4px;border-radius:2px;background:var(--surface-3);display:block"></i>
            <i style="width:${w}%;height:14px;border-radius:5px;background:var(--surface);border:1px solid var(--line);display:block;margin-left:${off / 6}px"></i></div>`).join('')}</div></div>`,
    feed: `<div style="padding:0 7px;display:flex;flex-direction:column;gap:6px">
            ${[0, 1].map(() => `<div style="display:flex;gap:5px;align-items:flex-start"><i style="width:9px;height:9px;border-radius:99px;background:var(--surface-3);display:block;margin-top:1px"></i><i style="flex:1;height:5px;border-radius:2px;background:var(--surface-3);display:block;margin-top:2px"></i></div>`).join('')}
            <i style="width:36%;height:5px;border-radius:2px;background:var(--surface-3);display:block;margin-top:2px"></i>
            ${[0, 1].map(() => `<div style="background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:7px">
            <i style="width:70%;height:6px;border-radius:2px;background:var(--ink);opacity:.75;display:block"></i>
            <i style="width:90%;height:4px;border-radius:2px;background:var(--surface-3);display:block;margin-top:4px"></i>
            <div style="display:flex;gap:4px;margin-top:6px"><i style="width:34px;height:11px;border-radius:99px;background:var(--ink);opacity:.85;display:block"></i><i style="width:28px;height:11px;border-radius:99px;background:var(--surface);border:1px solid var(--line-strong);display:block"></i></div></div>`).join('')}</div>`,
    foot: `<div style="margin-top:auto;padding:7px;border-top:1px solid var(--line)"><i style="width:100%;height:16px;border-radius:99px;background:var(--surface);border:1px solid var(--line-strong);display:block"></i></div>`,
    editor: `<div style="padding:0 7px;display:flex;gap:5px;height:100%">
            <div style="flex:1;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px">
            ${[70, 90, 55, 80, 40].map((w) => `<i style="width:${w}%;height:5px;border-radius:2px;background:var(--surface-3);display:block"></i>`).join('')}</div>
            <div style="width:38px;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:5px;display:flex;flex-direction:column;gap:4px">
            ${[0, 1, 2, 3].map(() => `<i style="width:100%;height:10px;border-radius:3px;background:var(--surface-2);display:block"></i>`).join('')}</div></div>`,
  };

  const card = (name, rule, routes, blocks, n) => `
  <div class="card" style="width:262px;padding:15px">
    <div class="row between">
      <span class="lbl">Pattern ${n}</span>
      <span class="badge">${routes.length} surfaces</span>
    </div>
    <div style="margin-top:12px;height:250px;border-radius:12px;border:1px solid var(--line);background:var(--bg);overflow:hidden;display:flex;flex-direction:column">
      ${blocks.join('')}
    </div>
    <div class="h2" style="margin-top:14px;font-size:17px">${name}</div>
    <div class="small" style="margin-top:5px;font-size:12.5px;line-height:1.45">${rule}</div>
    <div class="rule" style="margin:11px 0 9px"></div>
    <div class="small dim" style="font-size:11.5px;line-height:1.5">${routes.join(' · ')}</div>
  </div>`;

  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">
  <div class="card" style="padding:20px 22px;background:var(--surface)">
    <div class="row g24 wrap" style="align-items:flex-start">
      <div style="flex:1;min-width:300px">
        <span class="lbl">The rule</span>
        <div class="h2" style="margin-top:8px;font-size:19px">Ninety-five routes, eight page shapes.</div>
        <div class="small" style="margin-top:8px;font-size:13.5px;max-width:460px">
          Every screen in Temple is one of the eight below, assembled from the
          same six parts in the same order: <b class="strong">bar</b> ·
          <b class="strong">page head</b> · <b class="strong">filters</b> ·
          <b class="strong">section label</b> · <b class="strong">rows or cards</b> ·
          <b class="strong">foot</b>. A new surface picks a shape; it does not
          invent one.
        </div>
      </div>
      <div style="flex:1;min-width:300px">
        <span class="lbl">Which means</span>
        <div class="stack g8" style="margin-top:10px">
          ${[
            'One primary action per page, top right, in the gym’s colour.',
            'Repeated row actions are ink, never the accent.',
            'Section labels are 11px caps — they replace card headings.',
            'A list is rows on a ground; a table is rows in one ruled card.',
            'Every shape has a defined empty, loading and error state.',
          ].map((t) => `<div class="row g8" style="align-items:flex-start">${ic('check', 14, 'color:var(--ink-3);margin-top:2px')}<span class="small" style="font-size:13px">${t}</span></div>`).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="row wrap" style="margin-top:20px;gap:14px;align-items:stretch">
    ${card('Feed', 'A day of things that happened, then the things waiting on someone. Receipts are ruled lines; only a decision gets a card. Composer pinned to the foot.', ['Timeline', 'Inbox', 'Lead conversation', 'Timeline day'], [B.bar, B.feed, B.foot], 1)}
    ${card('Agenda', 'Time down the left, one card per thing. A day strip on top, type filters under it. Never an hourly grid on a phone.', ['Book', 'Classes', 'Bookings', 'Attendance', 'Programming'], [B.bar, B.calendar, B.rows(3, 26)], 2)}
    ${card('Directory', 'Search, filters, then the one row shape. Rows on a ground when they are tappable objects; rows in a single ruled card when it is a table.', ['Members', 'Leads', 'Plans', 'Products', 'Movements', 'Roster', 'Team', 'Tasks'], [B.bar, B.headAction, B.chips, B.ruled(6)], 3)}
    ${card('Record', 'One entity. Identity block, then tabs, then the facts and the related lists. Actions live in the header, not scattered down the page.', ['Member profile', 'Movement', 'Workout', 'Plan', 'Campaign', 'Product'], [B.bar, B.head, B.chips, B.rows(3, 30)], 4)}
    ${card('Dashboard', 'Numbers first, split by hairlines, then the list that explains them. No tinted stat tiles.', ['Manage insights', 'Analysis', 'Coach earnings', 'Attendance', 'Track'], [B.bar, B.headAction, B.stats, B.grid], 5)}
    ${card('Settings', 'One card per decision, each with its own save. Never a page-level Save spanning several cards.', ['Gym settings', 'Branding', 'Account', 'Comms settings', 'Website', 'Store settings'], [B.bar, B.head, B.settings], 6)}
    ${card('Form', 'One job, top to bottom, nothing else on screen. Back replaces the nav. The action sticks to the foot.', ['Sign in', 'Create gym', 'PAR-Q', 'Waiver', 'Injury check', 'Invite', 'Onboarding'], [B.bar, B.head, B.form, B.foot], 7)}
    ${card('Workspace', 'A canvas and an inspector. The only shape that is desktop-first; on a phone the inspector becomes a sheet.', ['Programming editor', 'Website editor', 'Campaign composer'], [B.bar, B.head, B.editor], 8)}
  </div>
</div>`;

  return page({
    title: 'The page patterns — eight shapes for ninety-five routes',
    sub: 'Rather than redesigning each screen individually, this is the set every screen is an instance of. Each card names the shape, the rule that governs it, and the surfaces that use it.',
    content,
  });
}

/* ======================================================== 04 modal system */

export function modalSystemBoard() {
  const bookSheetBody = `
  <div class="stack g12">
    <div class="row g10">
      ${dot(TYPE.metcon)}<span class="h3 grow">Metcon</span>
      <span class="chip chip-sm chip-warn">3 spots left</span>
    </div>
    <div class="row g12">
      <div class="grow stack g2"><span class="lbl" style="letter-spacing:.05em">When</span><span class="h3" style="font-size:14px">Thu 21 Aug · 17:30</span></div>
      <div class="grow stack g2"><span class="lbl" style="letter-spacing:.05em">Coach</span><span class="h3" style="font-size:14px">Priya Raman</span></div>
    </div>
    <div class="rule"></div>
    <div class="stack g8">
      <span class="lbl" style="letter-spacing:.05em">Who's in</span>
      <div class="row g10">${avstack(['lk', 'mb', 'ro', 'tm'], 22)}<span class="small" style="font-size:13px">Leila, Marcus and 15 others</span></div>
    </div>
    <div class="rule"></div>
    <div class="stack g8">
      <span class="lbl" style="letter-spacing:.05em">Book with</span>
      <div class="row g10"><span class="radio on"></span><span class="h3 grow" style="font-size:14px">Unlimited monthly</span><span class="chip chip-sm">Default</span></div>
      <div class="row g10"><span class="radio"></span><span class="h3 grow" style="font-size:14px">10-class pack</span><span class="small dim" style="font-size:12.5px">2 credits</span></div>
    </div>
  </div>`;

  const phoneWithSheet = phone(
    `${memberBar('book')}
     <div class="scrollarea" style="opacity:.55">
       ${pagehead('Book', 'Thursday 21 August')}
       ${chips([['All', true], ['Strength', false, dot(TYPE.strength)], ['Metcon', false, dot(TYPE.metcon)]])}
       <div style="padding:0 16px">${[1, 2, 3].map(() => `<div class="card" style="height:64px;margin-bottom:8px"></div>`).join('')}</div>
     </div>
     ${sheet({
       title: 'Metcon',
       sub: 'Thursday 21 August at 17:30',
       body: bookSheetBody,
       actions: `<span class="btn btn-plain">Not now</span><span class="btn btn-accent" style="flex:1.6">Book this class</span>`,
     })}`,
    { label: 'Phone — sheet' },
  );

  const sizeCard = (n, name, when, spec) => `
    <div class="card" style="padding:14px">
      <div class="row between"><span class="lbl">${n}</span><span class="badge">${name}</span></div>
      <div class="small" style="margin-top:9px;font-size:12.5px;line-height:1.45"><b class="strong">${when}</b> ${spec}</div>
    </div>`;

  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="card" style="padding:20px 22px">
    <span class="lbl">The rule</span>
    <div class="h2" style="margin-top:8px;font-size:19px">One modal. A sheet on a phone, a dialog on a desktop.</div>
    <div class="small" style="margin-top:8px;font-size:13.5px;max-width:720px">
      Today every modal in Temple is a centred box with a dimmed backdrop, on
      every screen size — which on a 390px phone means a floating card with
      the keyboard underneath it. Same title, same body, same actions, same
      order: only the container changes with the viewport.
    </div>
  </div>

  <div class="row g24" style="margin-top:20px;align-items:flex-start">
    ${phoneWithSheet}
    <div class="stack g14" style="flex:1;min-width:0">
      <span class="frame-label">Desktop — dialog</span>
      <div style="background:var(--surface-3);border-radius:16px;padding:34px;display:flex;justify-content:center">
        ${dialog({
          title: 'Metcon',
          sub: 'Thursday 21 August at 17:30',
          body: bookSheetBody,
          actions: `<span class="btn btn-plain btn-sm">Not now</span><span class="btn btn-accent btn-sm">Book this class</span>`,
          width: 430,
        })}
      </div>
      <div class="row g12" style="align-items:stretch">
        <div class="card grow" style="padding:14px">
          <span class="lbl">Anatomy</span>
          <div class="stack g6" style="margin-top:9px">
            ${[
              'Grabber, sheet only — it is the affordance that says swipe.',
              'Title left, close right. The title is the thing, not the verb.',
              'Body scrolls; the head and the foot never do.',
              'Foot: primary right on desktop, full-width pair on a phone.',
              'Cancel is always the left/secondary. It is never destructive.',
            ].map((t) => `<div class="row g8" style="align-items:flex-start">${ic('check', 13, 'color:var(--ink-3);margin-top:2px')}<span class="small" style="font-size:12.5px">${t}</span></div>`).join('')}
          </div>
        </div>
        <div class="card grow" style="padding:14px">
          <span class="lbl">Never</span>
          <div class="stack g6" style="margin-top:9px">
            ${[
              'A modal inside a modal — a step becomes a page inside the sheet.',
              'A destructive action as the default focus.',
              'A modal for something that deserves a route (deep links, back).',
              'Two primary buttons.',
              'A dismiss that silently discards typed input.',
            ].map((t) => `<div class="row g8" style="align-items:flex-start">${ic('close', 13, 'color:var(--bad);margin-top:2px')}<span class="small" style="font-size:12.5px">${t}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <span class="lbl">Four sizes, chosen by what the user has to do</span>
  <div class="row g12 wrap" style="margin-top:14px">
    ${sizeCard('01', 'Confirm', 'Title, one paragraph, two buttons.', 'The paragraph states the consequence in plain words — what is lost, who is told, whether it is reversible. Cancel · Confirm. Used by: remove member, cancel class, erase health data, delete plan.')}
    ${sizeCard('02', 'Form', 'Fields and a sticky foot.', 'Never taller than the sheet; if it is, it is a page. Used by: invite member, create class, record workout, add plan, tag rules.')}
    ${sizeCard('03', 'Detail', 'Rich content, scrolls, one primary.', 'Shows a thing and offers the one action you came for. Used by: class detail, member quick-view, leaderboard, image viewer.')}
    ${sizeCard('04', 'Takeover', 'Full height, its own header, multi-step.', 'Has a back rather than a close, and a step counter. Used by: import members, Stripe import, waiver signing, agent setup.')}
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <span class="lbl">The destructive confirm, in full</span>
  <div class="row g24" style="margin-top:14px;align-items:flex-start">
    <div style="background:var(--surface-3);border-radius:16px;padding:30px;display:flex;justify-content:center;flex:1">
      ${dialog({
        title: 'Cancel Thursday 17:30 Metcon?',
        body: `<div class="small" style="font-size:13.5px;line-height:1.55">
                 17 members are booked in. Everyone is refunded in full — credits
                 go straight back, no cancellation penalty — and everyone gets
                 an email and an in-app notice telling them why.
               </div>
               <div class="inset" style="margin-top:12px">
                 ${field('Tell them why (optional)', '', { hint: 'Coach is unwell — back Friday' })}
               </div>`,
        actions: `<span class="btn btn-plain btn-sm">Keep the class</span><span class="btn btn-sm" style="background:var(--bad);color:#fff">Cancel the class</span>`,
        width: 440,
      })}
    </div>
    <div class="card" style="flex:1;padding:18px">
      <span class="lbl">Why this shape</span>
      <div class="stack g10" style="margin-top:10px">
        ${[
          ['The title is the question', 'It names the exact thing, with enough detail to be sure you have the right one.'],
          ['The body is the consequence', 'Who is affected, what they get back, what they are told. Not "this cannot be undone".'],
          ['Red appears once', 'Only on the confirm. The heading, the border and the icon stay monochrome, so red still means something.'],
          ['The safe option is named', '"Keep the class", not "Cancel" — which in a cancel dialog means both things at once.'],
        ].map(([t, d]) => `<div class="stack g2"><span class="h3" style="font-size:13.5px">${t}</span><span class="small dim" style="font-size:12.5px;line-height:1.45">${d}</span></div>`).join('')}
      </div>
    </div>
  </div>
</div>`;

  return page({
    title: 'The modal system',
    sub: 'Temple has 26 modal components and they are all centred dialogs on every screen size. This is one component with two containers, four sizes, and a written rule for the destructive case.',
    content,
  });
}
