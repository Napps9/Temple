// Refund maths for the owner-initiated refund flow. Pure + dependency-free
// so it unit-tests cleanly and can be mirrored by the edge function that
// actually moves the money (the server recomputes — the client preview is
// never trusted for the amount).
//
// Four modes an owner picks from when refunding a member's payment:
//   prorata_revoke  — refund the unused slice, cut access now, stop renewals
//   full_period_end — full refund, keep access to the paid period end, stop
//                     renewals
//   full_revoke     — full refund, cut access now, stop renewals
//   keep            — refund (full or a custom amount), leave access and
//                     renewals untouched (goodwill)

export type RefundMode =
  | 'prorata_revoke'
  | 'full_period_end'
  | 'full_revoke'
  | 'keep';

export type PlanKind = 'unlimited' | 'credit_period' | 'credit_pack';

export type RefundableEntitlement = {
  planKind: PlanKind;
  // The payment being refunded, in minor units (pence).
  chargeCents: number;
  // Time-based plans (unlimited / credit_period): the paid window. ISO 8601.
  periodStart?: string | null;
  periodEnd?: string | null;
  // Credit-based plans (credit_pack / credit_period): the pack size and
  // what's left of it.
  creditsTotal?: number | null;
  creditsRemaining?: number | null;
};

// What the refund does to the member's access, for the caller (edge
// function / RPC) to apply. `access` maps to the resulting plan_sub_state:
//   revoke_now       -> 'cancelled'  (+ zeroCredits, cancelled_at = now)
//   until_period_end -> 'cancelled_at_period_end'
//   unchanged        -> 'refunded_retained'
export type RefundOutcome = {
  refundCents: number;
  access: 'revoke_now' | 'until_period_end' | 'unchanged';
  cancelRenewals: boolean;
  zeroCredits: boolean;
};

function clampCents(n: number, max: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const rounded = Math.round(n);
  return rounded > max ? max : rounded;
}

// The unused fraction of what was paid, 0..1. Credit-based plans go by
// sessions left; time-based plans by days (well, milliseconds) left in the
// paid period. Anything we can't compute (missing bounds, zero-length
// period) falls back to 0 — a pro-rata refund of nothing rather than an
// accidental full one.
export function unusedFraction(
  ent: RefundableEntitlement,
  now: string,
): number {
  if (ent.planKind === 'credit_pack' || ent.planKind === 'credit_period') {
    const total = ent.creditsTotal ?? 0;
    const remaining = ent.creditsRemaining ?? 0;
    if (total <= 0 || remaining <= 0) return 0;
    return Math.min(1, remaining / total);
  }
  // unlimited (time-based)
  const start = ent.periodStart ? Date.parse(ent.periodStart) : NaN;
  const end = ent.periodEnd ? Date.parse(ent.periodEnd) : NaN;
  const t = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(t)) {
    return 0;
  }
  const span = end - start;
  if (span <= 0) return 0;
  const remaining = end - t;
  if (remaining <= 0) return 0;
  return Math.min(1, remaining / span);
}

export function proRataCents(ent: RefundableEntitlement, now: string): number {
  return clampCents(ent.chargeCents * unusedFraction(ent, now), ent.chargeCents);
}

// The full outcome for a chosen mode. `customCents` only applies to `keep`
// (a goodwill amount the owner typed); the other three compute their own.
export function computeRefund(
  ent: RefundableEntitlement,
  mode: RefundMode,
  now: string,
  customCents?: number | null,
): RefundOutcome {
  const full = clampCents(ent.chargeCents, ent.chargeCents);
  switch (mode) {
    case 'prorata_revoke':
      return {
        refundCents: proRataCents(ent, now),
        access: 'revoke_now',
        cancelRenewals: true,
        zeroCredits: true,
      };
    case 'full_revoke':
      return {
        refundCents: full,
        access: 'revoke_now',
        cancelRenewals: true,
        zeroCredits: true,
      };
    case 'full_period_end':
      return {
        refundCents: full,
        access: 'until_period_end',
        cancelRenewals: true,
        zeroCredits: false,
      };
    case 'keep':
      return {
        refundCents:
          customCents != null ? clampCents(customCents, full) : full,
        access: 'unchanged',
        cancelRenewals: false,
        zeroCredits: false,
      };
  }
}
