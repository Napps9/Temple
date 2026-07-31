// Which screens get opened, with no name attached.
//
// The Back Office gave the burndown a baseline and no evidence. Deciding
// what to retire after the obvious first one needs to know what nobody
// opens, and Temple has never counted anything — there is no analytics
// SDK in the app and no usage table in the schema.
//
// What is counted is deliberately the least that answers the question:
// a gym, a route, a day, a number. There is no profile_id, in this module
// or in the table behind it. The two access logs that do exist
// (health_data_access_log, agent_recording_access_log) are per-person
// because they are audit trails and the point of an audit trail is who;
// this is a measure, and the point of a measure is how many. A table that
// cannot answer "who" cannot quietly become a staff surveillance log
// later, whatever anybody decides in a year.
//
// The route is normalised before it leaves the device and again when it
// arrives. Twice, because collapsing `/management/members/<uuid>` to
// `/management/members/[id]` is both the privacy rule and the right
// granularity for the measure — and a client is not a place to enforce a
// privacy rule.

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Long opaque strings are ids too: a Stripe object, a storage key, a
// token that ended up in a path. Nothing a route segment legitimately
// contains is this long.
const OPAQUE = /^[A-Za-z0-9_-]{24,}$/;

export function normaliseRoute(pathname: string): string {
  const [path] = pathname.split(/[?#]/);
  const segments = path.split('/').filter(Boolean);
  const kept = segments.map((s) => {
    if (UUID.test(s)) return '[id]';
    if (/^\d+$/.test(s)) return '[id]';
    if (OPAQUE.test(s)) return '[id]';
    return s.toLowerCase();
  });
  const out = `/${kept.join('/')}`;
  // Cap it. A route is a handful of short segments; anything longer is
  // something that should not be in a path, and the column should not be
  // where we find that out.
  return out.length > 120 ? `${out.slice(0, 119)}…` : out;
}

// Staff surfaces only. The member app is not instrumented — members are
// not what the burndown is about, and counting their screens would be
// collecting something nobody asked a question about.
const STAFF_PREFIXES = [
  '/timeline',
  '/classes',
  '/programming',
  '/analysis',
  '/management',
  '/setup',
];

export function isStaffRoute(pathname: string): boolean {
  const route = normaliseRoute(pathname);
  return STAFF_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`));
}

// True when this open is worth sending: a staff route, and not the same
// one we just sent. The caller holds `last` in a ref rather than state —
// a layout that re-renders on every navigation commit is exactly the
// shape that once dispatched fifty nested navigations here (see the note
// in src/app/(auth)/_layout.tsx), and state would put this hook in that
// same loop.
export function shouldRecord(
  pathname: string,
  last: string | null,
): string | null {
  if (!isStaffRoute(pathname)) return null;
  const route = normaliseRoute(pathname);
  return route === last ? null : route;
}
