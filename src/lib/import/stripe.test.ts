import { describe, expect, it } from 'vitest';

import {
  buildStripeImportRows,
  unixToDateIso,
  type StripeMember,
} from './stripe';

const member = (over: Partial<StripeMember>): StripeMember => ({
  email: 'a@x.test',
  name: 'A',
  subscription_id: 'sub_1',
  customer_id: 'cus_1',
  price_id: 'price_1',
  label: 'Unlimited',
  amount_cents: 5000,
  currency: 'gbp',
  interval: 'month',
  current_period_end: 1893456000, // 2030-01-01 UTC
  status: 'active',
  ...over,
});

describe('unixToDateIso', () => {
  it('formats unix seconds as a UTC date', () => {
    expect(unixToDateIso(1893456000)).toBe('2030-01-01');
  });
  it('returns null for null/invalid', () => {
    expect(unixToDateIso(null)).toBeNull();
    expect(unixToDateIso(Number.NaN)).toBeNull();
  });
});

describe('buildStripeImportRows', () => {
  it('carries the live subscription + customer ids and renewal date', () => {
    const rows = buildStripeImportRows({
      members: [member({})],
      selectedEmails: new Set(['a@x.test']),
      planIdByPriceId: new Map([['price_1', 'plan_1']]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'a@x.test',
      linked_membership_plan_id: 'plan_1',
      imported_stripe_subscription_id: 'sub_1',
      imported_stripe_customer_id: 'cus_1',
      plan_end: '2030-01-01',
      imported_status: 'active',
    });
  });

  it('skips unselected members and prices with no mapped plan', () => {
    const members = [
      member({ email: 'keep@x.test', price_id: 'price_1' }),
      member({ email: 'unsel@x.test', price_id: 'price_1' }),
      member({ email: 'noplan@x.test', price_id: 'price_2', subscription_id: 'sub_2' }),
    ];
    const rows = buildStripeImportRows({
      members,
      selectedEmails: new Set(['keep@x.test', 'noplan@x.test']),
      planIdByPriceId: new Map([['price_1', 'plan_1']]),
    });
    expect(rows.map((r) => r.email)).toEqual(['keep@x.test']);
  });
});
