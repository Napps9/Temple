// Fixtures for the screenshot harness.
//
// One export per PostgREST table plus one per RPC. Anything not named here
// answers with an empty array, so a screen renders its empty state rather
// than hanging on a promise that never settles — an empty state is a real
// screen and worth photographing too.
//
// Keep these boring and plausible. They exist to make the layout legible,
// not to exercise edge cases; a screenshot of a gym with one member tells
// you nothing about how the rows stack.

const GYM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

export const IDS = { GYM_ID, USER_ID };

const iso = (daysFromNow, hour = 9) => {
  // Fixed epoch so a rebuild does not change every caption. 2026-08-24.
  const base = Date.UTC(2026, 7, 24, hour, 0, 0);
  return new Date(base + daysFromNow * 86400000).toISOString();
};

const person = (id, name, extra = {}) => ({
  id,
  full_name: name,
  avatar_url: null,
  ...extra,
});

const PEOPLE = [
  person('a1', 'Amara Nwosu'),
  person('a2', 'Dan Whitcombe'),
  person('a3', 'Priya Raman'),
  person('a4', 'Sam Okafor'),
  person('a5', 'Bea Hollins'),
  person('a6', 'Tom Achebe'),
];

// auth-js decodes the access token as a JWT on load (GoTrueClient's
// _recoverAndRefresh) and throws away a session whose token will not
// parse — which is why a placeholder string silently bounced the harness
// to /sign-in with no network call at all. The signature is never
// checked here, but the three-segment shape and the claims are.
const b64url = (o) =>
  Buffer.from(JSON.stringify(o))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const EXPIRES_AT = Math.floor(Date.UTC(2099, 0, 1) / 1000);

const ACCESS_TOKEN = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    sub: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@forge.test',
    iat: Math.floor(Date.UTC(2026, 7, 24) / 1000),
    exp: EXPIRES_AT,
    session_id: '33333333-3333-4333-8333-333333333333',
    is_anonymous: false,
  }),
  'harness-signature-not-verified',
].join('.');

export const SESSION = {
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: EXPIRES_AT,
  refresh_token: 'harness-refresh-token',
  user: {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@forge.test',
    email_confirmed_at: iso(-400),
    phone: '',
    created_at: iso(-400),
    updated_at: iso(-1),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Nick Apps' },
    identities: [],
  },
};

export const TABLES = {
  gyms: [
    {
      id: GYM_ID,
      name: 'Forge Athletic',
      slug: 'forge-athletic',
      currency: 'GBP',
      public_signup_enabled: true,
      public_lead_capture_enabled: true,
      onboarding_dismissed_at: iso(-100),
      website_builder_enabled: true,
      operating_defaults_reviewed_at: iso(-90),
      logo_url: null,
      logo_url_dark: null,
      primary_color: '#C2410C',
      week_starts_on: 1,
    },
  ],

  // The embed the membership query asks for is `gyms!gym_id ( name )`, so
  // the nested object has to be on the row already — the fake does not
  // resolve joins.
  gym_memberships: [
    {
      gym_id: GYM_ID,
      profile_id: USER_ID,
      role: 'owner',
      left_at: null,
      created_at: iso(-400),
      gyms: { name: 'Forge Athletic' },
    },
  ],

  // Empty means "no per-role overrides", and can-resolver falls back to
  // the baked-in default matrix — which for an owner is everything.
  gym_role_capabilities: [],
  member_capability_overrides: [],

  profiles: [person(USER_ID, 'Nick Apps'), ...PEOPLE],

  member_contact_details: [{ profile_id: USER_ID, phone: '07700 900123' }],

  class_types: [
    { id: 'ct1', gym_id: GYM_ID, name: 'Barbell Club', color: '#7C3AED', archived_at: null },
    { id: 'ct2', gym_id: GYM_ID, name: 'Metcon', color: '#6366F1', archived_at: null },
    { id: 'ct3', gym_id: GYM_ID, name: 'Open Gym', color: '#0F766E', archived_at: null },
  ],

  membership_plans: [
    { plan_id: 'p1', gym_id: GYM_ID, name: 'Unlimited', kind: 'unlimited', credit_count: null, monthly_price_cents: 8900, notice_period_days: 30, includes_individual_programming: false, archived_at: null },
    { plan_id: 'p2', gym_id: GYM_ID, name: '3× a week', kind: 'credit_period', credit_count: 12, monthly_price_cents: 6500, notice_period_days: 30, includes_individual_programming: false, archived_at: null },
    { plan_id: 'p3', gym_id: GYM_ID, name: 'Off-peak', kind: 'unlimited', credit_count: null, monthly_price_cents: 4500, notice_period_days: null, includes_individual_programming: false, archived_at: null },
  ],

  store_products: [
    { id: 's1', gym_id: GYM_ID, name: 'Forge tee', description: 'Heavyweight cotton.', price_cents: 2500, currency: 'GBP', kind: 'physical', active: true, image_urls: [], recurring: false, track_inventory: true, stock: 24 },
    { id: 's2', gym_id: GYM_ID, name: 'Lifting belt', description: '10mm leather.', price_cents: 6500, currency: 'GBP', kind: 'physical', active: true, image_urls: [], recurring: false, track_inventory: true, stock: 6 },
  ],

  email_campaigns: [
    { id: 'e1', gym_id: GYM_ID, title: 'August newsletter', status: 'sent', created_at: iso(-12), sent_at: iso(-11), recipient_count: 41 },
    { id: 'e2', gym_id: GYM_ID, title: 'Bank holiday timetable', status: 'draft', created_at: iso(-3), sent_at: null, recipient_count: 0 },
  ],

  agent_authority: [
    { gym_id: GYM_ID, action_kind: 'chase_message', level: 'ask_first' },
  ],

  tasks: [
    { id: 't1', gym_id: GYM_ID, title: 'Order more chalk', status: 'open', due_date: '2026-08-27', notes: null, assignee: { full_name: 'Priya Raman' } },
    { id: 't2', gym_id: GYM_ID, title: 'Fix the rower display', status: 'open', due_date: null, notes: 'Seat 3, screen flickers.', assignee: null },
  ],
};

// RPCs answer by name. A missing name returns [] like a table — which is
// right for set-returning functions and WRONG for scalar ones: an [] where
// a number belongs coerces to 0 in arithmetic and to NaN in a division,
// which is exactly how the first Manage render showed "NaN%" in the
// Members tile. Scalar RPCs must have scalar fixtures.
export const RPCS = {
  count_members_as_of: 7,
  count_attendance_attendees: 5,
  compute_revenue_summary: [
    { currency: 'GBP', gross_cents: 418000, refunds_cents: 0, net_cents: 418000 },
  ],
  compute_finance_summary: [
    {
      currency: 'GBP',
      confirmed_cents: 418000,
      confirmed_count: 6,
      pending_cents: 8900,
      pending_count: 2,
      at_risk_cents: 4500,
      at_risk_count: 1,
      forward_mrr_cents: 426900,
      forward_count: 7,
    },
  ],
  // The epoch above is 2026-08-24; iso(-2) was "today" when the boards
  // were first shot. Old events just age into past-day threads.
  timeline_feed: [
    {
      item_id: 'tl-1',
      kind: 'member_joined',
      occurred_at: iso(-2, 8),
      subject: 'Maya Okafor',
      detail: {},
    },
    {
      item_id: 'tl-2',
      kind: 'agent_action',
      occurred_at: iso(-2, 7),
      subject: 'Leo Park',
      detail: {
        status: 'executed',
        action_kind: 'retention_message',
        payload: { member_name: 'Leo Park', weeks_absent: 3 },
      },
    },
  ],
  gym_overdue_memberships: [
    {
      subscription_id: 'sub-leo',
      profile_id: 'p-leo',
      full_name: 'Leo Park',
      plan_name: 'Unlimited',
      amount_cents: 4500,
      currency: 'GBP',
      past_due_since: iso(-6),
      payment_failure_count: 2,
      next_payment_attempt: iso(1),
      last_payment_error: 'Your card was declined.',
      notice_status: null,
    },
  ],
  get_gym_setup_progress: [
    { step_key: 'settings', done: true, complete: 1, target: 1 },
    { step_key: 'class_type_and_schedule', done: true, complete: 2, target: 2 },
    { step_key: 'parq', done: true, complete: 2, target: 2 },
    { step_key: 'stripe', done: true, complete: 1, target: 1 },
    { step_key: 'plan', done: true, complete: 1, target: 1 },
    { step_key: 'team', done: true, complete: 1, target: 1 },
    { step_key: 'members_imported', done: true, complete: 1, target: 1 },
    { step_key: 'workouts_imported', done: false, complete: 0, target: 1 },
  ],
  record_route_open: null,
  get_member_consent_state: [{ analytics: true, decided_at: iso(-90) }],
};
