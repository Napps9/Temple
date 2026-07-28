// PostgREST returns an embedded resource as an OBJECT when the relationship
// is one-to-one — which it is whenever the child's foreign key is also its
// primary key — and as an ARRAY otherwise. Both plan_subscription_dunning
// (0176) and membership_invoice_links (0174) are declared
// `plan_subscription_id uuid primary key references plan_subscriptions(id)`,
// so both come back as objects.
//
// Reading them with `?.[0]` therefore yields undefined forever, which is
// silent: the failed-payment notice simply never renders and the Pay now
// link is always absent. Nothing catches it — the rows are cast through
// `as unknown as T[]`, and the hand-maintained database.ts carries
// `Relationships: []`, so there is no cardinality information for tsc to
// check against.
//
// This normalises either shape rather than asserting which one arrives.
// The alternative is being right about PostgREST's constraint inspection
// for every embed in the app, forever, with no test that would tell us
// otherwise — vitest never goes through PostgREST and pgTAP is SQL only.
export type Embedded<T> = T | T[] | null;

export function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
