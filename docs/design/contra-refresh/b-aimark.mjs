// Board 05: choosing the glyph that means "a machine did this".
import {
  ic, icf, AI, AI_CHOICE, aiGlyph, orb, orbLegacy, AV, avstack, TYPE,
  page, row, sw, field, dot,
} from './kit.mjs';

const CANDIDATES = [
  ['sparkle', 'Sparkle', 'The four-point star. Nobody has to be taught what it means, and it is the only candidate that survives 12px with room to spare. The cost is that it is not ours — every product shipping an assistant is using it.', true],
  ['sparkleCut', 'Sparkle · Temple cut', 'The same star, taller than it is wide with deeper waists. Reads identically at a glance and stops being the stock glyph at a second look. One line to switch.', false, 'Variant'],
  ['housemark', 'Housemark', 'Temple’s own mark, on a squared tile. The most ownable — it says who did the work rather than what did it — and the one that needs the most explaining.', false],
  ['ember', 'Ember', 'A solid core inside a faint ring. Reads as something running rather than something built. Calm, and the closest in spirit to the sphere without being one.', false],
  ['aperture', 'Aperture', 'Three arcs around a core. The most explicitly mechanical, and the most legible as “not a person” — but it mushes below 14px.', false],
  ['engraved', 'Engraved', 'The sphere, in ink, with the highlight cut out. Keeps the silhouette we had and drops the rainbow. Safest, least distinctive.', false],
  ['keystone', 'Keystone', 'The stone that holds an arch together — the right idea, and the first thing I drew. Rejected on sight: below about 20px a trapezoid wider at the top is a bucket.', false],
];

/* ------------------------------------------------------------- contexts */

const ctxNav = (kind) => `
<div class="card" style="padding:9px;width:186px">
  <div class="navrow" style="height:36px;padding:0 10px"><span style="color:var(--ink-3)">${ic('chat', 18)}</span><span class="grow" style="font-size:13.5px">Timeline</span></div>
  <div class="navrow on" style="height:36px;padding:0 10px">${orb(18, kind)}<span class="grow" style="font-size:13.5px">Co—Agent</span></div>
  <div class="navrow" style="height:36px;padding:0 10px"><span style="color:var(--ink-3)">${ic('bell', 18)}</span><span class="grow" style="font-size:13.5px">Notifications</span></div>
</div>`;

const ctxCard = (kind) => `
<div class="card" style="padding:12px;width:280px;background:var(--surface-2);border-color:transparent">
  <div class="row g10" style="align-items:flex-start">
    ${orb(24, kind)}
    <div class="grow">
      <div class="small" style="font-size:12.5px;line-height:1.45;color:var(--ink)">I've asked <b class="strong">Sam Whitlock</b> to update his card, and I'll chase again Friday.</div>
      <div class="row g6" style="margin-top:10px"><span class="chip chip-sm">${ic('clock', 11)}Chased 2 days ago</span></div>
    </div>
  </div>
</div>`;

const ctxSend = (kind) => `
<div class="field" style="width:280px;min-height:42px">
  <span class="grow" style="font-size:14px">Show me a member…</span>
  <span class="btn btn-dark btn-sm" style="padding:0 11px 0 7px;height:30px;font-size:12.5px">${orb(15, kind)}Go</span>
</div>`;

const ctxBubble = (kind) => `
<div class="card" style="padding:10px 12px;width:250px;background:var(--surface-2);border-color:transparent">
  <div class="row g6" style="margin-bottom:5px">${orb(12, kind)}<span class="lbl" style="letter-spacing:.05em;font-size:9.5px">Front desk</span></div>
  <span class="small" style="font-size:12.5px;line-height:1.45;color:var(--ink)">We do — Metcon at 17:30, Monday to Thursday.</span>
</div>`;

const ctxRow = (kind) => `
<div class="listrow" style="width:280px">
  ${AV('je', 30)}
  <div class="stack g2 grow" style="min-width:0"><span class="h3 trunc" style="font-size:13.5px">Jonah Ellis</span><span class="small dim trunc" style="font-size:12px">Website · asked about evenings</span></div>
  ${orb(15, kind)}<span class="chip chip-sm chip-ok">Talking</span>
</div>`;

/* --------------------------------------------------------------- board */

export function aiMarkBoard() {
  const candidate = ([kind, name, blurb, rec, tag]) => `
  <div class="card" style="width:145px;padding:11px;${rec ? 'border-color:var(--ink)' : ''}">
    <div class="row between" style="height:22px">
      <span class="lbl" style="font-size:9.5px;letter-spacing:.06em">${rec ? 'Chosen' : (tag ?? 'Alternative')}</span>
      ${rec ? `<span class="badge" style="background:var(--ink);color:#fff">In use</span>` : ''}
    </div>
    <div class="row g12" style="margin-top:13px;align-items:flex-end;height:40px;gap:8px;color:var(--ink)">
      ${aiGlyph(34, kind)}${aiGlyph(19, kind)}${aiGlyph(14, kind)}${aiGlyph(12, kind)}
    </div>
    <div class="row g6" style="margin-top:14px">
      <span class="aimark" style="width:30px;height:30px;border-radius:9px">${aiGlyph(18, kind)}</span>
      <span class="btn btn-dark btn-sm" style="width:30px;height:30px;padding:0;border-radius:999px">${aiGlyph(15, kind)}</span>
      <span style="width:30px;height:30px;border-radius:999px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--ink-3)">${aiGlyph(15, kind)}</span>
    </div>
    <div class="h2" style="margin-top:12px;font-size:15px">${name}</div>
    <div class="small" style="margin-top:5px;font-size:11.5px;line-height:1.42">${blurb}</div>
  </div>`;

  const contexts = (kind, label) => `
  <div class="stack g10">
    <span class="lbl">${label}</span>
    <div class="row g12 wrap" style="align-items:flex-start">
      ${ctxNav(kind)}${ctxCard(kind)}${ctxSend(kind)}${ctxBubble(kind)}${ctxRow(kind)}
    </div>
  </div>`;

  const content = `
<div class="app" style="max-width:1180px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:30px">

  <div class="card" style="padding:20px 22px">
    <div class="row g24 wrap" style="align-items:flex-start">
      <div style="flex:1;min-width:320px">
        <span class="lbl">Why it changes</span>
        <div class="h2" style="margin-top:8px;font-size:19px">The sphere was the reference’s, not ours.</div>
        <div class="small" style="margin-top:8px;font-size:13.5px;max-width:470px">
          The iridescent orb is lifted almost verbatim from Contra — and from
          every other product shipping an assistant this year. It is also the
          only gradient in a system whose whole argument is that colour comes
          from content.
        </div>
      </div>
      <div style="flex:1;min-width:320px">
        <span class="lbl">What it has to do</span>
        <div class="stack g8" style="margin-top:10px">
          ${[
            'Sit in an avatar slot without reading as a person.',
            'Survive 12px inside a chat label and 15px inside a dark pill.',
            'Work in one colour, on light and on dark.',
            'Never be mistaken for the gym’s own colour or logo.',
          ].map((t) => `<div class="row g8" style="align-items:flex-start">${ic('check', 14, 'color:var(--ink-3);margin-top:2px')}<span class="small" style="font-size:13px">${t}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="rule" style="margin:18px 0 14px"></div>
    <div class="row g16 wrap" style="align-items:center">
      <span class="lbl" style="width:78px">Was</span>
      <span class="row g10">${orbLegacy(26)}${orbLegacy(19)}${orbLegacy(15)}${orbLegacy(12)}</span>
      <span class="small dim" style="font-size:12.5px">A conic gradient. Six colours, no meaning, and a stranger’s.</span>
    </div>
    <div class="row g16 wrap" style="margin-top:12px;align-items:center">
      <span class="lbl" style="width:78px">Now</span>
      <span class="row g10" style="color:var(--ink)">${aiGlyph(26)}${aiGlyph(19)}${aiGlyph(15)}${aiGlyph(12)}</span>
      <span class="small dim" style="font-size:12.5px">One colour, one shape. Every person in the product is a circle; the machine is a rounded square — read before the glyph inside it is.</span>
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <span class="lbl">Seven candidates, at the four sizes they actually ship at</span>
  <div class="row wrap" style="margin-top:14px;gap:12px;align-items:stretch">
    ${CANDIDATES.map(candidate).join('')}
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <span class="lbl">The choice, in every place it appears</span>
  <div class="stack g20" style="margin-top:14px;gap:20px">
    ${contexts('sparkle', 'Sparkle — light')}
    <div class="app dark" style="background:var(--bg);border-radius:18px;padding:18px">
      ${contexts('sparkle', 'Sparkle — dark')}
    </div>
  </div>

  <div class="rule" style="margin:26px 0"></div>
  <div class="row g24" style="align-items:flex-start">
    <div class="card" style="flex:1;padding:18px">
      <span class="lbl">The rule that comes with it</span>
      <div class="stack g10" style="margin-top:11px">
        ${[
          ['One glyph, everywhere', 'Timeline, the rules sheet, Analysis, the campaign composer, the lead conversation, the setup card, the send button. Nothing else may stand in for it.'],
          ['Solid is reserved', 'It is the only filled icon in the product. Every other icon is a 1.6px monoline stroke, so "a machine did this" reads before you have parsed the shape.'],
          ['Squared in an avatar slot', 'At 22px and up it takes a rounded-square tile, ink on light and paper on dark. People are circles. Below 22px it is a bare glyph standing in for a line icon.'],
          ['Never the accent colour', 'It is ink on light, paper on dark. The gym’s colour means the gym; this means the machine. They must not be the same signal.'],
        ].map(([t, d]) => `<div class="stack g2"><span class="h3" style="font-size:13.5px">${t}</span><span class="small dim" style="font-size:12.5px;line-height:1.45">${d}</span></div>`).join('')}
      </div>
    </div>
    <div class="card" style="flex:1;padding:18px">
      <span class="lbl">What we give up, and what carries it instead</span>
      <div class="stack g10" style="margin-top:11px">
        ${[
          ['Given up: distinctiveness', 'The four-point star is the industry’s glyph, not Temple’s. Nobody will see it and think of this product — which is a fair trade for nobody ever having to work out what it means.'],
          ['Carried by shape instead', 'Every person in the product is a circle; the machine takes a rounded square. That reads before the glyph inside it does, and it survives greyscale and a 1-bit render.'],
          ['Carried by weight instead', 'It is the only solid-filled icon among about thirty 1.6px monoline ones. “A machine did this” lands from the fill before the silhouette is parsed.'],
          ['Carried by discipline instead', 'One glyph, sixteen places, never the accent colour, never a second AI badge alongside it. Consistency is what will make it feel owned.'],
        ].map(([t, d]) => `<div class="stack g2"><span class="h3" style="font-size:13.5px">${t}</span><span class="small dim" style="font-size:12.5px;line-height:1.45">${d}</span></div>`).join('')}
      </div>
    </div>
  </div>
</div>`;

  return page({
    title: 'The AI mark — sparkle',
    sub: 'The iridescent orb was the reference’s, so it goes. The four-point star is what replaces it — the one glyph nobody has to be taught. Seven candidates at the sizes they actually ship at, the choice in every context it appears, and the rules that do the work distinctiveness will not.',
    content,
  });
}
