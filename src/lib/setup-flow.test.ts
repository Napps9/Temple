import { describe, expect, it } from 'vitest';

import {
  CLASS_TYPE_PALETTE,
  customRuleValue,
  DEFAULT_RULE_CHOICES,
  fieldLabel,
  isLateCancel,
  lateCancelLabel,
  formatDays,
  formatPrice,
  mergeRuleAnswers,
  nextRuleQuestion,
  RULE_FIELD_OPTIONS,
  RULE_QUESTIONS,
  ruleSentence,
  ruleSentences,
  ruleSheet,
  sanitisePlans,
  sanitiseTimetable,
  timetableSummary,
  unitsFor,
  type RuleField,
} from './setup-flow';

describe('sanitiseTimetable', () => {
  const good = {
    schedules: [
      {
        class_type: 'CrossFit',
        days: [1, 2, 3, 4, 5],
        times: ['06:00', '07:00', '09:30', '18:00'],
        duration_minutes: 60,
        capacity: 16,
      },
      {
        class_type: 'CrossFit',
        days: [6],
        times: ['09:00'],
        duration_minutes: 60,
        capacity: 16,
      },
    ],
  };

  it('accepts a clean proposal and derives the class-type list', () => {
    const p = sanitiseTimetable(good);
    expect(p).not.toBeNull();
    expect(p!.class_types).toEqual([
      { name: 'CrossFit', color: CLASS_TYPE_PALETTE[0] },
    ]);
    expect(p!.schedules).toHaveLength(2);
  });

  it('dedupes class-type names case-insensitively', () => {
    const p = sanitiseTimetable({
      schedules: [
        { ...good.schedules[0], class_type: 'crossfit' },
        { ...good.schedules[1], class_type: 'CrossFit' },
      ],
    });
    expect(p!.class_types).toHaveLength(1);
  });

  it('drops schedules with no valid days or times, and rejects an empty result', () => {
    expect(
      sanitiseTimetable({
        schedules: [
          { class_type: 'X', days: [9], times: ['06:00'], duration_minutes: 60, capacity: 10 },
          { class_type: 'Y', days: [1], times: ['25:99'], duration_minutes: 60, capacity: 10 },
        ],
      }),
    ).toBeNull();
  });

  it('normalises and bounds times, days, duration and capacity', () => {
    const p = sanitiseTimetable({
      schedules: [
        {
          class_type: 'Barbell',
          days: [5, 1, 1, 3],
          times: ['6:00', '06:00', '23:59', 'noon'],
          duration_minutes: 999,
          capacity: -3,
        },
      ],
    });
    const s = p!.schedules[0];
    expect(s.days).toEqual([1, 3, 5]);
    expect(s.times).toEqual(['06:00']);
    expect(s.duration_minutes).toBe(60);
    expect(s.capacity).toBe(16);
  });

  it('rejects non-objects and missing schedules', () => {
    expect(sanitiseTimetable(null)).toBeNull();
    expect(sanitiseTimetable('week')).toBeNull();
    expect(sanitiseTimetable({})).toBeNull();
  });
});

describe('sanitisePlans', () => {
  it('accepts a clean set and defaults kind to unlimited', () => {
    const p = sanitisePlans({
      plans: [
        { name: 'Unlimited', kind: 'unlimited', monthly_price_cents: 8900, credit_count: null, blurb: 'every class' },
        { name: '8 classes', kind: 'credit_period', monthly_price_cents: 5900, credit_count: 8, blurb: 'a month' },
      ],
    });
    expect(p!.plans).toHaveLength(2);
    expect(p!.plans[1].credit_count).toBe(8);
  });

  it('drops a recurring plan with no price rather than selling it free', () => {
    const p = sanitisePlans({
      plans: [
        { name: 'Unlimited', kind: 'unlimited', monthly_price_cents: null },
        { name: 'Student', kind: 'unlimited', monthly_price_cents: 4500 },
      ],
    });
    expect(p!.plans.map((x) => x.name)).toEqual(['Student']);
  });

  it('parses notice periods and requires a price on packs too', () => {
    const p = sanitisePlans({
      plans: [
        { name: 'Unlimited', kind: 'unlimited', monthly_price_cents: 8900, notice_period_days: 30 },
        { name: '10-pack', kind: 'credit_pack', monthly_price_cents: null, credit_count: 10 },
        { name: '5-pack', kind: 'credit_pack', monthly_price_cents: 6000, credit_count: 5 },
      ],
    });
    expect(p!.plans.map((x) => x.name)).toEqual(['Unlimited', '5-pack']);
    expect(p!.plans[0].notice_period_days).toBe(30);
    expect(p!.plans[1].notice_period_days).toBeNull();
  });

  it('dedupes names and rejects an all-invalid set', () => {
    expect(
      sanitisePlans({ plans: [{ name: 'X', kind: 'unlimited', monthly_price_cents: null }] }),
    ).toBeNull();
    const p = sanitisePlans({
      plans: [
        { name: 'Unlimited', kind: 'unlimited', monthly_price_cents: 8900 },
        { name: 'unlimited', kind: 'unlimited', monthly_price_cents: 9900 },
      ],
    });
    expect(p!.plans).toHaveLength(1);
  });
});

describe('summaries and formatting', () => {
  it('counts classes per week and notices a shared cap', () => {
    const p = sanitiseTimetable({
      schedules: [
        { class_type: 'CrossFit', days: [1, 2, 3, 4, 5], times: ['06:00', '07:00', '09:30', '18:00'], duration_minutes: 60, capacity: 16 },
        { class_type: 'CrossFit', days: [6], times: ['09:00'], duration_minutes: 60, capacity: 16 },
      ],
    })!;
    expect(timetableSummary(p)).toBe('21 classes a week, all capped at 16.');
  });

  it('formats prices in whole pounds when possible', () => {
    expect(formatPrice(8900)).toBe('£89');
    expect(formatPrice(8950)).toBe('£89.50');
    expect(formatPrice(null)).toBe('');
  });

  it('collapses contiguous day runs', () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(formatDays([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
    expect(formatDays([6])).toBe('Sat');
    expect(formatDays([0, 3])).toBe('Sun, Wed');
  });
});

describe('rule questions and the rule sheet', () => {
  it('offers the best practice as the first option of every question', () => {
    for (const q of RULE_QUESTIONS) {
      expect(mergeRuleAnswers({})[q.id]).toEqual(q.options[0].value);
    }
  });

  it('makes every field default the first option of its token picker', () => {
    for (const field of Object.keys(RULE_FIELD_OPTIONS) as RuleField[]) {
      expect(DEFAULT_RULE_CHOICES[field]).toEqual(
        RULE_FIELD_OPTIONS[field][0].value,
      );
    }
  });

  it('merges partial answers over the defaults', () => {
    const c = mergeRuleAnswers({ late_cancel: 'never', week_starts_on: 'sun' });
    expect(c.late_cancel).toBe('never');
    expect(c.week_starts_on).toBe('sun');
    expect(c.booking_window_hours_ahead).toBe(168);
  });

  it('covers every choice field with exactly one sheet token', () => {
    const tokens = ruleSheet(DEFAULT_RULE_CHOICES)
      .flatMap((g) => g.lines)
      .flatMap((l) => l.parts)
      .filter((p): p is { f: RuleField } => 'f' in p)
      .map((p) => p.f);
    expect([...tokens].sort()).toEqual(
      (Object.keys(RULE_FIELD_OPTIONS) as RuleField[]).sort(),
    );
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('speaks each choice as a plain sentence', () => {
    const lines = ruleSentences(DEFAULT_RULE_CHOICES);
    expect(lines).toContain('Classes can be booked 7 days ahead');
    expect(lines).toContain('Cancelling costs the credit from 9pm the night before');
    expect(lines).toContain('People need a membership to book');
    expect(lines).toContain('Health data is deleted 3 months after someone leaves');
    const open = mergeRuleAnswers({
      booking_window_hours_ahead: null,
      late_cancel: 'never',
      require_membership_to_book: false,
    });
    const openLines = ruleSentences(open);
    expect(openLines).toContain('Classes can be booked with no limit');
    expect(openLines).toContain('Cancelling never costs the credit');
    expect(openLines).toContain('People can book without a membership');
    expect(
      ruleSentences(mergeRuleAnswers({ booking_window_hours_ahead: 336 })),
    ).toContain('Classes can be booked 2 weeks ahead');
  });

  it('reads a single rule back as its own sheet sentence', () => {
    expect(ruleSentence('late_cancel', DEFAULT_RULE_CHOICES)).toBe(
      'Cancelling costs the credit from 9pm the night before',
    );
    expect(
      ruleSentence(
        'booking_window_hours_ahead',
        mergeRuleAnswers({ booking_window_hours_ahead: 336 }),
      ),
    ).toBe('Classes can be booked 2 weeks ahead');
  });

  it('resumes at the first question still unanswered, not the next in line', () => {
    expect(nextRuleQuestion({})).toBe(0);
    // A typed sentence can settle a later question first; the run must
    // still come back for the ones it skipped over.
    expect(nextRuleQuestion({ week_starts_on: 'sun' })).toBe(0);
    expect(
      nextRuleQuestion({
        booking_window_hours_ahead: 336,
        late_cancel: 'rel:120',
      }),
    ).toBe(2);
    const all = Object.fromEntries(
      RULE_QUESTIONS.map((q) => [q.id, DEFAULT_RULE_CHOICES[q.id]]),
    );
    expect(nextRuleQuestion(all)).toBeNull();
  });

  it('speaks a cancel rule the presets never offered', () => {
    expect(lateCancelLabel('rel:30')).toBe('from 30 minutes before');
    expect(lateCancelLabel('rel:60')).toBe('from an hour before');
    expect(lateCancelLabel('rel:90')).toBe('from 1 hour 30 minutes before');
    expect(lateCancelLabel('rel:720')).toBe('from 12 hours before');
    expect(lateCancelLabel('abs:22:00')).toBe('from 10pm the night before');
    expect(lateCancelLabel('abs:21:30')).toBe('from 9:30pm the night before');
    expect(lateCancelLabel('abs:00:00')).toBe('from 12am the night before');
    expect(lateCancelLabel('never')).toBe('never');
  });

  it('accepts only cancel values the class-type columns can hold', () => {
    expect(isLateCancel('rel:30')).toBe(true);
    expect(isLateCancel('abs:21:00')).toBe(true);
    expect(isLateCancel('never')).toBe(true);
    expect(isLateCancel('rel:0')).toBe(false);
    expect(isLateCancel('abs:24:00')).toBe(false);
    expect(isLateCancel('abs:21:60')).toBe(false);
    expect(isLateCancel('two_hours')).toBe(false);
    expect(isLateCancel(120)).toBe(false);
  });

  it('builds a custom value in the units the owner would say it in', () => {
    const days = unitsFor('booking_window_hours_ahead')![0];
    expect(customRuleValue('booking_window_hours_ahead', 22, days)).toBe(528);
    const weeks = unitsFor('booking_window_hours_ahead')![1];
    expect(customRuleValue('booking_window_hours_ahead', 4, weeks)).toBe(672);
    const mins = unitsFor('booking_cutoff_minutes_before')![0];
    expect(customRuleValue('booking_cutoff_minutes_before', 45, mins)).toBe(45);
  });

  it('refuses a custom value the column could not hold, rather than clamping', () => {
    const days = unitsFor('booking_window_hours_ahead')![0];
    // The window tops out at 2160 hours; 200 days is 4800.
    expect(customRuleValue('booking_window_hours_ahead', 200, days)).toBeNull();
    expect(customRuleValue('booking_window_hours_ahead', 0, days)).toBeNull();
    expect(customRuleValue('booking_window_hours_ahead', NaN, days)).toBeNull();
  });

  it('builds both shapes of a custom cancel rule', () => {
    const [hours, minutes, night] = unitsFor('late_cancel')!;
    expect(customRuleValue('late_cancel', 3, hours)).toBe('rel:180');
    expect(customRuleValue('late_cancel', 30, minutes)).toBe('rel:30');
    expect(customRuleValue('late_cancel', 22, night)).toBe('abs:22:00');
    expect(customRuleValue('late_cancel', 24, night)).toBeNull();
    expect(customRuleValue('late_cancel', 0, minutes)).toBeNull();
  });

  it('labels the current value of a field', () => {
    expect(fieldLabel('weight_unit', DEFAULT_RULE_CHOICES)).toBe('kilograms');
    expect(
      fieldLabel('dm_scope', mergeRuleAnswers({ dm_scope: 'member_coach_only' })),
    ).toBe('coaches and staff only');
  });
});
