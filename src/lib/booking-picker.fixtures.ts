import type {
  ActivityInput,
  PaidInput,
  PickerCandidate,
  PickerCompGrant,
  PickerInput,
  PickerPlanSubscription,
} from './booking-picker';

// Shared SQL ↔ TS fixture set. Both runtimes consume the same
// (input, expected) tuples; CI fails on TS divergence today, and on
// SQL divergence once a Postgres-backed test runner lands (Phase 0
// verification).
//
// Synthetic IDs are readable strings rather than real UUIDs — both
// runtimes treat them as opaque keys.

const YOGA = 'class-type-yoga';
const CROSSFIT = 'class-type-crossfit';
const BASIC_PLAN = 'plan-basic';
const PREMIUM_PLAN = 'plan-premium';

const CLASS_AT = '2026-06-15T10:00:00.000Z';

function makeCompGrant(overrides: Partial<PickerCompGrant> = {}): PickerCompGrant {
  return {
    grant_id: 'cg-1',
    starts_at: '2026-06-01T00:00:00.000Z',
    ends_at: '2026-07-01T00:00:00.000Z',
    credits_total: null,
    credits_remaining: null,
    class_type_allowlist: [],
    revoked_at: null,
    ...overrides,
  };
}

function makePlanSub(
  overrides: Partial<PickerPlanSubscription> = {},
): PickerPlanSubscription {
  return {
    id: 'ps-1',
    plan_id: PREMIUM_PLAN,
    status: 'active',
    credit_balance: null,
    paid_period_end: null,
    plan_kind: 'unlimited',
    plan_class_types: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<PickerInput> = {}): PickerInput {
  return {
    class_starts_at: CLASS_AT,
    class_type_id: YOGA,
    comp_grants: [],
    plan_subscriptions: [],
    ...overrides,
  };
}

export type PickerFixture = {
  name: string;
  input: PickerInput;
  expected_eligible: boolean;
  expected_default: PickerCandidate | null;
};

export const PICKER_FIXTURES: PickerFixture[] = [
  {
    name: 'no candidates: ineligible, no default',
    input: baseInput(),
    expected_eligible: false,
    expected_default: null,
  },

  // Single-candidate cases
  {
    name: 'one unlimited active plan: eligible, default = plan',
    input: baseInput({ plan_subscriptions: [makePlanSub()] }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-1' },
  },
  {
    name: 'one credit_period plan with credits: eligible, default = plan',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({
          plan_kind: 'credit_period',
          credit_balance: 5,
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-1' },
  },
  {
    name: 'one credit_pack plan with credits: eligible, default = plan',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({ plan_kind: 'credit_pack', credit_balance: 3 }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-1' },
  },
  {
    name: 'one open-allowlist comp grant: eligible, default = comp',
    input: baseInput({ comp_grants: [makeCompGrant()] }),
    expected_eligible: true,
    expected_default: { kind: 'comp_grant', id: 'cg-1' },
  },

  // Cascade: comp before plan (decay first)
  {
    name: 'comp + unlimited plan: default = comp (decay-first)',
    input: baseInput({
      comp_grants: [makeCompGrant()],
      plan_subscriptions: [makePlanSub()],
    }),
    expected_eligible: true,
    expected_default: { kind: 'comp_grant', id: 'cg-1' },
  },
  {
    name: 'two comps with different ends_at: default = earliest ends',
    input: baseInput({
      comp_grants: [
        makeCompGrant({ grant_id: 'cg-late', ends_at: '2026-07-15T00:00:00.000Z' }),
        makeCompGrant({ grant_id: 'cg-early', ends_at: '2026-06-30T00:00:00.000Z' }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'comp_grant', id: 'cg-early' },
  },

  // Cascade: credit-based before unlimited
  {
    name: 'credit_period + unlimited plan: default = credit-based',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({ id: 'ps-unlimited' }),
        makePlanSub({
          id: 'ps-credit',
          plan_id: BASIC_PLAN,
          plan_kind: 'credit_period',
          credit_balance: 5,
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-credit' },
  },
  {
    name: 'two credit subs: default = earliest paid_period_end',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({
          id: 'ps-late',
          plan_kind: 'credit_period',
          credit_balance: 5,
          paid_period_end: '2026-08-01T00:00:00.000Z',
        }),
        makePlanSub({
          id: 'ps-early',
          plan_kind: 'credit_period',
          credit_balance: 5,
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-early' },
  },
  {
    name: 'credit_pack (no period) + credit_period: period sub picked first',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({
          id: 'ps-pack',
          plan_kind: 'credit_pack',
          credit_balance: 5,
        }),
        makePlanSub({
          id: 'ps-period',
          plan_kind: 'credit_period',
          credit_balance: 5,
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-period' },
  },

  // Plan class-type allowlist
  {
    name: 'Basic (yoga only) + Premium (all), class is yoga: default = Basic (credit)',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({ id: 'ps-premium', plan_id: PREMIUM_PLAN }),
        makePlanSub({
          id: 'ps-basic',
          plan_id: BASIC_PLAN,
          plan_kind: 'credit_period',
          credit_balance: 5,
          paid_period_end: '2026-06-30T00:00:00.000Z',
          plan_class_types: [YOGA],
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-basic' },
  },
  {
    name: 'Basic (yoga only) + Premium (all), class is CrossFit: default = Premium',
    input: baseInput({
      class_type_id: CROSSFIT,
      plan_subscriptions: [
        makePlanSub({ id: 'ps-premium', plan_id: PREMIUM_PLAN }),
        makePlanSub({
          id: 'ps-basic',
          plan_id: BASIC_PLAN,
          plan_kind: 'credit_period',
          credit_balance: 5,
          paid_period_end: '2026-06-30T00:00:00.000Z',
          plan_class_types: [YOGA],
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-premium' },
  },

  // Comp grant allowlist
  {
    name: 'comp grant with allowlist excluding class type: ineligible',
    input: baseInput({
      class_type_id: CROSSFIT,
      comp_grants: [makeCompGrant({ class_type_allowlist: [YOGA] })],
    }),
    expected_eligible: false,
    expected_default: null,
  },
  {
    name: 'comp grant with allowlist including class type: eligible',
    input: baseInput({
      comp_grants: [makeCompGrant({ class_type_allowlist: [YOGA, CROSSFIT] })],
    }),
    expected_eligible: true,
    expected_default: { kind: 'comp_grant', id: 'cg-1' },
  },

  // Comp grant credit pool
  {
    name: 'comp grant with credits_remaining = 0: ineligible',
    input: baseInput({
      comp_grants: [makeCompGrant({ credits_total: 5, credits_remaining: 0 })],
    }),
    expected_eligible: false,
    expected_default: null,
  },
  {
    name: 'comp grant with credits_remaining = 1: eligible',
    input: baseInput({
      comp_grants: [makeCompGrant({ credits_total: 5, credits_remaining: 1 })],
    }),
    expected_eligible: true,
    expected_default: { kind: 'comp_grant', id: 'cg-1' },
  },

  // Comp grant window boundaries
  {
    name: 'class.starts_at = comp.starts_at: eligible (>= boundary)',
    input: baseInput({
      class_starts_at: '2026-06-01T00:00:00.000Z',
      comp_grants: [makeCompGrant()],
    }),
    expected_eligible: true,
    expected_default: { kind: 'comp_grant', id: 'cg-1' },
  },
  {
    name: 'class.starts_at = comp.ends_at: ineligible (< boundary)',
    input: baseInput({
      class_starts_at: '2026-07-01T00:00:00.000Z',
      comp_grants: [makeCompGrant()],
    }),
    expected_eligible: false,
    expected_default: null,
  },

  // Comp grant revoked
  {
    name: 'comp grant revoked: ineligible',
    input: baseInput({
      comp_grants: [makeCompGrant({ revoked_at: '2026-06-10T00:00:00.000Z' })],
    }),
    expected_eligible: false,
    expected_default: null,
  },

  // Plan subscription credit pool
  {
    name: 'credit_period plan with credit_balance = 0: ineligible',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({
          plan_kind: 'credit_period',
          credit_balance: 0,
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: false,
    expected_default: null,
  },

  // Status: cancelled_at_period_end with paid_period_end boundary
  {
    name: 'cancelled_at_period_end, class within period: eligible',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({
          status: 'cancelled_at_period_end',
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-1' },
  },
  {
    name: 'cancelled_at_period_end, class = paid_period_end: eligible (<= boundary)',
    input: baseInput({
      class_starts_at: '2026-06-30T00:00:00.000Z',
      plan_subscriptions: [
        makePlanSub({
          status: 'cancelled_at_period_end',
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-1' },
  },
  {
    name: 'cancelled_at_period_end, class > paid_period_end: ineligible',
    input: baseInput({
      class_starts_at: '2026-07-15T00:00:00.000Z',
      plan_subscriptions: [
        makePlanSub({
          status: 'cancelled_at_period_end',
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: false,
    expected_default: null,
  },

  // Status: refunded_retained within retention
  {
    name: 'refunded_retained within retention: eligible',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({
          status: 'refunded_retained',
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-1' },
  },
  {
    name: 'refunded_retained past retention: ineligible',
    input: baseInput({
      class_starts_at: '2026-07-15T00:00:00.000Z',
      plan_subscriptions: [
        makePlanSub({
          status: 'refunded_retained',
          paid_period_end: '2026-06-30T00:00:00.000Z',
        }),
      ],
    }),
    expected_eligible: false,
    expected_default: null,
  },

  // Status: paused, lapsed, cancelled, pending
  {
    name: 'paused: ineligible (v1)',
    input: baseInput({
      plan_subscriptions: [makePlanSub({ status: 'paused' })],
    }),
    expected_eligible: false,
    expected_default: null,
  },
  {
    name: 'lapsed: ineligible',
    input: baseInput({
      plan_subscriptions: [makePlanSub({ status: 'lapsed' })],
    }),
    expected_eligible: false,
    expected_default: null,
  },
  {
    name: 'cancelled: ineligible',
    input: baseInput({
      plan_subscriptions: [makePlanSub({ status: 'cancelled' })],
    }),
    expected_eligible: false,
    expected_default: null,
  },
  {
    name: 'pending: ineligible',
    input: baseInput({
      plan_subscriptions: [makePlanSub({ status: 'pending' })],
    }),
    expected_eligible: false,
    expected_default: null,
  },

  // Upgrade pattern
  {
    name: 'upgraded Basic→Premium, Basic now lapsed: default = Premium only',
    input: baseInput({
      plan_subscriptions: [
        makePlanSub({
          id: 'ps-basic-lapsed',
          plan_id: BASIC_PLAN,
          plan_kind: 'credit_period',
          status: 'lapsed',
          credit_balance: 5,
          paid_period_end: '2026-06-30T00:00:00.000Z',
          plan_class_types: [YOGA],
        }),
        makePlanSub({ id: 'ps-premium', plan_id: PREMIUM_PLAN }),
      ],
    }),
    expected_eligible: true,
    expected_default: { kind: 'plan_subscription', id: 'ps-premium' },
  },
];

export type ActivityFixture = {
  name: string;
  input: ActivityInput;
  expected: boolean;
};

const NOW = '2026-06-15T10:00:00.000Z';

export const ACTIVITY_FIXTURES: ActivityFixture[] = [
  {
    name: 'no subs, no grants: false',
    input: { now: NOW, plan_subscriptions: [], comp_grants: [] },
    expected: false,
  },
  {
    name: 'active sub: true',
    input: { now: NOW, plan_subscriptions: [{ status: 'active' }], comp_grants: [] },
    expected: true,
  },
  {
    name: 'pending sub: true (broad)',
    input: { now: NOW, plan_subscriptions: [{ status: 'pending' }], comp_grants: [] },
    expected: true,
  },
  {
    name: 'paused sub: true (broad — paused IS active relationship)',
    input: { now: NOW, plan_subscriptions: [{ status: 'paused' }], comp_grants: [] },
    expected: true,
  },
  {
    name: 'cancelled_at_period_end sub: true (broad)',
    input: {
      now: NOW,
      plan_subscriptions: [{ status: 'cancelled_at_period_end' }],
      comp_grants: [],
    },
    expected: true,
  },
  {
    name: 'lapsed sub: false',
    input: { now: NOW, plan_subscriptions: [{ status: 'lapsed' }], comp_grants: [] },
    expected: false,
  },
  {
    name: 'cancelled sub: false',
    input: { now: NOW, plan_subscriptions: [{ status: 'cancelled' }], comp_grants: [] },
    expected: false,
  },
  {
    name: 'refunded_retained sub: false (not in broad-active set)',
    input: {
      now: NOW,
      plan_subscriptions: [{ status: 'refunded_retained' }],
      comp_grants: [],
    },
    expected: false,
  },
  {
    name: 'live comp grant: true',
    input: {
      now: NOW,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-06-01T00:00:00.000Z',
          ends_at: '2026-07-01T00:00:00.000Z',
          revoked_at: null,
        },
      ],
    },
    expected: true,
  },
  {
    name: 'expired comp grant: false',
    input: {
      now: NOW,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-05-01T00:00:00.000Z',
          ends_at: '2026-06-01T00:00:00.000Z',
          revoked_at: null,
        },
      ],
    },
    expected: false,
  },
  {
    name: 'revoked comp grant in window: false',
    input: {
      now: NOW,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-06-01T00:00:00.000Z',
          ends_at: '2026-07-01T00:00:00.000Z',
          revoked_at: '2026-06-10T00:00:00.000Z',
        },
      ],
    },
    expected: false,
  },
  {
    name: 'future comp grant: false',
    input: {
      now: NOW,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-08-01T00:00:00.000Z',
          ends_at: '2026-09-01T00:00:00.000Z',
          revoked_at: null,
        },
      ],
    },
    expected: false,
  },
];

export type PaidFixture = {
  name: string;
  input: PaidInput;
  expected: boolean;
};

export const PAID_FIXTURES: PaidFixture[] = [
  {
    name: 'no billing events: false',
    input: { billing_events: [] },
    expected: false,
  },
  {
    name: 'charge.succeeded: true',
    input: { billing_events: [{ kind: 'charge.succeeded' }] },
    expected: true,
  },
  {
    name: 'invoice.paid: true',
    input: { billing_events: [{ kind: 'invoice.paid' }] },
    expected: true,
  },
  {
    name: 'refund.created only: false',
    input: { billing_events: [{ kind: 'refund.created' }] },
    expected: false,
  },
  {
    name: 'mixed paid + refund: true',
    input: {
      billing_events: [{ kind: 'charge.succeeded' }, { kind: 'refund.created' }],
    },
    expected: true,
  },
];
