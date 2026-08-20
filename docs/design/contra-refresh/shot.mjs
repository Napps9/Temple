// Screenshots every board built by build.mjs into png/ at 2x.
// Run: node build.mjs && node shot.mjs
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const only = process.argv.slice(2);
const pages = readdirSync(HERE)
  .filter((f) => /^\d\d-.*\.html$/.test(f))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort();

// The container ships one Chromium at a fixed path; the playwright build
// resolved above may expect a different revision folder and refuse to
// launch. Point it at what is actually installed when that path exists.
const PREINSTALLED = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1200 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

for (const f of pages) {
  await page.goto(pathToFileURL(join(HERE, f)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const width = await page.evaluate(
    () => document.body.scrollWidth + 0, // boards size themselves
  );
  if (width > 1400) await page.setViewportSize({ width: Math.ceil(width), height: 1200 });
  const out = join(HERE, 'png', f.replace('.html', '.png'));
  await page.screenshot({ path: out, fullPage: true });
  console.log('shot', resolve(out));
  await page.setViewportSize({ width: 1400, height: 1200 });
}

await browser.close();
