// Pure math for cancellation notice rounding.
//
// Both access end and Stripe cancel_at round up to the end of the
// billing period in which the notice expires — whole periods only,
// no mid-period overcharge. See plan §3.1 and docs/entitlement-states.md.
//
// This module mirrors compute_cancellation_period_end in 0020.
// Keep them in lockstep so the cancel UI's "access through {date}"
// preview matches what the RPC actually writes.

export type Interval = {
  months?: number;
  days?: number;
  seconds?: number;
};

/**
 * Add a structured interval to a Date. Months are applied via
 * Date.setMonth (handles variable month length); days via setDate;
 * seconds via setTime.
 */
export function addInterval(date: Date, i: Interval): Date {
  const r = new Date(date.getTime());
  if (i.months) r.setMonth(r.getMonth() + i.months);
  if (i.days) r.setDate(r.getDate() + i.days);
  if (i.seconds) r.setTime(r.getTime() + i.seconds * 1000);
  return r;
}

/** True if the interval has any non-zero component. */
export function intervalIsZero(i: Interval): boolean {
  return !i.months && !i.days && !i.seconds;
}

/**
 * Compute the new paid_period_end for a cancellation with notice.
 *
 * - When notice_period is zero or notice expires within the current
 *   paid period, returns paidPeriodEnd unchanged: the prepaid period
 *   covers the access tail.
 * - When notice extends past the current period, advances by
 *   billingInterval until the new end covers notice_expires.
 * - When billingInterval or paidPeriodEnd is unknown (e.g. a sub that
 *   never billed), falls back to now + notice — best effort; Stripe
 *   remains source of truth for the actual cancel_at.
 */
export function computePaidPeriodEnd(params: {
  now: Date;
  paidPeriodEnd: Date | null;
  billingInterval: Interval | null;
  noticePeriod: Interval;
}): Date {
  const noticeExpires = addInterval(params.now, params.noticePeriod);

  if (!params.paidPeriodEnd || !params.billingInterval) {
    return noticeExpires;
  }

  if (intervalIsZero(params.billingInterval)) {
    // Defensive: prevent infinite loop if a caller passes {} as billingInterval.
    return params.paidPeriodEnd > noticeExpires
      ? params.paidPeriodEnd
      : noticeExpires;
  }

  let end = new Date(params.paidPeriodEnd.getTime());
  // Hard cap on iterations so a malformed interval can't hang.
  for (let i = 0; i < 120 && end < noticeExpires; i++) {
    end = addInterval(end, params.billingInterval);
  }
  return end;
}
