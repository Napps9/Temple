import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The web build is a STATIC export: every route becomes one .html file, so
// dist/timeline/[action].html is a file literally called "[action].html".
// A request for /timeline/abc reaches it only because vercel.json rewrites
// /timeline/:action onto it. A dynamic route with no rewrite therefore does
// not fail in the app — it 404s at Vercel, the white NOT_FOUND page, before
// any of our code runs.
//
// That is not hypothetical. /timeline/payment/[subscription] shipped with no
// rewrite and a gym owner hit the 404 opening a failing payment on the demo.
// Two more were missing with it: /trial/[token], which is in every emailed
// trial link, and /inbox/announcement/[id]. Nothing noticed, because
// client-side navigation into those screens works perfectly — only a cold
// load, a refresh, or a pasted link ever asks Vercel for the URL.
//
// So: every dynamic route must have its rewrite, and every rewrite must
// still have its route. The mapping is mechanical, which is why a test can
// hold it rather than a person remembering.

const APP = 'src/app';

type Route = { file: string; url: string; source: string; destination: string };

function routeFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}${name}/`);
    if (!name.endsWith('.tsx')) return [];
    // +html and +not-found are Expo Router's own, not addressable routes;
    // a layout is never served on its own.
    if (name.startsWith('+') || name === '_layout.tsx') return [];
    return [`${prefix}${name}`];
  });
}

// A directory in parentheses is a route GROUP: it organises files and
// contributes no url segment, which is why (staff)/timeline/payment/[x] is
// served at /timeline/payment/<x> and the destination drops it too.
function segments(file: string): string[] {
  return file
    .replace(/\.tsx$/, '')
    .split('/')
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')));
}

function describeRoute(file: string): Route {
  const parts = segments(file);
  const urlParts = parts[parts.length - 1] === 'index' ? parts.slice(0, -1) : parts;
  return {
    file,
    url: `/${urlParts.join('/')}`,
    source: `/${urlParts
      .map((s) => (s.startsWith('[') && s.endsWith(']') ? `:${s.slice(1, -1)}` : s))
      .join('/')}`,
    destination: `/${parts.join('/')}`,
  };
}

const dynamicRoutes: Route[] = routeFiles(APP)
  .map(describeRoute)
  .filter((r) => r.url.includes('['))
  .sort((a, b) => a.source.localeCompare(b.source));

const rewrites = (
  JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    rewrites?: { source: string; destination: string }[];
  }
).rewrites ?? [];

describe('vercel rewrites cover every dynamic route', () => {
  it('finds the dynamic routes at all', () => {
    // A walker that silently matched nothing would make every assertion
    // below pass while proving nothing.
    expect(dynamicRoutes.length).toBeGreaterThan(10);
  });

  it('has a rewrite for each one, pointing at the right file', () => {
    const bySource = new Map(rewrites.map((r) => [r.source, r.destination]));
    const wrong = dynamicRoutes
      .filter((r) => bySource.get(r.source) !== r.destination)
      .map((r) =>
        bySource.has(r.source)
          ? `${r.file} → "${r.source}" points at "${bySource.get(r.source)}", want "${r.destination}"`
          : `${r.file} has no rewrite — add { "source": "${r.source}", "destination": "${r.destination}" }`,
      );
    expect(wrong).toEqual([]);
  });

  it('has no rewrite left pointing at a route that is gone', () => {
    const live = new Set(dynamicRoutes.map((r) => r.source));
    const dead = rewrites
      .filter((r) => !live.has(r.source))
      .map((r) => `${r.source} → ${r.destination} matches no route file`);
    expect(dead).toEqual([]);
  });

  it('names every param after the file it comes from', () => {
    // A rewrite whose :param spelling drifts from the [bracket] still
    // resolves the page but hands the screen an empty useLocalSearchParams,
    // which reads as "not found" rather than as a routing bug.
    const drift = dynamicRoutes
      .filter((r) => {
        const params = segments(r.file)
          .filter((s) => s.startsWith('['))
          .map((s) => s.slice(1, -1));
        return !params.every((p) => r.source.includes(`:${p}`));
      })
      .map((r) => r.file);
    expect(drift).toEqual([]);
  });
});
