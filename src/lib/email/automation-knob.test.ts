import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTOMATION_WAIT_DAYS,
  knobToStorage,
  storageToKnob,
} from './automation-knob';

describe('automation wait knob', () => {
  // The bug: setting Wait 0 saved delay_minutes = 0 correctly, but reopening
  // read it back as 3 because `0 || 3` is 3. 0 has to survive the round trip.
  it('round-trips a zero wait for a first-class automation', () => {
    const { delay_minutes, params } = knobToStorage('member_first_class', 0);
    expect(delay_minutes).toBe(0);
    expect(
      storageToKnob({ trigger_type: 'member_first_class', delay_minutes, params }),
    ).toBe(0);
  });

  it('round-trips a zero wait for a member-joined automation', () => {
    const { delay_minutes } = knobToStorage('member_joined', 0);
    expect(delay_minutes).toBe(0);
    expect(
      storageToKnob({ trigger_type: 'member_joined', delay_minutes, params: {} }),
    ).toBe(0);
  });

  it('round-trips a positive wait unchanged', () => {
    for (const days of [1, 2, 3, 7, 30]) {
      const { delay_minutes } = knobToStorage('member_first_class', days);
      expect(delay_minutes).toBe(days * 1440);
      expect(
        storageToKnob({ trigger_type: 'member_first_class', delay_minutes, params: {} }),
      ).toBe(days);
    }
  });

  // A row born with the creation default reads back as that default — not
  // because of a read-time fallback, but because the value is really stored.
  it('shows the creation default for a freshly seeded row', () => {
    expect(
      storageToKnob({
        trigger_type: 'member_joined',
        delay_minutes: DEFAULT_AUTOMATION_WAIT_DAYS * 1440,
        params: {},
      }),
    ).toBe(DEFAULT_AUTOMATION_WAIT_DAYS);
  });

  it('reads the inactive/cold knobs from params, defaulting only when absent', () => {
    expect(
      storageToKnob({ trigger_type: 'member_inactive', delay_minutes: 0, params: { inactive_days: 30 } }),
    ).toBe(30);
    expect(
      storageToKnob({ trigger_type: 'member_inactive', delay_minutes: 0, params: null }),
    ).toBe(21);
    expect(
      storageToKnob({ trigger_type: 'lead_cold', delay_minutes: 0, params: { cold_hours: 48 } }),
    ).toBe(48);
    expect(
      storageToKnob({ trigger_type: 'lead_cold', delay_minutes: 0, params: {} }),
    ).toBe(24);
  });

  it('clamps a negative wait to zero rather than a fake default', () => {
    const { delay_minutes } = knobToStorage('member_first_class', -5);
    expect(delay_minutes).toBe(0);
  });
});
