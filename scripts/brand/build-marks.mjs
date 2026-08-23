// Regenerates every Temple mark asset from the one path in this file.
//
// The mark is drawn in exactly two places — src/components/TempleMark.tsx
// for anything inside the app, and here for the files a build tool or an
// app store needs as a flat file. If the two ever disagree, this file is
// the one that is stale: the component is what people actually see.
//
//   node scripts/brand/build-marks.mjs
//
// Needs Chromium; the container has one at /opt/pw-browsers/chromium.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const INK = '#14161A';
const PAPER = '#F4F5F6';

// The three offset cards, kept identical to CARD in
// src/components/TempleMark.tsx: the front card holds the column as an
// even-odd knockout, the two cards behind are hairline ghosts. Below
// ~20px the ghosts stop being depth and start being noise, so small
// renders (favicons) are the front card alone — the same rule the
// component applies via GHOSTS_ABOVE.
const CARD =
  'M5 0H67A5 5 0 0 1 72 5V67A5 5 0 0 1 67 72H5A5 5 0 0 1 0 67V5A5 5 0 0 1 5 0Z' +
  'M27 31.5A9 6 0 0 1 45 31.5V63H27Z';

function glyph(ink, ghosts) {
  return (
    (ghosts
      ? `<rect x="20.8" y="20.8" width="70.4" height="70.4" rx="5" fill="none" stroke="${ink}" stroke-width="2" stroke-opacity="0.3"/>` +
        `<rect x="10.8" y="10.8" width="70.4" height="70.4" rx="5" fill="none" stroke="${ink}" stroke-width="2" stroke-opacity="0.55"/>`
      : '') + `<path d="${CARD}" fill="${ink}" fill-rule="evenodd"/>`
  );
}

// `pad` widens the viewBox so the mark sits inside a tile with air around
// it — app icons need the margin, a mark in a row does not. The glyph box
// is the component's: 96 with the ghost cards, 76 without.
function markSvg({ ink = INK, pad = 0, bg = null, ghosts = true } = {}) {
  const box = ghosts ? 96 : 76;
  const min = -2 - pad;
  const span = box + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min} ${min} ${span} ${span}" width="${span}" height="${span}">${
    bg ? `<rect x="${min}" y="${min}" width="${span}" height="${span}" fill="${bg}"/>` : ''
  }${glyph(ink, ghosts)}</svg>`;
}

// Fraunces, inlined so the lockup is self-contained and renders on a
// machine with no fonts installed. Read out of node_modules rather than
// fetched: it is then provably the same file the app loads, so the flat
// asset cannot drift from the screen.
const fontCss = `@font-face{font-family:'Fraunces';font-weight:700;src:url(data:font/ttf;base64,${readFileSync(
  join(ROOT, 'node_modules/@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf'),
).toString('base64')}) format('truetype')}`;

function lockupSvg({ ink = INK } = {}) {
  const size = 26;
  const markW = Math.round(size * 1.08);
  const gap = Math.round(size * 0.34);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 136 34" width="136" height="34">
<style>${fontCss}
.w{font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:${size}px;fill:${ink}}</style>
<svg x="0" y="3" width="${markW}" height="${markW}" viewBox="-2 -2 96 96">${glyph(ink, true)}</svg>
<text class="w" x="${markW + gap}" y="26">temple</text>
</svg>`;
}

// One entry per file the build, an app store, or a person putting the
// mark on something asks for. `size` present means also rasterise it.
const ASSETS = [
  // The app icon is the mark on paper — a transparent icon renders on
  // whatever the launcher feels like, which is not a decision to give away.
  ['assets/images/icon.png', markSvg({ pad: 9, bg: PAPER }), 1024],
  ['assets/images/favicon.png', markSvg({ pad: 4, bg: PAPER, ghosts: false }), 48],
  ['assets/images/favicon-32.png', markSvg({ pad: 4, bg: PAPER, ghosts: false }), 32],
  // Splash and the Android foreground sit on their own background colour,
  // so these are transparent by design.
  ['assets/images/splash-icon.png', markSvg({ pad: 2 }), 192],
  ['assets/images/android-icon-foreground.png', markSvg({ pad: 22 }), 432],
  ['assets/images/android-icon-monochrome.png', markSvg({ pad: 22 }), 432],

  ['assets/images/temple-brand/mark-on-light.svg', markSvg({ ink: INK })],
  ['assets/images/temple-brand/mark-on-dark.svg', markSvg({ ink: PAPER })],
  ['assets/images/temple-brand/mark-on-light-512px.png', markSvg({ pad: 2 }), 512],
  [
    'assets/images/temple-brand/mark-on-dark-512px.png',
    markSvg({ ink: PAPER, pad: 2 }),
    512,
  ],
  ['assets/images/temple-brand/lockup-on-light.svg', lockupSvg({ ink: INK })],
  ['assets/images/temple-brand/lockup-on-dark.svg', lockupSvg({ ink: PAPER })],
];

// The lockup is wider than it is tall, so it cannot go through the square
// shot below; these carry their own box.
const WIDE = [
  [
    'assets/images/temple-brand/lockup-on-light-960px.png',
    lockupSvg({ ink: INK }),
    960,
    240,
  ],
  [
    'assets/images/temple-brand/lockup-on-dark-960px.png',
    lockupSvg({ ink: PAPER }),
    960,
    240,
  ],
];

function write(path, contents) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), contents);
  console.log('wrote', path);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
});
const page = await browser.newPage();

async function shoot(svg, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}body>svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
  );
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: true });
}

for (const [path, svg, size] of ASSETS) {
  write(path, size ? await shoot(svg, size, size) : svg);
}
for (const [path, svg, w, h] of WIDE) {
  write(path, await shoot(svg, w, h));
}

await browser.close();
