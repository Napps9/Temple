import { describe, expect, it } from 'vitest';

import {
  applyDiscount,
  couponLabel,
  couponWindowLabel,
  normaliseCode,
  type CouponPreview,
} from './coupons';

function coupon(partial: Partial<CouponPreview>): CouponPreview {
  return {
    coupon_id: 'c1',
    code: 'JAN50',
    name: null,
    discount_kind: 'percent',
    percent_off: 50,
    amount_off_cents: null,
    currency: null,
    duration: 'once',
    duration_in_months: null,
    discounted_first_cents: null,
    reason: null,
    ...partial,
  };
}

describe('normaliseCode', () => {
  it('upper-cases and strips spaces', () => {
    expect(normaliseCode('  jan 50 ')).toBe('JAN50');
  });
});

describe('applyDiscount', () => {
  it('takes a percentage off', () => {
    expect(applyDiscount(6000, coupon({ percent_off: 50 }))).toBe(3000);
  });

  // Floors, because the SQL floors. A penny of disagreement between the
  // price on screen and the price on the invoice is the whole problem
  // this arrangement exists to avoid.
  it('floors a percentage that does not divide evenly', () => {
    // Checked against the SQL: floor(5999 * (100 - 33.33) / 100) = 3999.
    expect(applyDiscount(5999, coupon({ percent_off: 33.33 }))).toBe(3999);
  });

  it('takes a fixed amount off', () => {
    expect(
      applyDiscount(
        6000,
        coupon({
          discount_kind: 'amount',
          percent_off: null,
          amount_off_cents: 1500,
        }),
      ),
    ).toBe(4500);
  });

  it('never goes below zero', () => {
    expect(
      applyDiscount(
        1000,
        coupon({
          discount_kind: 'amount',
          percent_off: null,
          amount_off_cents: 5000,
        }),
      ),
    ).toBe(0);
    expect(applyDiscount(6000, coupon({ percent_off: 100 }))).toBe(0);
  });
});

describe('couponLabel', () => {
  it('names a one-off percentage', () => {
    expect(couponLabel(coupon({}))).toBe('50% off your first month');
  });

  it('names a repeating percentage', () => {
    expect(
      couponLabel(coupon({ duration: 'repeating', duration_in_months: 3 })),
    ).toBe('50% off for 3 months');
  });

  it('says month, not months, for one', () => {
    expect(
      couponLabel(coupon({ duration: 'repeating', duration_in_months: 1 })),
    ).toBe('50% off for 1 month');
  });

  it('names a fixed amount', () => {
    expect(
      couponLabel(
        coupon({
          discount_kind: 'amount',
          percent_off: null,
          amount_off_cents: 1500,
          currency: 'GBP',
        }),
      ),
    ).toBe('£15 off your first month');
  });
});

describe('couponWindowLabel', () => {
  it('says so when there is no end', () => {
    expect(couponWindowLabel(null)).toBe('No end date');
  });

  it('reads a past window in the past tense', () => {
    expect(couponWindowLabel('2020-01-05T00:00:00Z')).toMatch(/^Ended /);
  });

  it('reads a future window as a deadline', () => {
    expect(couponWindowLabel('2099-01-05T00:00:00Z')).toMatch(/^Until /);
  });
});
