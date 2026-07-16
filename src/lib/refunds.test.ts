import { describe, expect, it } from 'vitest';
import {
  computeRefund,
  proRataCents,
  unusedFraction,
  type RefundableEntitlement,
} from './refunds';

const pack = (remaining: number, total: number): RefundableEntitlement => ({
  planKind: 'credit_pack',
  chargeCents: 1000,
  creditsTotal: total,
  creditsRemaining: remaining,
});

const monthly = (
  start: string,
  end: string,
  charge = 12000,
): RefundableEntitlement => ({
  planKind: 'unlimited',
  chargeCents: charge,
  periodStart: start,
  periodEnd: end,
});

describe('unusedFraction', () => {
  it('is credits-remaining / total for packs', () => {
    expect(unusedFraction(pack(3, 10), '2026-01-01')).toBeCloseTo(0.3);
    expect(unusedFraction(pack(10, 10), '2026-01-01')).toBe(1);
    expect(unusedFraction(pack(0, 10), '2026-01-01')).toBe(0);
  });

  it('is days-remaining / period for time-based plans', () => {
    // Halfway through a 10-day period.
    const f = unusedFraction(
      monthly('2026-01-01T00:00:00Z', '2026-01-11T00:00:00Z'),
      '2026-01-06T00:00:00Z',
    );
    expect(f).toBeCloseTo(0.5);
  });

  it('returns 0 past the period end, 1 before it starts (clamped)', () => {
    const ent = monthly('2026-01-01T00:00:00Z', '2026-01-11T00:00:00Z');
    expect(unusedFraction(ent, '2026-02-01T00:00:00Z')).toBe(0);
    expect(unusedFraction(ent, '2025-12-01T00:00:00Z')).toBe(1);
  });

  it('falls back to 0 when bounds are missing or degenerate', () => {
    expect(unusedFraction({ planKind: 'unlimited', chargeCents: 100 }, 'x')).toBe(0);
    expect(
      unusedFraction(pack(5, 0), '2026-01-01'), // zero total
    ).toBe(0);
  });
});

describe('proRataCents', () => {
  it('refunds the unused slice, rounded, never over the charge', () => {
    expect(proRataCents(pack(3, 10), '2026-01-01')).toBe(300);
    expect(proRataCents(pack(1, 3), '2026-01-01')).toBe(333); // 1000/3 rounded
    expect(proRataCents(pack(10, 10), '2026-01-01')).toBe(1000);
    expect(proRataCents(pack(0, 10), '2026-01-01')).toBe(0);
  });
});

describe('computeRefund', () => {
  const now = '2026-01-06T00:00:00Z';

  it('prorata_revoke: unused slice, cut now, stop renewals, zero credits', () => {
    expect(computeRefund(pack(3, 10), 'prorata_revoke', now)).toEqual({
      refundCents: 300,
      access: 'revoke_now',
      cancelRenewals: true,
      zeroCredits: true,
    });
  });

  it('full_revoke: full charge, cut now', () => {
    expect(computeRefund(pack(3, 10), 'full_revoke', now)).toEqual({
      refundCents: 1000,
      access: 'revoke_now',
      cancelRenewals: true,
      zeroCredits: true,
    });
  });

  it('full_period_end: full charge, access to period end, keep credits', () => {
    expect(computeRefund(pack(3, 10), 'full_period_end', now)).toEqual({
      refundCents: 1000,
      access: 'until_period_end',
      cancelRenewals: true,
      zeroCredits: false,
    });
  });

  it('keep: full by default, nothing else changes', () => {
    expect(computeRefund(pack(3, 10), 'keep', now)).toEqual({
      refundCents: 1000,
      access: 'unchanged',
      cancelRenewals: false,
      zeroCredits: false,
    });
  });

  it('keep: honours a custom amount, clamped to the charge', () => {
    expect(computeRefund(pack(3, 10), 'keep', now, 250).refundCents).toBe(250);
    expect(computeRefund(pack(3, 10), 'keep', now, 99999).refundCents).toBe(1000);
    expect(computeRefund(pack(3, 10), 'keep', now, -5).refundCents).toBe(0);
  });

  it('time-based prorata_revoke halfway through refunds half', () => {
    const r = computeRefund(
      monthly('2026-01-01T00:00:00Z', '2026-01-11T00:00:00Z'),
      'prorata_revoke',
      now,
    );
    expect(r.refundCents).toBe(6000);
    expect(r.access).toBe('revoke_now');
  });
});
