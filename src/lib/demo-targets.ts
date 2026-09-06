// The screens the marketing site can land a demo visitor on.
//
// jointemple.io sends one of these keys in its `temple-demo-autofill`
// postMessage (FEATURE_DEMO_TARGETS in the marketing repo) and the sign-in
// screen resolves it here. The origin check on that listener is what stops
// anyone but the marketing site from triggering a redirect at all; this
// list is defence in depth on top of it, so even a sender bug cannot land
// a demo sign-in anywhere but a screen chosen for the demo.
//
// A key and an href rather than a set, because a screen can retire while
// the site keeps sending its old key: /management/branding lives in the
// Manage screen's Settings tab now, and the site is a separate repo on its
// own deploy cadence. If you retire a screen, keep its key and repoint the
// href; never drop a row. The marketing repo reads the same list from
// public/demo-targets.json, which scripts/demo-targets.ts generates from
// this file and src/lib/demo-targets.test.ts refuses to let go stale.
export const DEMO_TARGETS: readonly { key: string; href: string }[] = [
  { key: '/book', href: '/book' },
  { key: '/track', href: '/track' },
  { key: '/programming', href: '/programming' },
  { key: '/timeline', href: '/timeline' },
  { key: '/management', href: '/management' },
  { key: '/management/leads', href: '/management/leads' },
  { key: '/management/plans', href: '/management/plans' },
  { key: '/management/billing', href: '/management/billing' },
  { key: '/management/communications', href: '/management/communications' },
  { key: '/management/branding', href: '/management?section=branding' },
];

export function resolveDemoTarget(key: string): string | null {
  return DEMO_TARGETS.find((t) => t.key === key)?.href ?? null;
}

export function demoTargetsJson(): string {
  return JSON.stringify(
    { targets: DEMO_TARGETS.map((t) => ({ key: t.key, href: t.href })) },
    null,
    2,
  ) + '\n';
}
