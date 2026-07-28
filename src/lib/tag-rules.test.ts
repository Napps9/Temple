import { describe, expect, it } from 'vitest';

import { describeTagRule, TAG_RULE_KINDS, tagRuleKindMeta } from './tag-rules';

describe('TAG_RULE_KINDS', () => {
  it('ties config requirements to the kinds the SQL CHECK expects', () => {
    const needsClassType = TAG_RULE_KINDS.filter((k) => k.needsClassType).map(
      (k) => k.value,
    );
    const needsPlan = TAG_RULE_KINDS.filter((k) => k.needsPlan).map((k) => k.value);
    const needsThreshold = TAG_RULE_KINDS.filter(
      (k) => k.thresholdUse === 'required',
    ).map((k) => k.value);
    expect(needsClassType).toEqual(['booked_class_type', 'attended_class_type']);
    expect(needsPlan).toEqual(['on_plan']);
    expect(needsThreshold).toEqual(['no_recent_attendance', 'joined_within']);
  });

  it('gives every required-threshold kind a default so the editor never seeds blank', () => {
    for (const k of TAG_RULE_KINDS) {
      if (k.thresholdUse === 'required') {
        expect(k.thresholdDefault, k.value).toBeTruthy();
      }
    }
  });
});

describe('describeTagRule', () => {
  it('describes class-type rules with the window and the future-booking caveat', () => {
    expect(
      describeTagRule(
        { predicate_kind: 'booked_class_type', threshold_days: 30, active: true },
        { classTypeName: 'Intro' },
      ),
    ).toBe('Booked Intro in the last 30 days or upcoming');
    expect(
      describeTagRule(
        { predicate_kind: 'booked_class_type', threshold_days: null, active: true },
        { classTypeName: 'Intro' },
      ),
    ).toBe('Booked Intro');
    expect(
      describeTagRule(
        { predicate_kind: 'attended_class_type', threshold_days: 1, active: true },
        { classTypeName: 'Yoga' },
      ),
    ).toBe('Attended Yoga in the last 1 day');
  });

  it('describes membership rules', () => {
    expect(
      describeTagRule(
        { predicate_kind: 'on_plan', threshold_days: null, active: true },
        { planName: 'Unlimited' },
      ),
    ).toBe('On Unlimited');
    expect(
      describeTagRule({ predicate_kind: 'cancelling', threshold_days: null, active: true }),
    ).toBe('Cancelling');
    expect(
      describeTagRule({ predicate_kind: 'joined_within', threshold_days: 7, active: true }),
    ).toBe('Joined in the last 7 days');
    expect(
      describeTagRule({
        predicate_kind: 'no_recent_attendance',
        threshold_days: 30,
        active: true,
      }),
    ).toBe('No check-ins for 30 days');
  });

  it('falls back to placeholders while name lookups load, and marks paused rules', () => {
    expect(
      describeTagRule({ predicate_kind: 'on_plan', threshold_days: null, active: true }),
    ).toBe('On a plan');
    expect(
      describeTagRule({ predicate_kind: 'intro', threshold_days: null, active: false }),
    ).toBe('Intro · paused');
    expect(
      describeTagRule({ predicate_kind: 'expiring_soon', threshold_days: null, active: true }),
    ).toBe('Expiring within 7 days');
  });

  it('has a label for every kind', () => {
    for (const k of TAG_RULE_KINDS) {
      expect(tagRuleKindMeta(k.value).label).toBeTruthy();
      expect(
        describeTagRule({ predicate_kind: k.value, threshold_days: null, active: true }),
      ).toBeTruthy();
    }
  });
});
