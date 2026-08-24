import { describe, expect, it } from 'vitest';

import { scheduledChangeEffective, switchDirection } from './plan-change';

// Pins the client to the server's isUpgradeFor: only strictly-greater is
// an upgrade. An equal-price sideways move charging someone today would
// be a bug the confirm copy promised.
describe('switchDirection', () => {
  it('calls a dearer plan an upgrade', () => {
    expect(switchDirection(4500, 6500)).toBe('upgrade');
  });

  it('schedules a cheaper plan', () => {
    expect(switchDirection(6500, 4500)).toBe('scheduled');
  });

  it('schedules an equal-price move', () => {
    expect(switchDirection(4500, 4500)).toBe('scheduled');
  });

  // Nulls coalesce to 0 on both sides, exactly as the server does — a
  // free plan to a priced one is an upgrade, priced to free is not.
  it('treats null as free on either side', () => {
    expect(switchDirection(null, 4500)).toBe('upgrade');
    expect(switchDirection(4500, null)).toBe('scheduled');
    expect(switchDirection(null, null)).toBe('scheduled');
  });
});

describe('scheduledChangeEffective', () => {
  it('lands on the renewal when there is no notice gate', () => {
    expect(scheduledChangeEffective('2026-09-01T00:00:00Z', null)).toEqual({
      kind: 'on',
      date: '2026-09-01T00:00:00Z',
    });
  });

  it('lands on the renewal once it has cleared the gate', () => {
    expect(
      scheduledChangeEffective('2026-09-01T00:00:00Z', '2026-08-20T00:00:00Z'),
    ).toEqual({ kind: 'on', date: '2026-09-01T00:00:00Z' });
  });

  // The boundary is >= — the worker skips only while paid_period_end is
  // strictly before the gate, so a renewal exactly at it applies.
  it('a renewal exactly at the gate applies', () => {
    expect(
      scheduledChangeEffective('2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
    ).toEqual({ kind: 'on', date: '2026-09-01T00:00:00Z' });
  });

  it('defers past the gate while the renewal is inside the notice window', () => {
    expect(
      scheduledChangeEffective('2026-09-01T00:00:00Z', '2026-09-23T00:00:00Z'),
    ).toEqual({ kind: 'after', date: '2026-09-23T00:00:00Z' });
  });

  // No paid_period_end means nothing is renewing on a known date (an
  // imported row, a webhook not yet landed) — say "next renewal", not a
  // date that would be invented.
  it('is unknown without a paid period end', () => {
    expect(scheduledChangeEffective(null, '2026-09-23T00:00:00Z')).toEqual({
      kind: 'unknown',
    });
    expect(scheduledChangeEffective(null, null)).toEqual({ kind: 'unknown' });
  });
});
