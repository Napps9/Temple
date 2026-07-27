// Pure, deterministic plan builder for the demo-gym seeder: takes a
// config and returns every row for every table, all ids pre-generated,
// no I/O. The orchestrator inserts what this returns; --dry-run prints
// it; the tests exercise it. Row shapes are the Database Insert types,
// so a schema drift fails typecheck rather than at runtime.

import { starterDocument, FALLBACK_BRAND_SEED } from '../../src/lib/email/blocks';
import { SITE_TEMPLATES } from '../../src/lib/site-templates';
import { CROSSFIT_WOD_TEMPLATES, HYROX_WOD_TEMPLATES, buildProgrammingRows } from './programming';
import type { Database, GymRole } from '../../src/types/database';
import {
  COACHES,
  DEMO_ADDRESS,
  DEMO_HOURS_TEXT,
  DM_SCRIPTS,
  LEAD_NAMES,
  MAX_MEMBERS,
  OWNER,
  PENDING_NAMES,
  TESTIMONIAL_QUOTES,
  demoUuid,
  memberNames,
  mulberry32,
  rngInt,
  seedFor,
  type Rng,
} from './roster';
import {
  CLASS_TYPE_DEFS,
  CLASS_TYPE_DEFS_HYROX,
  GYM_HOURS,
  RECURRENCE_DEFS,
  RECURRENCE_DEFS_HYROX,
  expandOccurrences,
  isoDateOffset,
} from './timetable';
import {
  HYROX_SIM_MOVEMENT_KEY,
  HYROX_TIME_MOVEMENT_KEY,
  buildRace,
  focusPool,
  focusPoolHyrox,
  officialRaceSeconds,
  progressionSeries,
  type FocusScheme,
} from './training';

// pending_members and the store tables live under Views in
// database.ts, so index across both sections.
type TablesAndViews = Database['public']['Tables'] & Database['public']['Views'];
type T<Name extends keyof TablesAndViews> = TablesAndViews[Name] extends { Insert: infer I }
  ? I
  : never;

// Kept in sync with CONSENT_POLICY_VERSION in src/lib/consent.ts —
// not imported because consent.ts pulls in the app's supabase client,
// which needs EXPO_PUBLIC_* env at module load.
export const DEMO_CONSENT_POLICY_VERSION = '2026-07';

export const DEMO_PASSWORD = 'TempleDemo1!';
export const LEFT_MEMBER_COUNT = 4;
export const PENDING_EMAIL_PREFIX = 'pending';

export type DemoConfig = {
  slug: string;
  gymName: string;
  members: number;
  weeksBack: number;
  weeksForward: number;
  historyWeeks: number;
  tz: string;
  seed: number;
  now: Date;
  // Defaults to 'crossfit' — every existing call site (and the
  // deterministic fixtures in plan.test.ts) is unaffected. 'hyrox'
  // reshapes class types, training history, races, store copy and the
  // website into the Hyrox flavour; see the isHyrox branches below.
  discipline?: 'crossfit' | 'hyrox';
  // Overrides DEMO_PASSWORD for every account in the plan. Undefined by
  // every existing call site (and plan.test.ts's fixtures), so behaviour
  // there is unchanged. Exists for the public marketing demo tenant's
  // nightly rotation job, which mints a fresh password on every reseed.
  password?: string;
};

export type DemoUser = {
  id: string;
  email: string;
  fullName: string;
  role: GymRole;
};

export type DemoPlan = {
  config: DemoConfig;
  password: string;
  emailDomain: string;
  users: DemoUser[];
  gym: T<'gyms'>;
  // Ops-only columns the hand-trimmed Insert type deliberately omits;
  // applied by the orchestrator as a separate cast update.
  gymFlags: { store_enabled: boolean; store_shipping_fee_cents: number; website_builder_enabled: boolean };
  memberships: T<'gym_memberships'>[];
  consents: T<'member_consents'>[];
  plans: T<'membership_plans'>[];
  subscriptions: T<'plan_subscriptions'>[];
  invoiceLinks: T<'membership_invoice_links'>[];
  dunning: T<'plan_subscription_dunning'>[];
  classTypes: T<'class_types'>[];
  recurrences: T<'class_recurrences'>[];
  sessions: T<'class_sessions'>[];
  bookings: T<'class_bookings'>[];
  waitlist: T<'class_waitlist'>[];
  workouts: T<'tracked_workouts'>[];
  movementResults: T<'tracked_movement_results'>[];
  hyroxRaces: T<'tracked_hyrox_races'>[];
  hyroxSplits: T<'tracked_hyrox_splits'>[];
  injuries: T<'member_injuries'>[];
  staffAlerts: T<'staff_alerts'>[];
  leadSources: T<'lead_sources'>[];
  leads: T<'leads'>[];
  pendingMembers: T<'pending_members'>[];
  commsSettings: T<'gym_comms_settings'>;
  campaign: T<'email_campaigns'>;
  storeProducts: T<'store_products'>[];
  digitalAssetPath: string;
  website: T<'gym_websites'>;
  gymHours: T<'gym_hours'>[];
  programming: T<'class_programming'>[];
  directMessages: T<'direct_messages'>[];
};

function iso(d: Date): string {
  return d.toISOString();
}

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

// Deep-clone through JSON so jsonb payloads carry no undefineds and no
// class instances — exactly what PostgREST will receive.
function asJson<TVal>(value: TVal): T<'gym_websites'>['design'] {
  return JSON.parse(JSON.stringify(value));
}

export function buildDemoPlan(config: DemoConfig): DemoPlan {
  if (!/^demo-[a-z0-9-]+$/.test(config.slug)) {
    throw new Error(`slug must match demo-[a-z0-9-]+, got "${config.slug}"`);
  }
  if (config.members < 10 || config.members > MAX_MEMBERS) {
    throw new Error(`members must be 10..${MAX_MEMBERS}`);
  }

  const discipline = config.discipline ?? 'crossfit';
  const isHyrox = discipline === 'hyrox';
  const rng = mulberry32(seedFor(config.seed, config.slug));
  const emailDomain = `${config.slug}.temple.test`;
  const gymId = demoUuid(rng);
  const nowISO = iso(config.now);
  const todayISO = nowISO.slice(0, 10);

  // --- users ----------------------------------------------------------------
  const owner: DemoUser = {
    id: demoUuid(rng),
    email: `owner@${emailDomain}`,
    fullName: `${OWNER.first} ${OWNER.last}`,
    role: 'owner',
  };
  const coaches: DemoUser[] = COACHES.map((c, i) => ({
    id: demoUuid(rng),
    email: `coach${i + 1}@${emailDomain}`,
    fullName: `${c.first} ${c.last}`,
    role: 'coach' as const,
  }));
  const members: DemoUser[] = memberNames(config.members).map((n, i) => ({
    id: demoUuid(rng),
    email: `member${String(i + 1).padStart(2, '0')}@${emailDomain}`,
    fullName: `${n.first} ${n.last}`,
    role: 'member' as const,
  }));
  const users = [owner, ...coaches, ...members];
  const leftMembers = members.slice(-LEFT_MEMBER_COUNT);
  const activeMembers = members.slice(0, members.length - LEFT_MEMBER_COUNT);

  // --- gym ------------------------------------------------------------------
  const gym: T<'gyms'> = {
    id: gymId,
    name: config.gymName,
    slug: config.slug,
    timezone: config.tz,
    currency: 'GBP',
    primary_color: '#DC2626',
    public_signup_enabled: true,
    discipline,
  };

  // --- memberships + consents -------------------------------------------------
  const membershipIdByProfile = new Map<string, string>();
  const memberships: T<'gym_memberships'>[] = users.map((u) => {
    const id = demoUuid(rng);
    membershipIdByProfile.set(u.id, id);
    const left = leftMembers.includes(u);
    return {
      id,
      gym_id: gymId,
      profile_id: u.id,
      role: u.role,
      created_at: iso(daysFrom(config.now, -rngInt(rng, 60, 300))),
      left_at: left ? iso(daysFrom(config.now, -rngInt(rng, 14, 42))) : null,
    };
  });
  const consents: T<'member_consents'>[] = [owner, ...coaches, ...activeMembers].map((u) => ({
    gym_id: gymId,
    profile_id: u.id,
    policy_version: DEMO_CONSENT_POLICY_VERSION,
  }));

  // --- plans + subscriptions ---------------------------------------------------
  const unlimitedPlanId = demoUuid(rng);
  const creditPeriodPlanId = demoUuid(rng);
  const creditPackPlanId = demoUuid(rng);
  const plans: T<'membership_plans'>[] = [
    {
      plan_id: unlimitedPlanId,
      gym_id: gymId,
      name: 'Unlimited',
      kind: 'unlimited',
      monthly_price_cents: 7500,
      notice_period_days: 30,
    },
    {
      plan_id: creditPeriodPlanId,
      gym_id: gymId,
      name: '8 Classes / Month',
      kind: 'credit_period',
      credit_count: 8,
      period_length: '1 month',
      monthly_price_cents: 5500,
    },
    {
      plan_id: creditPackPlanId,
      gym_id: gymId,
      name: '10-Class Pack',
      kind: 'credit_pack',
      credit_count: 10,
      monthly_price_cents: 9000,
    },
  ];

  const subscriptions: T<'plan_subscriptions'>[] = [];
  const invoiceLinks: T<'membership_invoice_links'>[] = [];
  const dunning: T<'plan_subscription_dunning'>[] = [];
  activeMembers.forEach((m, i) => {
    const base = {
      gym_membership_id: membershipIdByProfile.get(m.id)!,
      profile_id: m.id,
      gym_id: gymId,
    };
    if (i < Math.ceil(activeMembers.length * 0.7)) {
      // Two of the unlimited members are mid-dunning: a card that has
      // bounced, which is what the At risk tile and the chase list are
      // for. They stay 'active' on purpose — Stripe is still retrying and
      // they can still book (0174) — so a demo shows the grace period
      // rather than an instant lockout.
      const failing = i === 1 || i === 4;
      const subId = failing ? demoUuid(rng) : undefined;
      subscriptions.push({
        ...(subId ? { id: subId } : {}),
        ...base,
        plan_id: unlimitedPlanId,
        status: 'active',
        paid_period_end: iso(daysFrom(config.now, rngInt(rng, 5, 30))),
      });
      if (subId) {
        dunning.push({
          plan_subscription_id: subId,
          profile_id: m.id,
          gym_id: gymId,
          past_due_since: iso(daysFrom(config.now, i === 1 ? -9 : -2)),
          payment_failure_count: i === 1 ? 3 : 1,
          last_payment_error:
            i === 1 ? 'Your card has insufficient funds.' : 'Card declined.',
          // i === 1 has exhausted Stripe's retries — the urgent case.
          next_payment_attempt: i === 1 ? null : iso(daysFrom(config.now, 3)),
        });
      }
      // Without a link the member sees "Speak to the gym" — the weakest
      // state. Seed it so a demo shows the Pay now button that makes the
      // notice actionable.
      if (subId) {
        invoiceLinks.push({
          plan_subscription_id: subId,
          profile_id: m.id,
          gym_id: gymId,
          invoice_url: 'https://invoice.stripe.com/i/demo',
        });
      }
    } else if (i % 2 === 0) {
      subscriptions.push({
        ...base,
        plan_id: creditPackPlanId,
        status: 'active',
        credit_balance: rngInt(rng, 1, 10),
      });
    } else {
      subscriptions.push({
        ...base,
        plan_id: creditPeriodPlanId,
        status: 'active',
        credit_balance: rngInt(rng, 0, 8),
        period_resets_at: iso(daysFrom(config.now, rngInt(rng, 3, 28))),
      });
    }
  });
  for (const m of leftMembers) {
    subscriptions.push({
      gym_membership_id: membershipIdByProfile.get(m.id)!,
      profile_id: m.id,
      gym_id: gymId,
      plan_id: unlimitedPlanId,
      status: 'lapsed',
      cancelled_at: memberships.find((row) => row.profile_id === m.id)?.left_at ?? nowISO,
    });
  }

  // --- timetable -----------------------------------------------------------------
  const startISO = isoDateOffset(todayISO, -config.weeksBack * 7);
  const endISO = isoDateOffset(todayISO, config.weeksForward * 7);
  const classTypeDefs = isHyrox ? CLASS_TYPE_DEFS_HYROX : CLASS_TYPE_DEFS;
  const recurrenceDefs = isHyrox ? RECURRENCE_DEFS_HYROX : RECURRENCE_DEFS;
  const classTypeIdByName = new Map<string, string>();
  const classTypes: T<'class_types'>[] = classTypeDefs.map((def) => {
    const id = demoUuid(rng);
    classTypeIdByName.set(def.name, id);
    return { id, gym_id: gymId, name: def.name, color: def.color };
  });

  const recurrences: T<'class_recurrences'>[] = [];
  const sessions: T<'class_sessions'>[] = [];
  recurrenceDefs.forEach((def, i) => {
    const recurrenceId = demoUuid(rng);
    recurrences.push({
      id: recurrenceId,
      gym_id: gymId,
      class_type_id: classTypeIdByName.get(def.classType)!,
      days_of_week: def.daysOfWeek,
      times: def.times,
      duration_minutes: def.durationMinutes,
      capacity: def.capacity,
      starts_on: startISO,
      tz: config.tz,
      materialized_until: endISO,
      created_by: owner.id,
    });
    const coach = coaches[i % coaches.length];
    for (const occ of expandOccurrences(def, startISO, endISO, config.tz)) {
      sessions.push({
        id: demoUuid(rng),
        gym_id: gymId,
        name: def.classType,
        class_type_id: classTypeIdByName.get(def.classType)!,
        recurrence_id: recurrenceId,
        starts_at: occ.startsAtUtc,
        duration_minutes: def.durationMinutes,
        capacity: def.capacity,
        coach_id: coach.id,
        created_by: owner.id,
      });
    }
  });

  // --- bookings + attendance + waitlist -------------------------------------------
  const propensity = new Map<string, number>();
  for (const m of activeMembers) propensity.set(m.id, 0.25 + rng() * 0.6);

  const bookings: T<'class_bookings'>[] = [];
  const waitlist: T<'class_waitlist'>[] = [];
  const futureSessions = sessions
    .filter((s) => s.starts_at > nowISO)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const spotlightName = isHyrox ? 'Hyrox Simulation' : 'CrossFit';
  const spotlight = futureSessions.find((s) => s.name === spotlightName) ?? futureSessions[0];

  for (const session of sessions) {
    const isPast = session.starts_at <= nowISO;
    const capacity = session.capacity ?? 12;
    const fillTarget =
      session === spotlight
        ? capacity
        : Math.floor(capacity * (isPast ? 0.4 + rng() * 0.5 : 0.3 + rng() * 0.3));
    const takers = activeMembers
      .filter((m) => rng() < propensity.get(m.id)!)
      .slice(0, fillTarget);
    // Top the spotlight session up to exact capacity so the waitlist
    // below is genuinely queued behind a full class.
    if (session === spotlight) {
      for (const m of activeMembers) {
        if (takers.length >= capacity) break;
        if (!takers.includes(m)) takers.push(m);
      }
    }
    for (const m of takers) {
      const bookedAt = new Date(new Date(session.starts_at).getTime() - rngInt(rng, 2, 96) * 3_600_000);
      const roll = rng();
      const attended = isPast && roll < 0.85;
      const noShow = isPast && roll >= 0.92;
      bookings.push({
        id: demoUuid(rng),
        gym_id: gymId,
        class_session_id: session.id!,
        profile_id: m.id,
        created_at: iso(bookedAt),
        attended_at: attended
          ? iso(new Date(new Date(session.starts_at).getTime() + 4 * 60_000))
          : null,
        marked_by: attended || noShow ? coaches[0].id : null,
        no_show: noShow,
        no_show_marked_at: noShow
          ? iso(new Date(new Date(session.starts_at).getTime() + 30 * 60_000))
          : null,
      });
    }
    if (session === spotlight) {
      const queued = activeMembers.filter((m) => !takers.includes(m)).slice(0, 3);
      queued.forEach((m, qi) => {
        waitlist.push({
          gym_id: gymId,
          class_session_id: session.id!,
          profile_id: m.id,
          position: qi + 1,
        });
      });
    }
  }

  // --- training history --------------------------------------------------------------
  const pool = isHyrox ? focusPoolHyrox() : focusPool();
  const trainingMembers = activeMembers.slice(0, Math.min(15, activeMembers.length));
  const workouts: T<'tracked_workouts'>[] = [];
  const movementResults: T<'tracked_movement_results'>[] = [];
  const logDays = [1, 3, 5]; // Mon/Wed/Fri offsets within a week

  for (const m of trainingMembers) {
    const focusCount = rngInt(rng, 3, 4);
    const start = rngInt(rng, 0, Math.max(0, pool.length - focusCount));
    const focuses: FocusScheme[] = pool.slice(start, start + focusCount);
    const perWeek = rngInt(rng, 2, 3);
    const series = focuses.map((f) =>
      progressionSeries(rng, f, config.historyWeeks * perWeek),
    );
    let sessionIndex = 0;
    for (let week = config.historyWeeks - 1; week >= 0; week--) {
      for (let d = 0; d < perWeek; d++) {
        const focusIdx = sessionIndex % focuses.length;
        const focus = focuses[focusIdx];
        const performedAt = daysFrom(config.now, -(week * 7 + (6 - logDays[d % logDays.length])));
        performedAt.setUTCHours(18, 45, 0, 0);
        if (performedAt >= config.now) continue;
        const workoutId = demoUuid(rng);
        const value = series[focusIdx][Math.min(sessionIndex, series[focusIdx].length - 1)];
        workouts.push({
          id: workoutId,
          gym_id: gymId,
          profile_id: m.id,
          performed_at: iso(performedAt),
          title: focus.metric === 'weight' ? 'Strength session' : 'Engine work',
        });
        movementResults.push({
          gym_id: gymId,
          profile_id: m.id,
          workout_id: workoutId,
          movement_key: focus.movementKey,
          track_key: focus.trackKey,
          value_numeric: focus.metric === 'weight' ? value : null,
          value_seconds: focus.metric === 'time' ? value : null,
          value_unit: focus.metric === 'weight' ? 'kg' : null,
          performed_at: iso(performedAt),
        });
        sessionIndex++;
      }
    }
  }

  // --- Hyrox races ----------------------------------------------------------------------
  // A Hyrox-discipline gym races far more of its roster than a
  // CrossFit box that merely offers the odd sim — six racers across
  // both formats and genders populate the station leaderboards for
  // real, not just as a novelty.
  const hyroxRaces: T<'tracked_hyrox_races'>[] = [];
  const hyroxSplits: T<'tracked_hyrox_splits'>[] = [];
  const raceSpecs = isHyrox
    ? [
        { member: trainingMembers[0], length: 'full' as const, gender: 'mens' as const, daysAgo: 12 },
        { member: trainingMembers[1], length: 'half' as const, gender: 'womens' as const, daysAgo: 5 },
        { member: trainingMembers[2], length: 'full' as const, gender: 'womens' as const, daysAgo: 20 },
        { member: trainingMembers[3], length: 'half' as const, gender: 'mens' as const, daysAgo: 8 },
        { member: trainingMembers[4], length: 'full' as const, gender: 'mens' as const, daysAgo: 30 },
        { member: trainingMembers[5], length: 'half' as const, gender: 'womens' as const, daysAgo: 3 },
      ]
    : [
        { member: trainingMembers[0], length: 'full' as const, gender: 'mens' as const, daysAgo: 12 },
        { member: trainingMembers[1], length: 'half' as const, gender: 'womens' as const, daysAgo: 5 },
      ];
  for (const spec of raceSpecs) {
    if (!spec.member) continue;
    const race = buildRace(rng, spec.length, spec.gender);
    const performedAt = daysFrom(config.now, -spec.daysAgo);
    performedAt.setUTCHours(9, 30, 0, 0);
    const workoutId = demoUuid(rng);
    const raceId = demoUuid(rng);
    workouts.push({
      id: workoutId,
      gym_id: gymId,
      profile_id: spec.member.id,
      performed_at: iso(performedAt),
      title: 'Hyrox race simulation',
    });
    movementResults.push({
      gym_id: gymId,
      profile_id: spec.member.id,
      workout_id: workoutId,
      movement_key: HYROX_SIM_MOVEMENT_KEY,
      track_key: race.raceLength,
      value_seconds: race.totalSeconds,
      performed_at: iso(performedAt),
    });
    hyroxRaces.push({
      id: raceId,
      gym_id: gymId,
      profile_id: spec.member.id,
      workout_id: workoutId,
      race_length: race.raceLength,
      race_type: 'singles',
      division: 'open',
      gender_category: race.genderCategory,
      run_total_seconds: race.runTotalSeconds,
      station_total_seconds: race.stationTotalSeconds,
      roxzone_total_seconds: race.roxzoneTotalSeconds,
      total_seconds: race.totalSeconds,
      performed_at: iso(performedAt),
    });
    for (const split of race.splits) {
      hyroxSplits.push({
        gym_id: gymId,
        profile_id: spec.member.id,
        race_id: raceId,
        segment_type: split.segmentType,
        segment_index: split.segmentIndex,
        station_key: split.stationKey ?? null,
        time_seconds: split.seconds ?? 0,
      });
    }
  }

  // Official competition results (HYROX_TIME) — distinct from the
  // training Race Simulation above: no split breakdown, just a real
  // finish time, so that leaderboard bucket has genuine entries too.
  if (isHyrox) {
    const officialSpecs = [
      { member: trainingMembers[0], length: 'full' as const, daysAgo: 45 },
      { member: trainingMembers[2], length: 'full' as const, daysAgo: 60 },
      { member: trainingMembers[1], length: 'half' as const, daysAgo: 50 },
    ];
    for (const spec of officialSpecs) {
      if (!spec.member) continue;
      const performedAt = daysFrom(config.now, -spec.daysAgo);
      performedAt.setUTCHours(9, 0, 0, 0);
      const workoutId = demoUuid(rng);
      workouts.push({
        id: workoutId,
        gym_id: gymId,
        profile_id: spec.member.id,
        performed_at: iso(performedAt),
        title: 'Hyrox race day',
      });
      movementResults.push({
        gym_id: gymId,
        profile_id: spec.member.id,
        workout_id: workoutId,
        movement_key: HYROX_TIME_MOVEMENT_KEY,
        track_key: spec.length,
        value_seconds: officialRaceSeconds(rng, spec.length),
        performed_at: iso(performedAt),
      });
    }
  }

  // --- health -------------------------------------------------------------------------------
  // Region keys from src/lib/injuries.ts BODY_REGIONS; movement keys
  // from the live catalog.
  const injurySpecs = [
    { member: activeMembers[2], region: 'shoulder', side: 'right' as const, pain: 4, status: 'improving' as const, daysAgo: 21, alert: true },
    { member: activeMembers[3], region: 'knee', side: 'left' as const, pain: 6, status: 'active' as const, daysAgo: 9, alert: true },
    { member: activeMembers[4], region: 'lower_back', side: 'na' as const, pain: 2, status: 'resolved' as const, daysAgo: 60, alert: false },
  ];
  const injuries: T<'member_injuries'>[] = [];
  const staffAlerts: T<'staff_alerts'>[] = [];
  for (const spec of injurySpecs) {
    if (!spec.member) continue;
    const id = demoUuid(rng);
    injuries.push({
      id,
      gym_id: gymId,
      profile_id: spec.member.id,
      body_region: spec.region,
      side: spec.side,
      pain_level: spec.pain,
      movements_hurt: isHyrox ? ['hyrox_sled_push'] : ['overhead_squat'],
      movements_ok: isHyrox ? ['hyrox_run', 'hyrox_farmers_carry'] : ['back_squat', 'air_squat'],
      started_on: isoDateOffset(todayISO, -spec.daysAgo),
      status: spec.status,
      resolved_at: spec.status === 'resolved' ? iso(daysFrom(config.now, -7)) : null,
    });
    if (spec.alert) {
      staffAlerts.push({
        gym_id: gymId,
        kind: 'injury_new',
        subject_profile_id: spec.member.id,
        related_id: id,
        created_at: iso(daysFrom(config.now, -spec.daysAgo)),
      });
    }
  }

  // --- CRM ------------------------------------------------------------------------------------
  const sourceDefs = [
    { label: 'Instagram', color: '#E1306C' },
    { label: 'Google', color: '#4285F4' },
    { label: 'Referral', color: '#10B981' },
    { label: 'Walk-in', color: '#F59E0B' },
  ];
  const leadSources: T<'lead_sources'>[] = sourceDefs.map((s) => ({
    id: demoUuid(rng),
    gym_id: gymId,
    label: s.label,
    color: s.color,
  }));
  const leadStatuses = [
    'cold', 'cold', 'contacted', 'contacted', 'intro_booked',
    'intro_booked', 'trial_attended', 'trial_attended', 'converted', 'lost',
  ] as const;
  const leads: T<'leads'>[] = LEAD_NAMES.map((name, i) => {
    const status = leadStatuses[i];
    const capturedAt = iso(daysFrom(config.now, -rngInt(rng, 2, 35)));
    return {
      gym_id: gymId,
      full_name: name,
      email: `lead${i + 1}@${emailDomain}`,
      source_id: leadSources[i % leadSources.length].id!,
      status,
      captured_at: capturedAt,
      captured_by: owner.id,
      converted_at: status === 'converted' ? nowISO : null,
      converted_profile_id: status === 'converted' ? activeMembers[5]?.id ?? null : null,
    };
  });
  const pendingMembers: T<'pending_members'>[] = PENDING_NAMES.map((name, i) => ({
    gym_id: gymId,
    email: `${PENDING_EMAIL_PREFIX}${i + 1}@${emailDomain}`,
    full_name: name,
    plan_name: 'Unlimited',
    tags: ['imported'],
    status: 'pending',
    created_by: owner.id,
  }));

  // --- comms ------------------------------------------------------------------------------------
  const commsSettings: T<'gym_comms_settings'> = {
    gym_id: gymId,
    from_name: config.gymName,
    footer_business_name: config.gymName,
    footer_address: DEMO_ADDRESS.replace(/\n/g, ', '),
    updated_by: owner.id,
  };
  // Template/starter builders mint time-based block ids; rewrite them
  // so the same seed yields a byte-identical plan.
  const emailDesign = starterDocument({ ...FALLBACK_BRAND_SEED, primaryColor: '#DC2626' });
  emailDesign.blocks = emailDesign.blocks.map((b, i) => ({ ...b, id: `eb_demo${i + 1}` }));
  const campaign: T<'email_campaigns'> = {
    gym_id: gymId,
    created_by: owner.id,
    title: isHyrox ? 'Race day countdown' : 'March programme preview',
    subject: isHyrox
      ? `Race day is close — get ready at ${config.gymName}`
      : `Big week coming up at ${config.gymName}`,
    preheader: isHyrox
      ? 'Two new compromised-running slots, plus this Saturday’s full Hyrox simulation.'
      : 'New cycle, two new class slots, and a Hyrox sim on Saturday.',
    // Left as a draft on purpose — the campaign builder, its preview
    // and its send-gate are meant to be explored from an unfinished
    // state, not demoed as a fait accompli.
    status: 'draft',
    design: asJson(emailDesign),
    audience: asJson({ kind: 'all_members' }),
  };

  // --- store + website ----------------------------------------------------------------------------
  const digitalAssetPath = `${gymId}/12-week-engine-programme.pdf`;
  const storeProducts: T<'store_products'>[] = isHyrox
    ? [
        {
          gym_id: gymId,
          name: 'Race Vest',
          description: 'Compression vest built for Hyrox race day.',
          kind: 'physical',
          price_cents: 3600,
          track_inventory: true,
          stock_quantity: 20,
          created_by: owner.id,
        },
        {
          gym_id: gymId,
          name: 'Sled Glide Gloves',
          description: 'Grip and palm protection for sled pushes, pulls and farmers carries.',
          kind: 'physical',
          price_cents: 1800,
          track_inventory: true,
          stock_quantity: 35,
          created_by: owner.id,
        },
        {
          gym_id: gymId,
          name: '12-Week Hyrox Prep Programme',
          description: 'A downloadable race-prep block written by our coaches.',
          kind: 'digital',
          price_cents: 4200,
          track_inventory: false,
          digital_asset_path: digitalAssetPath,
          created_by: owner.id,
        },
        // Deliberately hidden from the storefront — demos the
        // active/inactive toggle staff use while a product is still
        // being priced or photographed.
        {
          gym_id: gymId,
          name: 'Finisher Tee — coming soon',
          description: 'Limited-run race-day finisher tee. Not live yet — stock still being confirmed.',
          kind: 'physical',
          price_cents: 2500,
          track_inventory: true,
          stock_quantity: 0,
          active: false,
          created_by: owner.id,
        },
      ]
    : [
        {
          gym_id: gymId,
          name: 'Ironworks Tee',
          description: 'Heavyweight cotton, gym logo front and back.',
          kind: 'physical',
          price_cents: 2200,
          track_inventory: true,
          stock_quantity: 25,
          created_by: owner.id,
        },
        {
          gym_id: gymId,
          name: 'Shaker Bottle',
          description: '700ml, leak-proof, dishwasher safe.',
          kind: 'physical',
          price_cents: 1200,
          track_inventory: true,
          stock_quantity: 40,
          created_by: owner.id,
        },
        {
          gym_id: gymId,
          name: '12-Week Engine Programme',
          description: 'A downloadable conditioning block written by our coaches.',
          kind: 'digital',
          price_cents: 3900,
          track_inventory: false,
          digital_asset_path: digitalAssetPath,
          created_by: owner.id,
        },
      ];

  // The strength/forged template + theme already covers "Strength,
  // CrossFit, Hyrox" (see brand-themes.ts's tagline for 'forged'), so
  // both disciplines reuse it — only the copy and publish state differ.
  const siteDoc = SITE_TEMPLATES.strength.build(config.gymName);
  // build() mints time-based page ids and block ids (same reason
  // home's block ids get rewritten below) — pin every page's id and its
  // one block's id so the same seed yields a byte-identical plan.
  const homePage = { ...siteDoc.pages[0], id: 'sp_demo_home' };
  // Each of these pages now carries an intro about block plus its
  // live-data block, so ids are suffixed by index to stay unique (and
  // deterministic for a byte-identical plan across runs).
  const schedulePage = {
    ...siteDoc.pages[1],
    id: 'sp_demo_schedule',
    blocks: siteDoc.pages[1].blocks.map((b, i) => ({ ...b, id: `sb_demo_schedule_${i + 1}` })),
  };
  const teamPage = {
    ...siteDoc.pages[2],
    id: 'sp_demo_team',
    blocks: siteDoc.pages[2].blocks.map((b, i) => ({ ...b, id: `sb_demo_team_${i + 1}` })),
  };
  const pricingPage = {
    ...siteDoc.pages[3],
    id: 'sp_demo_pricing',
    blocks: siteDoc.pages[3].blocks.map((b, i) => ({ ...b, id: `sb_demo_pricing_${i + 1}` })),
  };
  const patchedBlocks = homePage.blocks.map((raw, i) => {
    const block = { ...raw, id: `sb_demo${i + 1}` };
    if (block.type === 'hero' && isHyrox) {
      return {
        ...block,
        subheadline:
          'Race-day conditioning, coached compromised running and real Hyrox simulations — book a free session and feel what race pace costs.',
      };
    }
    if (block.type === 'about' && isHyrox) {
      return {
        ...block,
        heading: 'Built for race day',
        body: 'We coach for one outcome: crossing the finish line faster than you thought possible. Every session blends strength, compromised running and the eight Hyrox stations, programmed by coaches who race themselves. Whether this is your first Hyrox or your tenth, we will build the engine and the technique to get you there.',
      };
    }
    if (block.type === 'testimonials') {
      // A Hyrox-discipline site is seeded mid-setup on purpose — no
      // quotes yet — so the Publish flow's own "add real quotes"
      // warning is something to actually see, not just read about.
      if (isHyrox) return block;
      return {
        ...block,
        quotes: TESTIMONIAL_QUOTES.map((q, i) => ({ id: `q_demo${i + 1}`, quote: q.quote, name: q.name })),
      };
    }
    if (block.type === 'location') {
      // Same deliberate gap as testimonials above — no address yet.
      if (isHyrox) return block;
      return { ...block, address: DEMO_ADDRESS, hours: DEMO_HOURS_TEXT };
    }
    return block;
  });
  // A gallery with one photo missing its description — triggers the
  // "add a description" publish warning alongside the empty
  // testimonials/location blocks, so a Hyrox-discipline demo shows the
  // site builder mid-draft rather than only ever finished and live.
  const blocksWithGallery = isHyrox
    ? (() => {
        const gallery = {
          id: 'sb_demo_gallery',
          type: 'gallery' as const,
          heading: 'Inside the box',
          images: [
            {
              id: 'g_demo1',
              url: 'https://picsum.photos/seed/hyrox-gym-1/900/600',
              alt: 'Members mid-sled-push during a Saturday Hyrox simulation',
            },
            { id: 'g_demo2', url: 'https://picsum.photos/seed/hyrox-gym-2/900/600', alt: '' },
          ],
        };
        const locationIdx = patchedBlocks.findIndex((b) => b.type === 'location');
        return [
          ...patchedBlocks.slice(0, locationIdx),
          gallery,
          ...patchedBlocks.slice(locationIdx),
        ];
      })()
    : patchedBlocks;
  const website: T<'gym_websites'> = {
    gym_id: gymId,
    theme: SITE_TEMPLATES.strength.themeId,
    design: asJson({
      ...siteDoc,
      pages: [{ ...homePage, blocks: blocksWithGallery }, schedulePage, teamPage, pricingPage],
    }),
    // A CrossFit demo ships live so the public site is something to
    // see immediately; the Hyrox demo stays unpublished so the site
    // builder's draft state — warnings, the disabled-until-ready
    // Publish button — is part of what gets demoed.
    published: !isHyrox,
  };

  const gymHours: T<'gym_hours'>[] = GYM_HOURS.map(([day, opens, closes]) => ({
    gym_id: gymId,
    day_of_week: day,
    opens_at: opens,
    closes_at: closes,
  }));

  // --- programming -----------------------------------------------------------------------------------
  // The Programming tab (first nav item on both sides) was previously
  // seeded empty. One row per class-type-per-date it actually ran,
  // cycling through a small hand-authored rotation — "Open Gym" is
  // deliberately excluded on both disciplines (free-training, not a
  // programmed class).
  const programming = buildProgrammingRows(
    sessions,
    classTypeIdByName,
    gymId,
    owner.id,
    isHyrox ? HYROX_WOD_TEMPLATES : CROSSFIT_WOD_TEMPLATES,
  );

  // --- DMs -----------------------------------------------------------------------------------------
  const directMessages: T<'direct_messages'>[] = [];
  DM_SCRIPTS.forEach((script, ti) => {
    const member = activeMembers[6 + ti];
    if (!member) return;
    const coach = coaches[script.coachIndex];
    const threadStart = daysFrom(config.now, -(3 - ti)).getTime();
    script.lines.forEach((line, li) => {
      const isLast = li === script.lines.length - 1;
      directMessages.push({
        gym_id: gymId,
        sender_id: line.dir === 'in' ? member.id : coach.id,
        recipient_id: line.dir === 'in' ? coach.id : member.id,
        body: line.body,
        created_at: iso(new Date(threadStart + li * 9 * 60_000)),
        read_at: isLast ? null : iso(new Date(threadStart + (li + 1) * 9 * 60_000)),
      });
    });
  });

  return {
    config,
    password: config.password ?? DEMO_PASSWORD,
    emailDomain,
    users,
    gym,
    gymFlags: { store_enabled: true, store_shipping_fee_cents: 500, website_builder_enabled: true },
    memberships,
    consents,
    plans,
    subscriptions,
    invoiceLinks,
    dunning,
    classTypes,
    recurrences,
    sessions,
    bookings,
    waitlist,
    workouts,
    movementResults,
    hyroxRaces,
    hyroxSplits,
    injuries,
    staffAlerts,
    leadSources,
    leads,
    pendingMembers,
    commsSettings,
    campaign,
    storeProducts,
    digitalAssetPath,
    website,
    gymHours,
    programming,
    directMessages,
  };
}
