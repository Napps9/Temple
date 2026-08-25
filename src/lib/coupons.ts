export type CouponPreview = {
  coupon_id: string;
  code: string;
  name: string | null;
  discount_kind: 'percent' | 'amount';
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string | null;
  duration: 'once' | 'repeating';
  duration_in_months: number | null;
  discounted_first_cents: number | null;
  reason: string | null;
};

// Codes are typed by people, off posters and out of emails. Case and
// stray spaces are not what the owner meant to be strict about.
export function normaliseCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

// Display only. What is charged is Stripe's arithmetic on the coupon it
// holds, and preview_plan_coupon computes the same figure server-side —
// this exists so the price under the field updates as they type. Floor,
// matching the SQL, so the two never disagree by a penny.
export function applyDiscount(
  priceCents: number,
  coupon: Pick<
    CouponPreview,
    'discount_kind' | 'percent_off' | 'amount_off_cents'
  >,
): number {
  if (coupon.discount_kind === 'percent') {
    const pct = coupon.percent_off ?? 0;
    return Math.max(0, Math.floor((priceCents * (100 - pct)) / 100));
  }
  return Math.max(0, priceCents - (coupon.amount_off_cents ?? 0));
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

// "20% off for 3 months", "£15 off your first month".
export function couponLabel(coupon: CouponPreview, currency = 'GBP'): string {
  const amount =
    coupon.discount_kind === 'percent'
      ? `${Number(coupon.percent_off ?? 0)}% off`
      : `${money(coupon.amount_off_cents ?? 0, coupon.currency ?? currency)} off`;
  if (coupon.duration === 'repeating') {
    const n = coupon.duration_in_months ?? 1;
    return `${amount} for ${n} ${n === 1 ? 'month' : 'months'}`;
  }
  return `${amount} your first month`;
}

export function couponWindowLabel(validUntil: string | null): string {
  if (!validUntil) return 'No end date';
  const end = new Date(validUntil);
  const label = end.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return end.getTime() < Date.now() ? `Ended ${label}` : `Until ${label}`;
}
