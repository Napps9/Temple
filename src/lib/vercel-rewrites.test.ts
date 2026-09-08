import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The web build is a STATIC export (app.json web.output = "static"), so every
// route becomes one file on disk and a dynamic route becomes a file whose name
// contains brackets: dist/timeline/[action].html. Nothing on Vercel knows that
// "[action]" means "any segment". A request for /timeline/abc123 reaches that
// file only because vercel.json rewrites /timeline/:action onto it.
//
// A dynamic route shipped without its rewrite therefore does NOT fail in the
// app, where it would be visible. It 404s at the platform — the white
// "404: NOT_FOUND" page with a Code and an ID — before a line of Temple runs.
// Nothing catches it in review either, because every in-app tap into those
// screens is client-side routing and works perfectly. Only a cold load, a
// refresh, or a pasted link ever asks Vercel for the URL, which is exactly
// what an owner opening an emailed link does.
//
// So: every dynamic route file must have a rewrite, and every rewrite must
// still have its file. Both halves are mechanical, which is why a test holds
// them rather than a person remembering at the moment they add a screen.
//
// Two things this deliberately does not assert. Vercel checks the filesystem
// BEFORE applying rewrites, so /management/members/:profile does not eat
// /management/members/import — that page is a real file and wins. And an
// unknown URL still lands on Vercel's 404 rather than Temple's +not-found;
// that is a separate decision, not drift.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'src/app');

type Rewrite = { source: string; destination: string };

// Rewrites that are not a dynamic route's — a proxy, a vendor callback. Each
// states why, so the reverse check can stay strict without a reader having to
// guess whether an unmatched entry is deliberate or a leftover.
const NOT_A_ROUTE: Record<string, string> = {};

function routeFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}${name}/`);
    if (!/\.[jt]sx?$/.test(name) || /\.(test|d)\.[jt]sx?$/.test(name)) return [];
    // A layout is never served on its own, and Expo Router's own +html,
    // +not-found and +api files are not addressable URLs.
    if (name.startsWith('+') || name === '_layout.tsx') return [];
    return [`${prefix}${name}`];
  });
}

// A directory in parentheses is a route GROUP: it organises files and
// contributes no url segment. That is why (staff)/timeline/payment/[x] is
// served at /timeline/payment/<x>, and why the destination has to drop the
// group too — path-to-regexp reads "(staff)" as a capture group, so a
// destination that kept it would not resolve to any file.
function segments(file: string): string[] {
  return file
    .replace(/\.[jt]sx?$/, '')
    .split('/')
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')));
}

function param(segment: string): string | null {
  const m = /^\[(\.\.\.)?(.+)\]$/.exec(segment);
  if (!m) return null;
  // A catch-all [...rest] spans any number of segments, which in a rewrite
  // source is :rest* rather than :rest.
  return m[1] ? `:${m[2]}*` : `:${m[2]}`;
}

function describeRoute(file: string) {
  const parts = segments(file);
  return {
    file,
    // The bracketed path, which is the file the export actually wrote.
    destination: `/${parts.join('/')}`,
    source: `/${parts.map((s) => param(s) ?? s).join('/')}`,
    dynamic: parts.some((s) => param(s) !== null),
  };
}

const dynamicRoutes = routeFiles(APP)
  .map(describeRoute)
  .filter((r) => r.dynamic)
  .sort((a, b) => a.file.localeCompare(b.file));

const rewrites: Rewrite[] =
  (JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { rewrites?: Rewrite[] })
    .rewrites ?? [];

const line = (r: { source: string; destination: string }) =>
  `  { "source": "${r.source}", "destination": "${r.destination}" },`;

describe('every dynamic route has the rewrite that serves it', () => {
  // A walker that quietly matched nothing would make every assertion below
  // pass while proving nothing at all.
  it('finds the dynamic routes at all', () => {
    expect(dynamicRoutes.length).toBeGreaterThan(10);
    expect(rewrites.length).toBeGreaterThan(10);
  });

  it('has a rewrite for each one', () => {
    const byDestination = new Map(rewrites.map((r) => [r.destination, r.source]));
    const missing = dynamicRoutes
      .filter((r) => !byDestination.has(r.destination))
      .map((r) => `src/app/${r.file} would 404 on a cold load. Add to vercel.json rewrites:\n${line(r)}`);
    expect(missing, missing.join('\n\n')).toEqual([]);
  });

  // Matched by destination rather than by source, so a rewrite whose :param
  // spelling drifted from the [bracket] is reported as the drift it is. Such a
  // rewrite still resolves the page, then hands the screen an empty
  // useLocalSearchParams — which reads as "this record is gone", not as a
  // routing bug, and so gets debugged in the wrong file.
  it('names every param after the bracket it comes from', () => {
    const byDestination = new Map(rewrites.map((r) => [r.destination, r.source]));
    const drift = dynamicRoutes
      .filter((r) => byDestination.has(r.destination))
      .filter((r) => byDestination.get(r.destination) !== r.source)
      .map(
        (r) =>
          `src/app/${r.file} is served by "${byDestination.get(r.destination)}", which does not match the file. Want:\n${line(r)}`,
      );
    expect(drift, drift.join('\n\n')).toEqual([]);
  });

  // The other direction. A rewrite pointing at a deleted screen sends a real
  // request to a file that is not there, and the reader of vercel.json has no
  // way to tell it apart from one that works.
  it('has no rewrite pointing at a route that is gone', () => {
    const live = new Set(dynamicRoutes.map((r) => r.destination));
    const dead = rewrites
      .filter((r) => !live.has(r.destination) && !(r.source in NOT_A_ROUTE))
      .map(
        (r) =>
          `"${r.source}" → "${r.destination}" matches no file under src/app. Delete it, or name why it is not a route in NOT_A_ROUTE.`,
      );
    expect(dead, dead.join('\n')).toEqual([]);
  });

  it('has no two rewrites racing for the same file', () => {
    const seen = new Map<string, string[]>();
    for (const r of rewrites) {
      seen.set(r.destination, [...(seen.get(r.destination) ?? []), r.source]);
    }
    const doubled = [...seen.entries()]
      .filter(([, sources]) => sources.length > 1)
      .map(([destination, sources]) => `${destination} ← ${sources.join(' and ')}`);
    expect(doubled).toEqual([]);
  });

  it('keeps no stale exemption', () => {
    const sources = new Set(rewrites.map((r) => r.source));
    expect(Object.keys(NOT_A_ROUTE).filter((s) => !sources.has(s))).toEqual([]);
    for (const why of Object.values(NOT_A_ROUTE)) expect(why.length).toBeGreaterThan(20);
  });

  // The rewrites only work because the export is static and served flat. If
  // either changes, this whole file is answering a question nobody is asking
  // any more, and should be deleted rather than maintained.
  it('still describes how the site is actually served', () => {
    const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
    expect(app.expo.web.output).toBe('static');
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.trailingSlash).toBe(false);
  });
});
