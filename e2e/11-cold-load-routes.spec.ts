import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

// Journey 11: every route survives a cold load.
//
// src/lib/vercel-rewrites.test.ts proves vercel.json agrees with the files on
// disk. That is a different claim from "Vercel serves this URL", and only the
// second one was ever wrong: /timeline/payment/<id>, /trial/<token> and
// /inbox/announcement/<id> shipped with no rewrite and answered the platform's
// white 404 page. Nothing in the repo asked for one of those URLs over HTTP,
// so nothing knew.
//
// This asks. It signs in as nobody: a cold load of a gated URL should reach
// Temple, which then decides where to send you. What it must never be is
// Vercel's 404, and that is all this asserts — not what renders next, which
// belongs to whichever journey owns that screen.
//
// The URL list is derived from vercel.json rather than written out, so a
// rewrite added tomorrow is smoke-tested tomorrow without anyone remembering.

const ROUTES = (
  JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    rewrites: { source: string }[];
  }
).rewrites.map((r) => r.source);

// Stand-ins per param shape. A uuid route handed "abc" can legitimately show
// its own not-found, which is Temple's answer and fine; a real-looking uuid
// keeps the response on the path we care about for longer.
const UUID = '00000000-0000-0000-0000-000000000000';
function fill(source: string): string {
  return source
    .split('/')
    .map((s) => {
      if (!s.startsWith(':')) return s;
      const name = s.replace(/^:/, '').replace(/\*$/, '');
      if (name === 'slug') return 'demo-crossfit-good-life';
      if (name === 'token') return 'TRIALTOKEN';
      if (name === 'movement') return 'back-squat';
      if (name === 'group') return 'legs';
      return UUID;
    })
    .join('/');
}

test('no route answers the platform 404 on a cold load', async ({ page }) => {
  const broken: string[] = [];

  for (const source of ROUTES) {
    const url = fill(source);
    const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
    const status = res?.status() ?? 0;
    // Vercel's own error page, not ours: it says NOT_FOUND and carries an ID,
    // and Temple's chrome is nowhere on it.
    const body = await page.content();
    const platform404 = /404: NOT_FOUND|Code: .?NOT_FOUND/.test(body);
    if (status === 404 || platform404) {
      broken.push(`${source} → ${url} (status ${status}${platform404 ? ', platform 404 page' : ''})`);
    }
  }

  expect(broken, `these URLs do not resolve:\n${broken.join('\n')}`).toEqual([]);
});
