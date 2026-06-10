import { describe, expect, it } from 'vitest';

import {
  BODY_REGIONS,
  daysAgo,
  injuryTitle,
  isCheckInDue,
  painColour,
  regionLabel,
} from './injuries';

describe('painColour', () => {
  it('maps the scale ends', () => {
    expect(painColour(0)).toBe('#10B981');
    expect(painColour(10)).toBe('#EF4444');
  });

  it('clamps out-of-range input', () => {
    expect(painColour(-5)).toBe(painColour(0));
    expect(painColour(99)).toBe(painColour(10));
  });

  it('steps through amber in the middle', () => {
    expect(painColour(3)).toBe('#F59E0B');
    expect(painColour(5)).toBe('#F97316');
  });
});

describe('isCheckInDue', () => {
  const now = new Date('2026-06-10T12:00:00Z');

  it('is due after seven days on an unresolved injury', () => {
    expect(isCheckInDue('2026-06-03T11:00:00Z', 'active', now)).toBe(true);
    expect(isCheckInDue('2026-06-01T00:00:00Z', 'improving', now)).toBe(true);
  });

  it('is not due within the interval', () => {
    expect(isCheckInDue('2026-06-08T12:00:00Z', 'active', now)).toBe(false);
  });

  it('is never due for resolved injuries', () => {
    expect(isCheckInDue('2026-01-01T00:00:00Z', 'resolved', now)).toBe(false);
  });

  it('ignores junk timestamps', () => {
    expect(isCheckInDue('not-a-date', 'active', now)).toBe(false);
  });
});

describe('region catalog', () => {
  it('has unique keys and every region appears on at least one view', () => {
    const keys = BODY_REGIONS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of BODY_REGIONS) expect(r.views.length).toBeGreaterThan(0);
  });

  it('labels known regions and falls back to the key', () => {
    expect(regionLabel('knee')).toBe('Knee');
    expect(regionLabel('mystery')).toBe('mystery');
  });

  it('builds titles with and without a side', () => {
    expect(injuryTitle('knee', 'left')).toBe('Left knee');
    expect(injuryTitle('lower_back', 'na')).toBe('Lower back');
  });
});

describe('daysAgo', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  it('floors whole days', () => {
    expect(daysAgo('2026-06-09T13:00:00Z', now)).toBe(0);
    expect(daysAgo('2026-06-03T11:00:00Z', now)).toBe(7);
  });
});
