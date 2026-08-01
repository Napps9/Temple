import { describe, expect, it } from 'vitest';

import {
  buildCorrectionRows,
  centsToPounds,
  poundsToCents,
  summariseForInference,
  type PlanInput,
  type PlanSuggestion,
  type ReviewedPlan,
} from './plan-mapping';

// The import path reads a gym's entire member list on the way in, and
// everything here is the arithmetic that decides what their plans become.
// Getting it wrong does not throw — it quietly imports the wrong prices
// and the wrong credit counts for every member at once.

describe('pounds and pence', () => {
  it('drops a whole-pound .00 and keeps real pence', () => {
    expect(centsToPounds(8900)).toBe('89');
    expect(centsToPounds(8950)).toBe('89.50');
    expect(centsToPounds(0)).toBe('0');
  });

  // A blank price field is "they did not say", not "free". Returning 0
  // here would silently import a gym's whole roster onto free plans.
  it('reads a blank as nothing rather than as zero', () => {
    expect(poundsToCents('')).toBeNull();
    expect(poundsToCents('   ')).toBeNull();
  });

  it('refuses what is not a price', () => {
    expect(poundsToCents('abc')).toBeNull();
    expect(poundsToCents('-5')).toBeNull();
  });

  it('rounds to the nearest penny rather than truncating', () => {
    expect(poundsToCents('89.999')).toBe(9000);
    expect(poundsToCents('89.5')).toBe(8950);
    expect(poundsToCents(' 89 ')).toBe(8900);
  });
});

describe('what the importer tells the inference about a gym', () => {
  const rows = [
    { plan_name: 'Unlimited', tags: ['founder'] },
    { plan_name: 'Unlimited', tags: [] },
    { plan_name: '10 pack', credits_remaining: 4, tags: ['founder', ' '] },
    { plan_name: '10 pack', credits_remaining: 8, tags: ['lapsed'] },
    { plan_name: '  ', tags: ['lapsed'] },
  ] as never[];

  it('counts members per plan by name', () => {
    const { plans, total_members } = summariseForInference(rows);
    expect(total_members).toBe(5);
    expect(plans.find((p) => p.raw_name === 'Unlimited')!.member_count).toBe(2);
    expect(plans.find((p) => p.raw_name === '10 pack')!.member_count).toBe(2);
  });

  // A blank plan name is a member with no plan, not a plan called "".
  // Bucketing it would invent a plan and offer to create it.
  it('never invents a plan from a blank name', () => {
    const { plans } = summariseForInference(rows);
    expect(plans.map((p) => p.raw_name)).toEqual(['Unlimited', '10 pack']);
  });

  // has_credits is what tips the inference towards a pack rather than a
  // membership, so a plan nobody has credits on must not claim any.
  it('only reports credits for plans that have them', () => {
    const { plans } = summariseForInference(rows);
    expect(plans.find((p) => p.raw_name === 'Unlimited')!.has_credits).toBe(false);
    const pack = plans.find((p) => p.raw_name === '10 pack')!;
    expect(pack.has_credits).toBe(true);
    expect(pack.median_credits_remaining).toBe(6);
  });

  it('counts each tag once per member and ignores whitespace', () => {
    const { tags } = summariseForInference(rows);
    expect(tags.find((t) => t.value === 'founder')!.count).toBe(2);
    expect(tags.find((t) => t.value === 'lapsed')!.count).toBe(2);
    expect(tags.some((t) => t.value.trim() === '')).toBe(false);
  });

  it('has nothing to say about an empty file', () => {
    expect(summariseForInference([])).toEqual({
      plans: [],
      tags: [],
      total_members: 0,
    });
  });
});

describe('what the gym corrected', () => {
  const input: PlanInput = {
    raw_name: 'Unlimited',
    member_count: 20,
    has_credits: false,
    median_credits_remaining: null,
    has_plan_end: false,
    median_days_to_plan_end: null,
  };
  const suggested: PlanSuggestion = {
    raw_name: 'Unlimited',
    suggested_name: 'Unlimited',
    suggested_kind: 'unlimited',
    suggested_credit_count: null,
    suggested_monthly_price_cents: 8900,
  } as PlanSuggestion;
  const reviewed = (over: Partial<ReviewedPlan> = {}): ReviewedPlan =>
    ({
      raw_name: 'Unlimited',
      name: 'Unlimited',
      kind: 'unlimited',
      credit_count: null,
      monthly_price: '89',
      drop: false,
      existing_plan_id: null,
      ...over,
    }) as ReviewedPlan;

  const rows = (final: ReviewedPlan) =>
    buildCorrectionRows({
      plansInferred: [suggested],
      plansFinal: [final],
      planInputsByRaw: new Map([['Unlimited', input]]),
      tagsKeep: new Set(),
      tagsInferenceKeep: new Set(),
      tagsInputs: [],
    });

  // The corrections table is what the inference learns from. Recording an
  // override that never happened teaches it to distrust a guess that was
  // right.
  it('records no override when the gym accepted the guess', () => {
    expect(rows(reviewed())[0].was_overridden).toBe(false);
  });

  it('records an override when a price was changed', () => {
    expect(rows(reviewed({ monthly_price: '95' }))[0].was_overridden).toBe(true);
  });

  // Dropping a plan, or routing it onto one that already exists, is an
  // override of the baseline by definition — the guess always proposes
  // creating a new plan with those fields.
  it('counts dropping and re-routing as overrides in themselves', () => {
    expect(rows(reviewed({ drop: true }))[0].was_overridden).toBe(true);
    expect(rows(reviewed({ existing_plan_id: 'plan-1' }))[0].was_overridden).toBe(true);
  });

  it('leaves a plan out entirely when the file never described it', () => {
    const out = buildCorrectionRows({
      plansInferred: [suggested],
      plansFinal: [reviewed({ raw_name: 'Ghost' })],
      planInputsByRaw: new Map([['Unlimited', input]]),
      tagsKeep: new Set(),
      tagsInferenceKeep: new Set(),
      tagsInputs: [],
    });
    expect(out).toEqual([]);
  });

  it('records a tag the gym kept against a guess that dropped it', () => {
    const out = buildCorrectionRows({
      plansInferred: [],
      plansFinal: [],
      planInputsByRaw: new Map(),
      tagsKeep: new Set(['founder']),
      tagsInferenceKeep: new Set(),
      tagsInputs: [{ value: 'founder', count: 3 }],
    });
    expect(out[0]).toMatchObject({
      field_kind: 'tag',
      ai_suggestion: { action: 'drop' },
      final_value: { action: 'keep' },
      was_overridden: true,
    });
  });
});
