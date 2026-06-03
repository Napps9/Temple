import { describe, expect, it } from 'vitest';

import { evaluateAudience, type MemberContext, type Predicate } from './audience-engine';

function ctx(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    planStatus: 'active',
    tags: [],
    hasEverPaid: true,
    daysSinceSignup: 30,
    lastBookedAt: null,
    now: new Date('2024-06-01T00:00:00Z'),
    ...overrides,
  };
}

describe('evaluateAudience — plan_status', () => {
  it('eq matches exactly', () => {
    const pred: Predicate = { clauses: [{ field: 'plan_status', op: 'eq', value: 'active' }] };
    expect(evaluateAudience(pred, ctx())).toBe(true);
    expect(evaluateAudience(pred, ctx({ planStatus: 'paused' }))).toBe(false);
  });

  it('in matches any', () => {
    const pred: Predicate = {
      clauses: [{ field: 'plan_status', op: 'in', value: ['active', 'paused'] }],
    };
    expect(evaluateAudience(pred, ctx({ planStatus: 'paused' }))).toBe(true);
    expect(evaluateAudience(pred, ctx({ planStatus: 'lapsed' }))).toBe(false);
  });

  it('null planStatus never matches', () => {
    const pred: Predicate = { clauses: [{ field: 'plan_status', op: 'eq', value: 'active' }] };
    expect(evaluateAudience(pred, ctx({ planStatus: null }))).toBe(false);
  });
});

describe('evaluateAudience — tags', () => {
  it('includes_any matches when at least one tag overlaps', () => {
    const pred: Predicate = {
      clauses: [{ field: 'tags', op: 'includes_any', value: ['intro', 'foundation'] }],
    };
    expect(evaluateAudience(pred, ctx({ tags: ['intro'] }))).toBe(true);
    expect(evaluateAudience(pred, ctx({ tags: ['founder'] }))).toBe(false);
  });

  it('includes_all matches when every tag is present', () => {
    const pred: Predicate = {
      clauses: [{ field: 'tags', op: 'includes_all', value: ['founder', 'paid'] }],
    };
    expect(evaluateAudience(pred, ctx({ tags: ['founder', 'paid', 'extra'] }))).toBe(true);
    expect(evaluateAudience(pred, ctx({ tags: ['founder'] }))).toBe(false);
  });
});

describe('evaluateAudience — days_since_signup', () => {
  it('lt matches recent signups', () => {
    const pred: Predicate = {
      clauses: [{ field: 'days_since_signup', op: 'lt', value: 14 }],
    };
    expect(evaluateAudience(pred, ctx({ daysSinceSignup: 7 }))).toBe(true);
    expect(evaluateAudience(pred, ctx({ daysSinceSignup: 30 }))).toBe(false);
  });

  it('gt matches long-standing members', () => {
    const pred: Predicate = {
      clauses: [{ field: 'days_since_signup', op: 'gt', value: 365 }],
    };
    expect(evaluateAudience(pred, ctx({ daysSinceSignup: 400 }))).toBe(true);
    expect(evaluateAudience(pred, ctx({ daysSinceSignup: 100 }))).toBe(false);
  });
});

describe('evaluateAudience — last_booked_at', () => {
  it('days_ago_gt matches lapsed bookers', () => {
    const pred: Predicate = {
      clauses: [{ field: 'last_booked_at', op: 'days_ago_gt', value: 30 }],
    };
    expect(
      evaluateAudience(
        pred,
        ctx({ lastBookedAt: new Date('2024-04-01T00:00:00Z') }), // 61 days ago
      ),
    ).toBe(true);
    expect(
      evaluateAudience(
        pred,
        ctx({ lastBookedAt: new Date('2024-05-20T00:00:00Z') }), // 12 days ago
      ),
    ).toBe(false);
  });

  it('days_ago_gt matches members who have never booked', () => {
    const pred: Predicate = {
      clauses: [{ field: 'last_booked_at', op: 'days_ago_gt', value: 30 }],
    };
    expect(evaluateAudience(pred, ctx({ lastBookedAt: null }))).toBe(true);
  });

  it('days_ago_lt matches recent bookers, excludes never-booked', () => {
    const pred: Predicate = {
      clauses: [{ field: 'last_booked_at', op: 'days_ago_lt', value: 7 }],
    };
    expect(
      evaluateAudience(
        pred,
        ctx({ lastBookedAt: new Date('2024-05-28T00:00:00Z') }), // 4 days ago
      ),
    ).toBe(true);
    expect(evaluateAudience(pred, ctx({ lastBookedAt: null }))).toBe(false);
  });
});

describe('evaluateAudience — has_ever_paid', () => {
  it('matches the exact flag', () => {
    const pred: Predicate = {
      clauses: [{ field: 'has_ever_paid', op: 'eq', value: true }],
    };
    expect(evaluateAudience(pred, ctx({ hasEverPaid: true }))).toBe(true);
    expect(evaluateAudience(pred, ctx({ hasEverPaid: false }))).toBe(false);
  });
});

describe('evaluateAudience — composition', () => {
  it('AND of clauses', () => {
    const pred: Predicate = {
      clauses: [
        { field: 'plan_status', op: 'eq', value: 'active' },
        { field: 'tags', op: 'includes_any', value: ['intro'] },
        { field: 'has_ever_paid', op: 'eq', value: true },
      ],
    };
    expect(
      evaluateAudience(pred, ctx({ tags: ['intro'], hasEverPaid: true })),
    ).toBe(true);
    expect(
      evaluateAudience(pred, ctx({ tags: ['intro'], hasEverPaid: false })),
    ).toBe(false);
  });

  it('empty clauses matches everyone', () => {
    const pred: Predicate = { clauses: [] };
    expect(evaluateAudience(pred, ctx())).toBe(true);
  });
});
