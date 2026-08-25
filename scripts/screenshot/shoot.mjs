// Screenshots the real app, signed in, against the fake backend.
//
// Run:
//   node scripts/screenshot/build.mjs      # export pointed at the harness
//   node scripts/screenshot/server.mjs &   # serve it
//   node scripts/screenshot/shoot.mjs [route…]
//
// Or `npm run shots`, which does all three.
//
// Every board in the design refresh before this one was drawn by hand in
// HTML from reading the code. They were close enough to reason with and
// wrong in ways nobody could see until the app was opened: the real nav
// pills carry icons, the real Manage hub has a date-range picker and a
// finance block that no board showed. This exists so that never happens
// again — what gets sent is a render of the thing that shipped.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHOT_OUT || join(HERE, 'out');
const PORT = Number(process.env.SHOT_PORT || 8100);

const require = createRequire(join(HERE, '../../package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

// The routes worth having a picture of, named the way the app names them.
const ROUTES = [
  ['manage', '/management'],
  ['timeline', '/timeline'],
  ['classes', '/classes'],
  ['members', '/management/members'],
  ['plans', '/management/plans'],
  ['store-staff', '/management/store'],
  ['email', '/management/communications'],
  ['team', '/management/team'],
  ['tasks', '/management/tasks'],
  ['book', '/book'],
  ['track', '/track'],
  ['account', '/account'],
];

// Phone and a rail-width desktop: 1024 is where SideNav arrives, so a
// board that only ever showed a phone never showed the rail at all.
const SIZES = [
  ['phone', 414, 896],
  ['desk', 1280, 900],
];

// Public routes are rendered in a fresh context BEFORE signing in —
// they are the only screens whose whole job is to work for somebody who
// has no account, and a signed-in render shows a different page.
const PUBLIC_ROUTES = [
  ['trial', '/trial/DEMO1234'],
];

const only = process.argv.slice(2);
const pick = (list) =>
  only.length
    ? list.filter(([name, path]) => only.some((o) => name.includes(o) || path.includes(o)))
    : list;
const routes = pick(ROUTES);
const publicRoutes = pick(PUBLIC_ROUTES);

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PRE = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(PRE) ? { executablePath: PRE } : {});

// Signing in for real rather than seeding the session into localStorage.
// Seeding looks simpler and is not: auth-js owns the shape and the key,
// validates the access token as a JWT on load, and drops anything it did
// not write itself — which bounced the harness to /sign-in with no
// network call at all and no error. Driving the form makes the app's own
// code store the session, so this cannot drift from what the app expects.
async function signIn(page) {
  await page.goto(`http://localhost:${PORT}/sign-in`, { waitUntil: 'networkidle' });
  // By role, not by label: Input renders a "Show password" button that
  // also carries the word Password, so getByLabel matches two nodes.
  await page.getByRole('textbox', { name: 'Email' }).fill('owner@forge.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('harness-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.includes('/sign-in'), { timeout: 20000 });
}

let shot = 0;
const failures = [];

for (const [sizeName, width, height] of SIZES) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript((theme) => {
      try {
        window.localStorage.setItem('app_theme', theme);
        // The cookie banner covers the foot of every screen otherwise.
        // Key and value from src/lib/cookie-consent.ts.
        window.localStorage.setItem('temple.cookieConsent', 'accepted');
      } catch {}
    }, scheme);
    const page = await ctx.newPage();
    // Expo's static export hydrates, and hydration mismatches are noisy
    // without being interesting here; only real failures are collected.
    page.on('pageerror', (e) => {
      if (!/Minified React error #418/.test(e.message)) {
        failures.push(`${sizeName}/${scheme}: ${e.message}`);
      }
    });

    for (const [name, path] of publicRoutes) {
      const file = join(OUT, `${name}-${sizeName}-${scheme}.png`);
      try {
        await page.goto(`http://localhost:${PORT}${path}`, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: file, fullPage: true });
        shot += 1;
        console.log(`  ${name} ${sizeName} ${scheme} (signed out)`);
      } catch (e) {
        failures.push(`${name} ${sizeName} ${scheme}: ${e.message}`);
      }
    }

    try {
      await signIn(page);
    } catch (e) {
      failures.push(`sign-in ${sizeName}/${scheme}: ${e.message}`);
      await ctx.close();
      continue;
    }

    for (const [name, path] of routes) {
      const file = join(OUT, `${name}-${sizeName}-${scheme}.png`);
      try {
        await page.goto(`http://localhost:${PORT}${path}`, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
        // react-query settles a beat after the network does.
        await page.waitForTimeout(1200);
        await page.screenshot({ path: file, fullPage: true });
        shot += 1;
        console.log(`  ${name} ${sizeName} ${scheme}`);
      } catch (e) {
        failures.push(`${name} ${sizeName} ${scheme}: ${e.message}`);
      }
    }
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${shot} screenshots in ${OUT}`);
if (failures.length) {
  console.log(`\n${failures.length} problems:`);
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
  process.exitCode = 1;
}
