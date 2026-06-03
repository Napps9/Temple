import type { CohortFlags, CohortInput } from './insights';

// Fixture-driven SQL ↔ TS parity. Each fixture is independent and
// names a single cohort scenario; both insights.test.ts and the SQL
// pgTAP harness (supabase/tests/v_member_cohort_parity.sql) consume
// the same shapes.
//
// Synthetic IDs use readable strings rather than UUIDs so failing
// assertions read clearly. The SQL harness substitutes UUIDs.

export type CohortFixture = {
  name: string;
  input: CohortInput;
  expected: CohortFlags;
};

const NOW = '2026-06-03T12:00:00Z';
const JOINED = '2026-05-01T10:00:00Z';

export const COHORT_FIXTURES: CohortFixture[] = [
  {
    name: 'pure intro: live comp grant, no plan, never paid',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-05-15T00:00:00Z',
          ends_at:   '2026-06-15T00:00:00Z',
          revoked_at: null,
        },
      ],
      billing_events: [],
    },
    expected: {
      joined_at: JOINED,
      is_intro: true,
      is_paying: false,
      is_active: true,
      is_expiring_soon: false,
      is_expired: false,
      days_until_expiry: 11,
    },
  },
  {
    name: 'intro about to expire: comp grant ends in 3 days',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-05-20T00:00:00Z',
          ends_at:   '2026-06-06T12:00:00Z',
          revoked_at: null,
        },
      ],
      billing_events: [],
    },
    expected: {
      joined_at: JOINED,
      is_intro: true,
      is_paying: false,
      is_active: true,
      is_expiring_soon: true,
      is_expired: false,
      days_until_expiry: 3,
    },
  },
  {
    name: 'converted intro (post-Stripe): comp + active plan + charge.succeeded',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [
        {
          status: 'active',
          paid_period_end: '2026-07-15T00:00:00Z',
        },
      ],
      comp_grants: [
        {
          starts_at: '2026-05-15T00:00:00Z',
          ends_at:   '2026-06-15T00:00:00Z',
          revoked_at: null,
        },
      ],
      billing_events: [{ kind: 'charge.succeeded' }],
    },
    expected: {
      joined_at: JOINED,
      is_intro: false,
      is_paying: true,
      is_active: true,
      is_expiring_soon: false,
      is_expired: false,
      days_until_expiry: 11,
    },
  },
  {
    name: 'active sub expiring soon: paid_period_end in 5 days',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [
        {
          status: 'active',
          paid_period_end: '2026-06-08T18:00:00Z',
        },
      ],
      comp_grants: [],
      billing_events: [{ kind: 'invoice.paid' }],
    },
    expected: {
      joined_at: JOINED,
      is_intro: false,
      is_paying: true,
      is_active: true,
      is_expiring_soon: true,
      is_expired: false,
      days_until_expiry: 5,
    },
  },
  {
    name: 'expired: was paying, sub is lapsed, no live grant',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [
        {
          status: 'lapsed',
          paid_period_end: '2026-05-20T00:00:00Z',
        },
      ],
      comp_grants: [],
      billing_events: [{ kind: 'charge.succeeded' }],
    },
    expected: {
      joined_at: JOINED,
      is_intro: false,
      is_paying: true,
      is_active: false,
      is_expiring_soon: false,
      is_expired: true,
      days_until_expiry: null,
    },
  },
  {
    name: 'refunded_retained mid-period: still active, still paying',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [
        {
          status: 'refunded_retained',
          paid_period_end: '2026-06-25T00:00:00Z',
        },
      ],
      comp_grants: [],
      billing_events: [{ kind: 'charge.succeeded' }],
    },
    expected: {
      joined_at: JOINED,
      is_intro: false,
      is_paying: true,
      is_active: false, // refunded_retained is NOT in ACTIVE_SUB_STATUSES
      is_expiring_soon: false, // 21 days > 7-day default window
      is_expired: true,
      days_until_expiry: 21,
    },
  },
  {
    name: 'pre-Stripe intro: no billing_events; comp grant active',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-05-15T00:00:00Z',
          ends_at:   '2026-08-15T00:00:00Z',
          revoked_at: null,
        },
      ],
      billing_events: [], // billing_live = false: paying tile gated by screen
    },
    expected: {
      joined_at: JOINED,
      is_intro: true,
      is_paying: false,
      is_active: true,
      is_expiring_soon: false,
      is_expired: false,
      days_until_expiry: 72,
    },
  },
  {
    name: 'fresh signup with no plan and no comp: not intro, not active',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [],
      comp_grants: [],
      billing_events: [],
    },
    expected: {
      joined_at: JOINED,
      is_intro: false,
      is_paying: false,
      is_active: false,
      is_expiring_soon: false,
      is_expired: false,
      days_until_expiry: null,
    },
  },
  {
    name: 'revoked comp grant: not intro, not active',
    input: {
      now: NOW,
      joined_at: JOINED,
      plan_subscriptions: [],
      comp_grants: [
        {
          starts_at: '2026-05-15T00:00:00Z',
          ends_at:   '2026-06-15T00:00:00Z',
          revoked_at: '2026-05-20T00:00:00Z',
        },
      ],
      billing_events: [],
    },
    expected: {
      joined_at: JOINED,
      is_intro: false,
      is_paying: false,
      is_active: false,
      is_expiring_soon: false,
      is_expired: true, // ever_had_comp = true, not active
      days_until_expiry: null,
    },
  },
];
