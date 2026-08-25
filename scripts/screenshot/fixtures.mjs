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

// Two shoot modes, because the fake applies no filters and single-object
// reads take the FIRST row of a table:
//   SHOT_MEMBER=1 — the signed-in user's membership row reads role
//     'member', so member-only surfaces (the Leave-gym card) render.
//   SHOT_DM=1 — Priya's profile and coach membership row come first, so
//     the DM thread's peer lookups resolve to her ("Coach" subtitle,
//     "Message Priya…" placeholder) instead of the viewer's own row.
//   SHOT_DUNNING=1 — the Unlimited subscription carries a live dunning
//     row and an invoice link, so the failed-payment notice renders.
const MEMBER_VIEW = process.env.SHOT_MEMBER === '1';
const DM_VIEW = process.env.SHOT_DM === '1';
const DUNNING_VIEW = process.env.SHOT_DUNNING === '1';

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
      operating_defaults_reviewed_at: iso(-90),
      logo_url: null,
      logo_url_dark: null,
      primary_color: '#14161A',
      week_starts_on: 1,
      timezone: 'Europe/London',
      default_class_capacity: 12,
      default_class_minutes: 60,
      store_enabled: true,
      store_shipping_fee_cents: 450,
      // 2h cutoff: same-day classes stay freely cancellable (the row's
      // one-tap Book with Undo shows), while anything closer than two
      // hours routes through the sheet's forfeit warning.
      cancel_cutoff_minutes_before: 120,
    },
  ],

  class_sessions: [
    // A spread of durations on the shown day: the calendar's card sizing
    // has to read the same at 30 minutes as at 90, so the harness has to
    // photograph all of them side by side.
    {
      id: 'cs-d30',
      gym_id: GYM_ID,
      name: null,
      starts_at: iso(0, 6),
      duration_minutes: 30,
      capacity: 12,
      notes: null,
      class_type_id: 'ct2',
      recurrence_id: null,
      coach_id: 'coach-1',
      coach: { full_name: 'Priya Raman', avatar_url: null },
      class_types: { name: 'Metcon', color: '#6366F1', archived_at: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    },
    {
      id: 'cs-d45',
      gym_id: GYM_ID,
      name: null,
      starts_at: iso(0, 8),
      duration_minutes: 45,
      capacity: 10,
      notes: null,
      class_type_id: 'ct1',
      recurrence_id: null,
      coach_id: 'coach-1',
      coach: { full_name: 'Priya Raman', avatar_url: null },
      class_types: { name: 'Barbell Club', color: '#7C3AED', archived_at: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    },
    {
      id: 'cs-d60',
      gym_id: GYM_ID,
      name: null,
      starts_at: iso(0, 18),
      duration_minutes: 60,
      capacity: 16,
      notes: null,
      class_type_id: 'ct2',
      recurrence_id: null,
      coach_id: '22222222-2222-4222-8222-222222222222',
      coach: { full_name: 'Nick Apps', avatar_url: null },
      class_types: { name: 'Metcon', color: '#6366F1', archived_at: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    },
    {
      id: 'cs-d90',
      gym_id: GYM_ID,
      name: null,
      starts_at: iso(0, 20),
      duration_minutes: 90,
      capacity: 12,
      notes: null,
      class_type_id: 'ct1',
      recurrence_id: null,
      coach_id: 'coach-1',
      coach: { full_name: 'Priya Raman', avatar_url: null },
      class_types: { name: 'Barbell Club', color: '#7C3AED', archived_at: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    },
    {
      id: 'cs2',
      gym_id: GYM_ID,
      name: null,
      starts_at: iso(-1, 23),
      duration_minutes: 60,
      capacity: 12,
      notes: null,
      class_type_id: 'ct1',
      recurrence_id: null,
      coach_id: 'coach-1',
      coach: { full_name: 'Priya Raman', avatar_url: null },
      class_types: { name: 'Barbell Club', color: '#7C3AED', archived_at: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    },
    {
      id: 'cs1',
      gym_id: GYM_ID,
      name: null,
      starts_at: iso(-1, 22),
      duration_minutes: 60,
      capacity: 12,
      notes: null,
      class_type_id: 'ct2',
      recurrence_id: null,
      coach_id: '22222222-2222-4222-8222-222222222222',
      coach: { full_name: 'Nick Apps', avatar_url: null },
      class_types: { name: 'Metcon', color: '#6366F1', archived_at: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    },
  ],

  class_programming: [
    {
      id: 'prog-1',
      gym_id: GYM_ID,
      class_type_id: 'ct2',
      date: iso(-1).slice(0, 10),
      class_types: { name: 'Metcon', color: '#6366F1' },
      author: { full_name: 'Priya Raman' },
      sections: [
        {
          section_category: 'wod',
          section_format: 'amrap',
          title: 'Engine builder',
          body: '12 min AMRAP: 10 cal row, 8 burpees, 6 pull-ups',
          leaderboard_enabled: true,
        },
      ],
    },
  ],

  class_bookings: [
    {
      id: 'cb1',
      class_session_id: 'cs1',
      profile_id: USER_ID,
      attended_at: null,
      no_show: false,
      promoted_from_waitlist: false,
      used_entitlement_kind: null,
      used_entitlement_id: null,
      created_at: iso(-1),
      profiles: { full_name: 'Nick Apps', avatar_url: null },
      class_sessions: {
        starts_at: iso(-1, 22),
        duration_minutes: 60,
        class_types: { name: 'Metcon', color: '#6366F1', cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
      },
    },
    // Next week and later: the bookings page groups its upcoming list on
    // the gym week boundary, so one row per group.
    {
      id: 'cb2',
      class_session_id: 'cs-n1',
      profile_id: USER_ID,
      attended_at: null,
      no_show: false,
      promoted_from_waitlist: true,
      used_entitlement_kind: null,
      used_entitlement_id: null,
      created_at: iso(-1),
      profiles: { full_name: 'Nick Apps', avatar_url: null },
      class_sessions: {
        starts_at: iso(3, 18),
        duration_minutes: 60,
        class_types: { name: 'Metcon', color: '#6366F1', cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
      },
    },
    {
      id: 'cb3',
      class_session_id: 'cs-n2',
      profile_id: USER_ID,
      attended_at: null,
      no_show: false,
      promoted_from_waitlist: false,
      used_entitlement_kind: null,
      used_entitlement_id: null,
      created_at: iso(-1),
      profiles: { full_name: 'Nick Apps', avatar_url: null },
      class_sessions: {
        starts_at: iso(10, 17),
        duration_minutes: 90,
        class_types: { name: 'Open Gym', color: '#0F766E', cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
      },
    },
    // Attended history: fills the Past tab, and teaches the recommender
    // that this member goes to Barbell Club late — which is what makes
    // the "For you" chip land on tonight's Barbell session.
    {
      id: 'cb-att1',
      class_session_id: 'cs-old1',
      profile_id: USER_ID,
      attended_at: iso(-7, 23),
      no_show: false,
      promoted_from_waitlist: false,
      used_entitlement_kind: null,
      used_entitlement_id: null,
      created_at: iso(-8),
      profiles: { full_name: 'Nick Apps', avatar_url: null },
      class_sessions: {
        class_type_id: 'ct1',
        starts_at: iso(-7, 23),
        duration_minutes: 60,
        class_types: { name: 'Barbell Club', color: '#7C3AED', cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
      },
    },
    {
      id: 'cb-att2',
      class_session_id: 'cs-old2',
      profile_id: USER_ID,
      attended_at: iso(-14, 23),
      no_show: false,
      promoted_from_waitlist: false,
      used_entitlement_kind: null,
      used_entitlement_id: null,
      created_at: iso(-15),
      profiles: { full_name: 'Nick Apps', avatar_url: null },
      class_sessions: {
        class_type_id: 'ct1',
        starts_at: iso(-14, 23),
        duration_minutes: 60,
        class_types: { name: 'Barbell Club', color: '#7C3AED', cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
      },
    },
  ],

  // The embed the membership query asks for is `gyms!gym_id ( name )`, so
  // the nested object has to be on the row already — the fake does not
  // resolve joins.
  gym_memberships: [
    // The signed-in user's row stays FIRST: single-object reads take the
    // first row, and the fake does not apply .eq filters. In DM mode the
    // coach's row leads instead so the thread's peer-role lookup reads
    // 'coach'; in member mode the user's own row reads 'member'.
    ...(DM_VIEW
      ? [{ gym_id: GYM_ID, profile_id: 'a3', role: 'coach', left_at: null, created_at: iso(-300), profiles: { full_name: 'Priya Raman' }, gyms: { name: 'Forge Athletic' } }]
      : []),
    {
      gym_id: GYM_ID,
      profile_id: USER_ID,
      role: MEMBER_VIEW ? 'member' : 'owner',
      left_at: null,
      created_at: iso(-400),
      gyms: { name: 'Forge Athletic' },
    },
    ...(DM_VIEW
      ? []
      : [{ gym_id: GYM_ID, profile_id: 'a3', role: 'coach', left_at: null, created_at: iso(-300), profiles: { full_name: 'Priya Raman' }, gyms: { name: 'Forge Athletic' } }]),
    { gym_id: GYM_ID, profile_id: 'a1', role: 'member', left_at: null, created_at: iso(-200), profiles: { full_name: 'Amara Nwosu' }, gyms: { name: 'Forge Athletic' } },
    { gym_id: GYM_ID, profile_id: 'a2', role: 'member', left_at: null, created_at: iso(-150), profiles: { full_name: 'Dan Whitcombe' }, gyms: { name: 'Forge Athletic' } },
  ],

  // Empty means "no per-role overrides", and can-resolver falls back to
  // the baked-in default matrix — which for an owner is everything.
  gym_role_capabilities: [],
  member_capability_overrides: [],

  profiles: DM_VIEW
    ? [person('a3', 'Priya Raman'), person(USER_ID, 'Nick Apps'), ...PEOPLE.filter((p) => p.id !== 'a3')]
    : [person(USER_ID, 'Nick Apps'), ...PEOPLE],

  member_contact_details: [{ profile_id: USER_ID, phone: '07700 900123' }],

  class_types: [
    { id: 'ct1', gym_id: GYM_ID, name: 'Barbell Club', color: '#7C3AED', archived_at: null, booking_window_hours_ahead: null, booking_cutoff_minutes_before: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    { id: 'ct2', gym_id: GYM_ID, name: 'Metcon', color: '#6366F1', archived_at: null, booking_window_hours_ahead: null, booking_cutoff_minutes_before: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
    { id: 'ct3', gym_id: GYM_ID, name: 'Open Gym', color: '#0F766E', archived_at: null, booking_window_hours_ahead: null, booking_cutoff_minutes_before: null, cancel_cutoff_minutes_before: null, cancel_cutoff_mode: null, cancel_cutoff_time: null, cancel_cutoff_days_before: null },
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

  store_product_variants: [
    { id: 'v-s', product_id: 's1', gym_id: GYM_ID, name: 'S', sort_order: 1, stock_quantity: 8 },
    { id: 'v-m', product_id: 's1', gym_id: GYM_ID, name: 'M', sort_order: 2, stock_quantity: 0 },
    { id: 'v-l', product_id: 's1', gym_id: GYM_ID, name: 'L', sort_order: 3, stock_quantity: null },
  ],

  email_campaigns: [
    { id: 'e1', gym_id: GYM_ID, title: 'August newsletter', status: 'sent', created_at: iso(-12), sent_at: iso(-11), recipient_count: 41 },
    { id: 'e2', gym_id: GYM_ID, title: 'Bank holiday timetable', status: 'draft', created_at: iso(-3), sent_at: null, recipient_count: 0 },
  ],

  // One live SMS thread ending on the lead's turn with the AI still on
  // it — exactly the state where the conversation screen shows the
  // typing indicator.
  agent_conversations: [
    {
      id: 'conv-1',
      gym_id: GYM_ID,
      phone: '+44 7700 900123',
      channel: 'sms',
      status: 'active',
      lead: { id: 'lead-1', full_name: 'Jess Fletcher' },
    },
  ],
  agent_messages: [
    { id: 'am1', role: 'lead', body: 'Hi — do you do a free trial class?', created_at: iso(-1, 9), seconds_from_start: null, duration_ms: null },
    { id: 'am2', role: 'agent', body: 'We do — your first class is on us. Fancy this week? We have HIIT Tuesday 6pm and Strength Foundations Thursday 7am.', created_at: iso(-1, 9), seconds_from_start: null, duration_ms: null },
    { id: 'am3', role: 'lead', body: 'Tuesday could work. Is it beginner friendly?', created_at: iso(-1, 10), seconds_from_start: null, duration_ms: null },
    { id: 'am4', role: 'agent', body: 'Completely — the coach scales everything, and about half the class started in the last few months. Want me to book you in for Tuesday 6pm?', created_at: iso(-1, 10), seconds_from_start: null, duration_ms: null },
    { id: 'am5', role: 'lead', body: 'Yes please, book me in!', created_at: iso(0, 8), seconds_from_start: null, duration_ms: null },
  ],

  gym_agent_settings: [
    { gym_id: GYM_ID, enabled: true, phone_number: '+44 20 7946 0958', voice_enabled: true, vapi_assistant_id: 'va-1', context: null, voice_id: 'v1', front_desk_entitled: true, provision_status: 'ready' },
  ],

  agent_authority: [
    { gym_id: GYM_ID, action_kind: 'chase_message', level: 'ask_first' },
  ],

  programming_blocks: [
    {
      id: 'blk1',
      gym_id: GYM_ID,
      name: 'Engine block',
      starts_on: iso(-14).slice(0, 10),
      ends_on: iso(14).slice(0, 10),
      color: '#0F766E',
      note: 'Aerobic base for four weeks. Keep the WODs at conversational pace — the tests come in the final week, so resist the urge to sprint the Tuesday intervals.',
    },
  ],

  waiver_documents: [
    {
      id: 'w1',
      gym_id: GYM_ID,
      version: 2,
      title: 'Membership waiver',
      file_url: 'https://example.test/waiver.pdf',
      is_active: true,
    },
  ],

  direct_messages: [
    { id: 'dm1', gym_id: GYM_ID, sender_id: USER_ID, recipient_id: 'a3', body: 'Hi Priya — is tonight still on for barbell?', created_at: iso(-2, 18), read_at: iso(-2, 19) },
    { id: 'dm2', gym_id: GYM_ID, sender_id: 'a3', recipient_id: USER_ID, body: 'Yes! 11pm as usual. Bring your belt, we are pulling heavy.', created_at: iso(-2, 19), read_at: iso(-2, 20) },
    { id: 'dm3', gym_id: GYM_ID, sender_id: USER_ID, recipient_id: 'a3', body: 'Great — should I warm up before or is there time in class?', created_at: iso(-1, 8), read_at: null },
    { id: 'dm4', gym_id: GYM_ID, sender_id: 'a3', recipient_id: USER_ID, body: 'There is a 15 minute primer built in, come as you are.', created_at: iso(-1, 9), read_at: null },
  ],

  gym_announcements: [
    { id: 'ann1', gym_id: GYM_ID, posted_by: 'a3', author: { full_name: 'Priya Raman' }, title: 'Closed bank holiday Monday', body: 'The gym is closed Monday 31 August. Saturday and Sunday run as normal — Tuesday is back to the full timetable.', pinned: true, closure_id: 'cl1', created_at: iso(-4, 10) },
    { id: 'ann2', gym_id: GYM_ID, posted_by: 'a3', title: 'New barbells have landed', body: 'Twelve new competition bars are on the racks. The old ones move to the garage gym rail.', pinned: false, created_at: iso(-1, 7) },
    { id: 'ann3', gym_id: GYM_ID, posted_by: 'a3', title: 'Car park resurfacing', body: 'The council are resurfacing the car park Thursday morning. Street parking on Foundry Lane is free before 10am.', pinned: false, created_at: iso(-9, 9) },
  ],
  // ann3 read, ann1/ann2 unread — the feed shows a mix of dots.
  announcement_reads: [
    { announcement_id: 'ann3', profile_id: USER_ID, read_at: iso(-8) },
  ],

  class_session_broadcasts: [
    {
      id: 'bc1',
      gym_id: GYM_ID,
      class_session_id: 'cs1',
      sender_id: 'a3',
      body: 'Bring long socks — rope climbs are in the workout.',
      created_at: iso(-1, 12),
      class_sessions: {
        id: 'cs1',
        starts_at: iso(-1, 22),
        duration_minutes: 60,
        class_types: { name: 'Metcon', color: '#6366F1' },
      },
    },
  ],
  class_session_broadcast_reads: [],

  gym_closures: [
    { id: 'cl1', gym_id: GYM_ID, starts_on: '2026-08-31', ends_on: '2026-08-31', reason: 'Bank holiday', lifted_at: null },
  ],

  class_change_notifications: [
    { id: 'ccn0', gym_id: GYM_ID, closure_id: 'cl1', kind: 'gym_closed', channel: 'in_app', body: 'Mon 31 Aug 06:00 Metcon was cancelled and your booking refunded.', created_at: iso(-4, 10), read_at: iso(-3, 9) },
    { id: 'ccn1', gym_id: GYM_ID, kind: 'class_cancelled', body: "Thursday's 06:00 Metcon is cancelled — Priya is unwell and no cover was available. Your booking has been refunded.", created_at: iso(-2, 15), read_at: null },
  ],

  payment_notifications: [
    { id: 'pn1', gym_id: GYM_ID, recipient_profile_id: USER_ID, kind: 'payment_failed', channel: 'in_app', body: 'Your card ending 4242 was declined for this month. Update your card and we will retry automatically.', created_at: iso(-1, 5), read_at: null },
  ],
  plan_subscription_dunning: [
    { plan_subscription_id: 'sub-1', gym_id: GYM_ID, profile_id: USER_ID },
  ],

  cover_notifications: [
    {
      id: 'cn1',
      gym_id: GYM_ID,
      kind: 'cover_requested',
      request_id: 'cr1',
      offer_id: null,
      channel: 'in_app',
      created_at: iso(-1, 9),
      read_at: null,
      cover_requests: {
        range_start: iso(2, 6),
        range_end: iso(2, 20),
        requested_start: null,
        requested_end: null,
        requester: { full_name: 'Priya Raman' },
      },
    },
  ],

  staff_alerts: [
    {
      id: 'sa1',
      gym_id: GYM_ID,
      kind: 'injury_new',
      subject_profile_id: 'a1',
      related_id: null,
      created_at: iso(-1, 8),
      acknowledged_at: null,
      subject: { full_name: 'Amara Nwosu', avatar_url: null },
    },
  ],

  plan_subscriptions: [
    {
      id: 'sub-1',
      plan_id: 'p1',
      status: 'active',
      credit_balance: null,
      paid_period_end: iso(11),
      period_resets_at: null,
      cancelled_at: null,
      created_at: iso(-200),
      price_cents: 8900,
      stripe_subscription_id: 'sub_fixture_live',
      imported_legacy: false,
      plan_subscription_dunning: DUNNING_VIEW
        ? [{ past_due_since: iso(-3), payment_failure_count: 2, last_payment_error: 'Your card was declined.', next_payment_attempt: iso(2) }]
        : [],
      membership_invoice_links: DUNNING_VIEW
        ? [{ invoice_url: 'https://invoice.stripe.com/i/fixture' }]
        : [],
      membership_plans: { name: 'Unlimited', kind: 'unlimited', credit_count: null, monthly_price_cents: 8900, notice_period_days: 30 },
    },
    {
      id: 'sub-2',
      plan_id: 'p4',
      status: 'active',
      credit_balance: 7,
      paid_period_end: null,
      period_resets_at: null,
      cancelled_at: null,
      created_at: iso(-30),
      price_cents: 4500,
      stripe_subscription_id: null,
      imported_legacy: false,
      plan_subscription_dunning: [],
      membership_invoice_links: [],
      membership_plans: { name: '10-class pack', kind: 'credit_pack', credit_count: 10, monthly_price_cents: 4500, notice_period_days: null },
    },
  ],

  comp_grants: [
    {
      grant_id: 'cg1',
      gym_id: GYM_ID,
      profile_id: USER_ID,
      starts_at: iso(-10),
      ends_at: iso(18),
      credits_total: 10,
      credits_remaining: 3,
      reason: 'Injury return',
      revoked_at: null,
      granted_by: { full_name: 'Priya Raman' },
    },
  ],

  parq_questionnaires: [
    { id: 'pq1', gym_id: GYM_ID, version: 2, is_active: true },
  ],
  parq_questions: [
    { id: 'q1', questionnaire_id: 'pq1', sort_order: 1, prompt: 'Has your doctor ever said you have a heart condition and should only do physical activity recommended by a doctor?', flag_on_yes: true },
    { id: 'q2', questionnaire_id: 'pq1', sort_order: 2, prompt: 'Do you feel pain in your chest when you do physical activity?', flag_on_yes: true },
    { id: 'q3', questionnaire_id: 'pq1', sort_order: 3, prompt: 'In the past month, have you had chest pain when you were not doing physical activity?', flag_on_yes: true },
    { id: 'q4', questionnaire_id: 'pq1', sort_order: 4, prompt: 'Do you lose your balance because of dizziness, or do you ever lose consciousness?', flag_on_yes: true },
    { id: 'q5', questionnaire_id: 'pq1', sort_order: 5, prompt: 'Do you have a bone or joint problem that could be made worse by a change in your physical activity?', flag_on_yes: true },
    { id: 'q6', questionnaire_id: 'pq1', sort_order: 6, prompt: 'Is your doctor currently prescribing drugs for your blood pressure or heart condition?', flag_on_yes: true },
    { id: 'q7', questionnaire_id: 'pq1', sort_order: 7, prompt: 'Do you know of any other reason why you should not do physical activity?', flag_on_yes: true },
  ],

  tracked_workouts: [
    {
      id: 'tw1', profile_id: USER_ID, performed_at: iso(-2, 18), title: 'Metcon',
      class_session_id: 'cs1',
      class_sessions: { class_types: { name: 'Metcon', color: '#6366F1' } },
      sections: [
        { id: 'ts1', section_category: 'wod', section_format: 'amrap', title: 'Engine builder', body: null, notes: null, sort_order: 1, total_time_seconds: null, total_rounds: 12, total_extra_reps: 4, total_distance_m: null, total_calories: null, did_not_finish: false, free_text_result: null },
        { id: 'ts2', section_category: 'strength_and_skill', section_format: 'strength_sets', title: 'Back squat 5x5', body: null, notes: null, sort_order: 2, total_time_seconds: null, total_rounds: null, total_extra_reps: null, total_distance_m: null, total_calories: null, did_not_finish: null, free_text_result: null },
      ],
      legacy_results: [],
    },
    {
      id: 'tw2', profile_id: USER_ID, performed_at: iso(-8, 7), title: 'Barbell Club',
      class_session_id: null, class_sessions: null,
      sections: [
        { id: 'ts3', section_category: 'strength_and_skill', section_format: 'strength_sets', title: 'Heavy singles', body: null, notes: null, sort_order: 1, total_time_seconds: null, total_rounds: null, total_extra_reps: null, total_distance_m: null, total_calories: null, did_not_finish: null, free_text_result: null },
      ],
      legacy_results: [{ id: 'lr1' }],
    },
    {
      id: 'tw3', profile_id: USER_ID, performed_at: iso(-16, 9), title: 'For time',
      class_session_id: null, class_sessions: null,
      sections: [
        { id: 'ts4', section_category: 'wod', section_format: 'for_time', title: 'Nancy', body: null, notes: null, sort_order: 1, total_time_seconds: 812, total_rounds: null, total_extra_reps: null, total_distance_m: null, total_calories: null, did_not_finish: false, free_text_result: null },
      ],
      legacy_results: [],
    },
    {
      id: 'tw4', profile_id: USER_ID, performed_at: iso(-38, 10), title: 'Long row',
      class_session_id: null, class_sessions: null,
      sections: [
        { id: 'ts5', section_category: 'wod', section_format: 'max_distance', title: '30 min row', body: null, notes: null, sort_order: 1, total_time_seconds: null, total_rounds: null, total_extra_reps: null, total_distance_m: 7250, total_calories: null, did_not_finish: null, free_text_result: null },
      ],
      legacy_results: [],
    },
  ],

  tracked_movement_results: [
    { id: 'mr1', workout_id: 'tw2', movement_key: 'back_squat', track_key: '1rm', value_numeric: 142.5, value_seconds: null, value_unit: 'kg', notes: null, performed_at: iso(-8, 7), profile_id: USER_ID },
    { id: 'mr2', workout_id: null, movement_key: 'back_squat', track_key: '1rm', value_numeric: 137.5, value_seconds: null, value_unit: 'kg', notes: null, performed_at: iso(-60, 7), profile_id: USER_ID },
    { id: 'mr3', workout_id: null, movement_key: 'back_squat', track_key: '1rm', value_numeric: 130, value_seconds: null, value_unit: 'kg', notes: null, performed_at: iso(-120, 7), profile_id: USER_ID },
    { id: 'mr4', workout_id: null, movement_key: 'back_squat', track_key: '5rm', value_numeric: 120, value_seconds: null, value_unit: 'kg', notes: 'Belt on', performed_at: iso(-20, 7), profile_id: USER_ID },
  ],
  tracked_section_movement_tags: [],

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
      occurred_at: iso(-1, 8),
      subject: 'Maya Okafor',
      detail: {},
    },
    {
      item_id: 'lead:l1',
      kind: 'lead_captured',
      occurred_at: iso(-1, 6),
      subject: 'Dan Mercer',
      detail: { source: 'AI Front Desk', status: 'new', conversation_id: 'conv-1' },
    },
    {
      item_id: 'tl-2',
      kind: 'agent_action',
      occurred_at: iso(-1, 7),
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
  dm_inbox: [
    { peer_profile_id: 'a3', peer_full_name: 'Priya Raman', peer_role: 'coach', last_message_id: 'dm4', last_message_body: 'There is a 15 minute primer built in, come as you are.', last_message_at: iso(-1, 9), last_message_from_me: false, unread_count: 2 },
    { peer_profile_id: 'a1', peer_full_name: 'Amara Nwosu', peer_role: 'member', last_message_id: 'dm-a1', last_message_body: 'Same time Thursday? I will grab the good rower.', last_message_at: iso(-2, 18), last_message_from_me: true, unread_count: 0 },
  ],
  inbox_unread_summary: [
    { dm_unread: 2, announcement_unread: 2, class_broadcast_unread: 1, class_change_unread: 1, payment_unread: 1 },
  ],
  mark_class_change_notifications_read: null,
  announcement_read_stats: [{ read_count: 186, member_count: 214 }],
  class_session_training_partners: [
    { class_session_id: 'cs1', profile_id: 'a3', full_name: 'Priya Raman', avatar_url: null },
    { class_session_id: 'cs1', profile_id: 'a4', full_name: 'Maya Okafor', avatar_url: null },
    { class_session_id: 'cs1', profile_id: 'a5', full_name: 'Dan Mercer', avatar_url: null },
    { class_session_id: 'cs1', profile_id: 'a6', full_name: 'Leo Fischer', avatar_url: null },
  ],
  my_gyms: [
    { gym_id: GYM_ID, gym_name: 'Forge Athletic', role: MEMBER_VIEW ? 'member' : 'owner', joined_at: iso(-400), left_at: null },
    { gym_id: '99999999-9999-4999-8999-999999999999', gym_name: 'Ironworks CrossFit', role: 'member', joined_at: iso(-900), left_at: iso(-420) },
  ],
  list_store_products: [
    { id: 'sp1', name: 'Forge tee', description: 'Heavyweight cotton, gym logo front and back.', kind: 'physical', price_cents: 2500, image_url: null, image_urls: [], track_inventory: true, stock_quantity: 24, sold_out: false, recurring: false, recurring_interval: null, category: 'Kit', variants: [{ id: 'v-s', name: 'S', stock_quantity: 8, sold_out: false }, { id: 'v-m', name: 'M', stock_quantity: 0, sold_out: true }, { id: 'v-l', name: 'L', stock_quantity: null, sold_out: false }] },
    { id: 'sp2', name: 'Lifting belt', description: '10mm leather, single prong.', kind: 'physical', price_cents: 6500, image_url: null, image_urls: [], track_inventory: true, stock_quantity: 6, sold_out: false, recurring: false, recurring_interval: null, category: 'Kit' , variants: null },
    { id: 'sp3', name: 'Gym bottle', description: 'One litre, keeps it cold.', kind: 'physical', price_cents: 1200, image_url: null, image_urls: [], track_inventory: false, stock_quantity: null, sold_out: false, recurring: false, recurring_interval: null, category: 'Kit' , variants: null },
    { id: 'sp4', name: '8-week engine block', description: 'The full aerobic base programme as a PDF, with weekly targets.', kind: 'digital', price_cents: 4900, image_url: null, image_urls: [], track_inventory: false, stock_quantity: null, sold_out: false, recurring: false, recurring_interval: null, category: 'Programmes' , variants: null },
    { id: 'sp5', name: 'Individual programming', description: 'A personal programme written for you, updated monthly.', kind: 'digital', price_cents: 9900, image_url: null, image_urls: [], track_inventory: false, stock_quantity: null, sold_out: false, recurring: true, recurring_interval: 'month', category: 'Programmes' , variants: null },
    { id: 'sp6', name: 'Guest day pass', description: 'Bring a friend for a day.', kind: 'digital', price_cents: 1500, image_url: null, image_urls: [], track_inventory: false, stock_quantity: null, sold_out: false, recurring: false, recurring_interval: null, category: null , variants: null },
  ],
  mark_cover_notifications_read: null,
  is_booking_eligible: true,
  list_my_email_preferences: [
    { topic_id: 'tp1', label: 'News & events', description: 'What is happening at the gym this month.', subscribed: true, blanket_unsub: false },
    { topic_id: 'tp2', label: 'Programming updates', description: 'When a new training block starts.', subscribed: true, blanket_unsub: false },
    { topic_id: 'tp3', label: 'Offers', description: 'Discounts on plans and the store.', subscribed: false, blanket_unsub: false },
  ],
};
