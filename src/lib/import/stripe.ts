// Pure helpers for the Stripe member import. The edge function
// (stripe-import) returns the preview shape below; the review screen turns
// the owner's selections into rows for the import_pending_members RPC,
// carrying the live Stripe subscription + customer ids so the imported
// subscription is adopted (not re-billed) — see migration 0089.

export type StripePrice = {
  price_id: string;
  label: string;
  amount_cents: number;
  currency: string;
  interval: string | null;
  count: number;
};

export type StripeMember = {
  email: string;
  name: string | null;
  subscription_id: string;
  customer_id: string | null;
  price_id: string;
  label: string;
  amount_cents: number;
  currency: string;
  interval: string | null;
  current_period_end: number | null;
  status: string;
};

export type StripePreview = {
  prices: StripePrice[];
  members: StripeMember[];
  skipped_no_email: number;
};

// Stripe gives unix-seconds; pending_members.plan_end is a date.
export function unixToDateIso(unix: number | null): string | null {
  if (unix == null || !Number.isFinite(unix)) return null;
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

export type StripeImportRow = {
  email: string;
  full_name: string;
  plan_name: string;
  linked_membership_plan_id: string;
  plan_end: string | null;
  imported_status: string;
  imported_stripe_subscription_id: string;
  imported_stripe_customer_id: string | null;
  tags: string[];
  unsubscribed: boolean;
};

// Build the import_pending_members rows for the members the owner kept,
// whose price maps to a (created or existing) Temple plan.
export function buildStripeImportRows(args: {
  members: StripeMember[];
  selectedEmails: Set<string>;
  // price_id -> the Temple plan id it was mapped to.
  planIdByPriceId: Map<string, string>;
}): StripeImportRow[] {
  const out: StripeImportRow[] = [];
  for (const m of args.members) {
    if (!args.selectedEmails.has(m.email)) continue;
    const planId = args.planIdByPriceId.get(m.price_id);
    if (!planId) continue;
    out.push({
      email: m.email,
      full_name: m.name ?? '',
      plan_name: m.label,
      linked_membership_plan_id: planId,
      plan_end: unixToDateIso(m.current_period_end),
      imported_status: m.status,
      imported_stripe_subscription_id: m.subscription_id,
      imported_stripe_customer_id: m.customer_id,
      tags: [],
      unsubscribed: false,
    });
  }
  return out;
}
