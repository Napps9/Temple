// Regenerates every Temple mark asset from the one path in this file.
//
// The mark is the brand star — the AI star's silhouette in the brand
// magenta — drawn in exactly two places: src/components/TempleMark.tsx
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
// The dawn's leading stop — BRAND in src/lib/theme.ts.
const MAGENTA = '#E04898';

// Kept identical to STAR in src/components/AIMark.tsx.
const STAR =
  'M12 2.1c.85 4.6 2.3 6.9 5.6 7.95l3.3.95-3.3.95c-3.3 1.05-4.75 3.35-5.6 7.95-.85-4.6-2.3-6.9-5.6-7.95L3.1 11l3.3-.95C9.7 9 11.15 6.7 12 2.1z';

// `pad` widens the viewBox so the star sits inside a tile with air around
// it — app icons need the margin, a mark in a row does not.
function starSvg({ fill = MAGENTA, pad = 0, bg = null } = {}) {
  const min = 0 - pad;
  const span = 24 + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min} ${min} ${span} ${span}" width="${span}" height="${span}">${
    bg ? `<rect x="${min}" y="${min}" width="${span}" height="${span}" fill="${bg}"/>` : ''
  }<path d="${STAR}" fill="${fill}"/></svg>`;
}

// Fraunces, inlined so the lockup is self-contained and renders on a
// machine with no fonts installed. Read out of node_modules rather than
// fetched: it is then provably the same file the app loads, so the flat
// asset cannot drift from the screen.
const fontCss = `@font-face{font-family:'Fraunces';font-weight:700;src:url(data:font/ttf;base64,${readFileSync(
  join(ROOT, 'node_modules/@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf'),
).toString('base64')}) format('truetype')}`;

// The word with the star tucked against the final letter's shoulder —
// same offsets as TempleLockup in the component (right -0.18em, up
// -0.20em, star 0.42em).
function lockupSvg({ ink = INK } = {}) {
  const size = 26;
  const starSize = Math.round(size * 0.42);
  const wordW = 78; // Fraunces 700 'temple' at 26px
  const starX = wordW - Math.round(starSize * 0.45);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -8 92 40" width="92" height="40">
<style>${fontCss}
.w{font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:${size}px;fill:${ink}}</style>
<text class="w" x="0" y="24">temple</text>
<svg x="${starX}" y="${-Math.round(size * 0.2) - 2}" width="${starSize}" height="${starSize}" viewBox="0 0 24 24"><path d="${STAR}" fill="${MAGENTA}"/></svg>
</svg>`;
}

// One entry per file the build, an app store, or a person putting the
// mark on something asks for. `size` present means also rasterise it.
const ASSETS = [
  // The app icon is the star on ink — the owner's pick over paper.
  ['assets/images/icon.png', starSvg({ pad: 7, bg: INK }), 1024],
  // Favicons take the ink tile, same as the app icon — owner's call.
  ['assets/images/favicon.png', starSvg({ pad: 3, bg: INK }), 48],
  ['assets/images/favicon-32.png', starSvg({ pad: 3, bg: INK }), 32],
  ['assets/images/splash-icon.png', starSvg({ pad: 2 }), 192],
  // Android adaptive layers: magenta star on the generated ink background;
  // the monochrome layer is single-colour by platform rule.
  ['assets/images/android-icon-foreground.png', starSvg({ pad: 14 }), 432],
  ['assets/images/android-icon-background.png', starSvg({ fill: 'none', pad: 14, bg: INK }), 432],
  ['assets/images/android-icon-monochrome.png', starSvg({ fill: '#FFFFFF', pad: 14 }), 432],

  ['assets/images/temple-brand/mark-on-light.svg', starSvg()],
  ['assets/images/temple-brand/mark-on-dark.svg', starSvg()],
  ['assets/images/temple-brand/mark-on-light-512px.png', starSvg({ pad: 1 }), 512],
  ['assets/images/temple-brand/mark-on-dark-512px.png', starSvg({ pad: 1 }), 512],
  ['assets/images/temple-brand/lockup-on-light.svg', lockupSvg({ ink: INK })],
  ['assets/images/temple-brand/lockup-on-dark.svg', lockupSvg({ ink: PAPER })],
];

// The lockup is wider than it is tall, so it cannot go through the square
// shot below; these carry their own box.
const WIDE = [
  [
    'assets/images/temple-brand/lockup-on-light-960px.png',
    lockupSvg({ ink: INK }),
    920,
    400,
  ],
  [
    'assets/images/temple-brand/lockup-on-dark-960px.png',
    lockupSvg({ ink: PAPER }),
    920,
    400,
  ],
  // Every Temple email embeds this as a foreground <img> — Gmail strips
  // SVGs, so it has to be a PNG at a public URL. 560px for a 196px slot.
  ['public/email/temple-lockup.png', lockupSvg({ ink: INK }), 460, 200],
  ['public/email/temple-lockup-on-dark.png', lockupSvg({ ink: PAPER }), 460, 200],
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
