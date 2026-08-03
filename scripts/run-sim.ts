// The clock for the demo gym. The seeder builds a believable morning and
// freezes it; this replays weeks of simulated activity into that gym and
// then runs the real tick RPCs, so every proposal on the Timeline was
// produced by a job deciding something — not written by a seeder in the
// shape a tick writes.
//
//   npm run sim -- --days 56 --seed 2026            # against local stack
//   npm run sim -- --dry-run                        # plan + predictions, no writes
//   npm run sim -- --tick-only                      # just run the ticks + report
//
// Against hosted: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and pass
// --yes. Same safety rails as the seeder: the slug must start with
// "demo-", and a run dirties the gym — teardown + re-seed is the reset.
//
// The ticks are `revoke ... from public, anon, authenticated`, so the
// service role is the one principal that can call them outside cron —
// exactly how the seeder already writes the agent tables.

import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../src/types/database';
import { rng } from './demo-gym/simulate';
import { demoUuid } from './demo-gym/roster';
import {
  buildCast,
  buildWritePlan,
  predictClassReturn,
  runSimulation,
  sessionKey,
  simWindow,
  toSimSessions,
  type RosterMember,
  type SlotDef,
} from './demo-gym/runner';

type Client = SupabaseClient<Database>;

const LOCAL_URL = 'http://127.0.0.1:54321';
const BATCH = 500;

const ALL_KINDS = [
  'chase_message',
  'plan_adjustment_offer',
  'retention_message',
  'cover_ask',
  'first_week_message',
  'credits_low_message',
  'plan_upgrade_offer',
  'class_return_message',
];

const TICKS = [
  'agent_revenue_tick',
  'agent_retention_tick',
  'agent_cover_tick',
  'agent_first_week_tick',
  'agent_credits_low_tick',
  'agent_plan_upgrade_tick',
  'agent_class_return_tick',
] as const;

// Matches what set_class_return_job seeds (0246) — the one job the demo
// seeder predates, so a seeded gym is missing its authority row and the
// headline job would silently never run.
const CLASS_RETURN_TEMPLATE =
  "Hi {first_name} — it's {gym_name}. We haven't seen you at " +
  "{class_name} for a few weeks and wanted to say the spot's " +
  'still there if you fancy it. If the time has stopped working, ' +
  "reply and tell us — we'd rather know.";

function fail(message: string): never {
  console.error(`run-sim: ${message}`);
  process.exit(1);
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

// Mirrors seed-demo-gym.ts: local keys come from `supabase status`.
function localServiceKey(): string {
  try {
    const out = execSync('supabase status -o env', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const pairs = new Map<string, string>();
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)="(.*)"$/);
      if (m) pairs.set(m[1], m[2]);
    }
    const key = pairs.get('SERVICE_ROLE_KEY') ?? pairs.get('SECRET_KEY');
    if (!key) throw new Error('no key in status output');
    return key;
  } catch {
    return fail(
      'could not derive the local service-role key from `supabase status`. Is the local stack running (npm run dev)? Otherwise set SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
}

async function fetchAll<Row>(
  query: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) fail(`query failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function insertAll(sb: Client, table: string, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await (sb.from as (t: string) => ReturnType<Client['from']>)(table).insert(
      rows.slice(i, i + BATCH) as never,
      { defaultToNull: false },
    );
    if (error) fail(`insert into ${table} failed: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string', default: 'demo-ironworks' },
      days: { type: 'string', default: '56' },
      seed: { type: 'string', default: '2026' },
      'dry-run': { type: 'boolean', default: false },
      'tick-only': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
  });
  const slug = values.slug!;
  if (!/^demo-[a-z0-9-]+$/.test(slug)) {
    fail(`slug must match demo-[a-z0-9-]+ (got "${slug}") — the demo- prefix is the safety rail.`);
  }

  const url = process.env.SUPABASE_URL ?? LOCAL_URL;
  const local = isLocalUrl(url);
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!local) {
    if (!key) fail(`non-local target ${url} requires an explicit SUPABASE_SERVICE_ROLE_KEY.`);
    if (!values.yes) fail(`refusing to touch non-local target ${url} without --yes.`);
  }
  if (!key) key = localServiceKey();

  console.log(`Target: ${url}${local ? ' (local stack)' : ''}`);
  const sb: Client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: gym } = await sb
    .from('gyms')
    .select('id, name, timezone, onboarding_dismissed_at')
    .eq('slug', slug)
    .maybeSingle();
  if (!gym) fail(`no gym with slug "${slug}" — run npm run seed:demo first.`);

  // A gym with weeks of history is not a day-one gym: without this flag
  // the owner's sign-in redirects to /setup (the Stripe step never
  // completes on a demo tenant) and the Timeline the sim exists to fill
  // is never reached.
  if (!values['dry-run'] && !gym.onboarding_dismissed_at) {
    const { error } = await sb
      .from('gyms')
      .update({ onboarding_dismissed_at: new Date().toISOString() } as never)
      .eq('id', gym.id);
    if (error) fail(`marking onboarding dismissed failed: ${error.message}`);
    console.log('Marked day-one onboarding dismissed — this gym has history now.');
  }
  const tz = gym.timezone ?? 'Europe/London';
  const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const runStart = new Date().toISOString();

  // ---- the roster ---------------------------------------------------------
  const memberships = await fetchAll<{
    profile_id: string; role: string; left_at: string | null; created_at: string;
  }>((a, b) =>
    sb.from('gym_memberships').select('profile_id, role, left_at, created_at').eq('gym_id', gym.id).range(a, b),
  );
  const staff = memberships.filter((m) => m.left_at === null && m.role !== 'member');
  const ownerId = staff.find((m) => m.role === 'owner')?.profile_id;
  if (!ownerId) fail('gym has no owner membership.');
  const coachIds = staff.filter((m) => m.role === 'coach').map((m) => m.profile_id);
  const activeMembers = memberships.filter((m) => m.left_at === null && m.role === 'member');

  const profiles = await fetchAll<{ id: string; full_name: string | null }>((a, b) =>
    sb.from('profiles').select('id, full_name').in('id', activeMembers.map((m) => m.profile_id)).range(a, b),
  );
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name ?? 'Member']));

  const pending = await fetchAll<{ linked_profile_id: string | null }>((a, b) =>
    sb.from('pending_members').select('linked_profile_id').eq('gym_id', gym.id).range(a, b),
  );
  const imported = new Set(pending.map((p) => p.linked_profile_id).filter(Boolean));

  const attendedEver = await fetchAll<{ profile_id: string }>((a, b) =>
    sb.from('class_bookings').select('profile_id').eq('gym_id', gym.id).not('attended_at', 'is', null).range(a, b),
  );
  const hasAttended = new Set(attendedEver.map((r) => r.profile_id));

  // ---- the timetable ------------------------------------------------------
  const types = await fetchAll<{ id: string; name: string; archived_at: string | null }>((a, b) =>
    sb.from('class_types').select('id, name, archived_at').eq('gym_id', gym.id).range(a, b),
  );
  const typeName = new Map(types.filter((t) => !t.archived_at).map((t) => [t.id, t.name]));

  const recurrences = await fetchAll<{
    id: string; class_type_id: string; days_of_week: number[]; times: string[];
    duration_minutes: number; capacity: number;
  }>((a, b) =>
    sb.from('class_recurrences')
      .select('id, class_type_id, days_of_week, times, duration_minutes, capacity')
      .eq('gym_id', gym.id).range(a, b),
  );
  const slots: SlotDef[] = recurrences.flatMap((r) =>
    typeName.has(r.class_type_id)
      ? r.days_of_week.flatMap((dow) =>
          r.times.map((time) => ({
            recurrenceId: r.id,
            classTypeId: r.class_type_id,
            className: typeName.get(r.class_type_id)!,
            dow,
            time,
            capacity: r.capacity,
            durationMinutes: r.duration_minutes,
          })),
        )
      : [],
  );
  if (slots.length === 0) fail('gym has no recurrences to simulate against.');

  const { startISO, totalDays } = simWindow(todayISO, Number(values.days));
  console.log(`Window: ${startISO} .. yesterday (${totalDays} days, tz ${tz})`);

  const existingSessionRows = await fetchAll<{ id: string; class_type_id: string | null; starts_at: string }>((a, b) =>
    sb.from('class_sessions').select('id, class_type_id, starts_at')
      .eq('gym_id', gym.id).gte('starts_at', `${startISO}T00:00:00Z`).lt('starts_at', runStart).range(a, b),
  );
  const existingSessions = new Map(
    existingSessionRows
      .filter((s) => s.class_type_id !== null)
      .map((s) => [sessionKey(s.starts_at, s.class_type_id!), s.id]),
  );
  const windowSessionIds = existingSessionRows.map((s) => s.id);
  const existingBookings = new Set<string>();
  for (let i = 0; i < windowSessionIds.length; i += 200) {
    const chunk = windowSessionIds.slice(i, i + 200);
    const rows = await fetchAll<{ class_session_id: string; profile_id: string }>((a, b) =>
      sb.from('class_bookings').select('class_session_id, profile_id').in('class_session_id', chunk).range(a, b),
    );
    for (const r of rows) existingBookings.add(`${r.class_session_id}@${r.profile_id}`);
  }

  const subs = await fetchAll<{ id: string; profile_id: string }>((a, b) =>
    sb.from('plan_subscriptions').select('id, profile_id').eq('gym_id', gym.id).eq('status', 'active').range(a, b),
  );
  const subscriptionByProfile = new Map(subs.map((s) => [s.profile_id, s.id]));

  // ---- jobs on the rope ---------------------------------------------------
  const authority = await fetchAll<{ action_kind: string; level: string }>((a, b) =>
    sb.from('agent_authority').select('action_kind, level').eq('gym_id', gym.id).range(a, b),
  );
  const haveKind = new Set(authority.map((a) => a.action_kind));
  const missingKinds = ALL_KINDS.filter((k) => !haveKind.has(k));
  if (!values['dry-run'] && missingKinds.length > 0) {
    await insertAll(sb, 'agent_authority', missingKinds.map((k) => ({
      gym_id: gym.id, action_kind: k, level: 'approval', updated_by: ownerId,
    })));
    console.log(`Authority added at "approval": ${missingKinds.join(', ')}`);
  }
  const templates = await fetchAll<{ kind: string }>((a, b) =>
    sb.from('agent_message_templates').select('kind').eq('gym_id', gym.id).range(a, b),
  );
  const haveTemplate = new Set(templates.map((t) => t.kind));
  if (!values['dry-run'] && !haveTemplate.has('class_return_message')) {
    await insertAll(sb, 'agent_message_templates', [{
      gym_id: gym.id, kind: 'class_return_message', body: CLASS_RETURN_TEMPLATE, approved_by: ownerId,
    }]);
  }

  // ---- simulate + write ---------------------------------------------------
  if (!values['tick-only']) {
    const next = rng(Number(values.seed));
    const roster: RosterMember[] = activeMembers.map((m) => ({
      profileId: m.profile_id,
      name: nameById.get(m.profile_id) ?? 'Member',
      joinedAtISO: m.created_at,
      importLinked: imported.has(m.profile_id),
      hasAttendedEver: hasAttended.has(m.profile_id),
    }));
    const { cast, redates, clearBookingsFor } = buildCast(roster, todayISO, startISO, next);
    const days = runSimulation(cast, toSimSessions(slots), totalDays, next);
    const plan = buildWritePlan(days, slots, {
      gymId: gym.id,
      tz,
      ownerId,
      coachIds: coachIds.length > 0 ? coachIds : [ownerId],
      todayISO,
      windowStartISO: startISO,
      existingSessions,
      existingBookings,
      subscriptionByProfile,
      uuid: () => demoUuid(next),
      rng: next,
    });

    const counts = [
      `${plan.sessions.length} session(s) to create`,
      `${plan.bookings.length} booking(s)`,
      `${plan.dunning.length} dunning row(s)`,
      `${redates.length} join date(s) moved into the first-week window`,
      `${plan.skippedExistingBookings} booking(s) already seeded`,
    ];
    console.log(`Plan: ${counts.join(', ')}`);

    console.log('\nWhat the sim expects of the class-return job:');
    for (const p of predictClassReturn(days, slots, todayISO, startISO)) {
      const was = p.earlier ? p.earlier.average.toFixed(1) : '—';
      const now = p.recent ? p.recent.average.toFixed(1) : '—';
      console.log(`  ${p.wouldFire ? 'FIRE ' : 'quiet'}  ${p.label}  ${was} -> ${now}`);
    }

    if (values['dry-run']) {
      console.log('\nDry run — nothing written, no ticks run.');
      return;
    }

    for (const r of redates) {
      const { error } = await sb.from('gym_memberships')
        .update({ created_at: `${r.newJoinISO}T09:00:00Z` } as never)
        .eq('gym_id', gym.id).eq('profile_id', r.profileId);
      if (error) fail(`re-dating join failed: ${error.message}`);
    }
    if (clearBookingsFor.length > 0) {
      const { error } = await sb.from('class_bookings').delete()
        .eq('gym_id', gym.id).in('profile_id', clearBookingsFor);
      if (error) fail(`clearing history for re-dated joiners failed: ${error.message}`);
      console.log(`Cleared seeded bookings for ${clearBookingsFor.length} re-dated joiner(s).`);
    }
    await insertAll(sb, 'class_sessions', plan.sessions);
    await insertAll(sb, 'class_bookings', plan.bookings);
    for (const d of plan.dunning) {
      const { error } = await (sb.from as (t: string) => ReturnType<Client['from']>)('plan_subscription_dunning')
        .upsert(d as never, { onConflict: 'plan_subscription_id' });
      if (error) fail(`dunning upsert failed: ${error.message}`);
    }
    console.log('Written.');
  }

  // ---- the ticks ----------------------------------------------------------
  // Provenance by identity, not by timestamp: the seeder stamps some
  // fixture proposals at fixed clock times later today, so a
  // proposed_at >= runStart filter claimed a seeded card as this run's
  // work on the first hosted run (and the 180-day dedup then made the
  // real tick look silently broken).
  const beforeIds = new Set(
    (
      await fetchAll<{ id: string }>((a, b) =>
        sb.from('agent_actions').select('id').eq('gym_id', gym.id).range(a, b),
      )
    ).map((r) => r.id),
  );

  console.log('\nTicks:');
  for (const tick of TICKS) {
    const { data, error } = await sb.rpc(tick as never);
    if (error) console.log(`  ${tick}: ERROR ${error.message}`);
    else console.log(`  ${tick}: ${JSON.stringify(data)}`);
  }

  // ---- what the jobs decided ---------------------------------------------
  const allActions = await fetchAll<{
    id: string; action_kind: string; status: string; payload: Json; evidence: Json;
  }>((a, b) =>
    sb.from('agent_actions').select('id, action_kind, status, payload, evidence')
      .eq('gym_id', gym.id).order('action_kind').range(a, b),
  );
  const actions = allActions.filter((a) => !beforeIds.has(a.id));
  console.log(`\nProposals from this run (${actions.length}):`);
  for (const a of actions) {
    const p = (a.payload ?? {}) as Record<string, unknown>;
    const who =
      (p.member_name as string) ?? (p.slot_label as string) ?? (p.class_name as string) ?? '';
    console.log(`  [${a.status}] ${a.action_kind}  ${who}`);
    const evidence = Array.isArray(a.evidence) ? (a.evidence as string[]) : [];
    for (const line of evidence.slice(0, 2)) console.log(`      ${line}`);
  }
  if (actions.length === 0) {
    console.log('  none — either the gym is healthy or a predicate never matched. Compare with the predictions above.');
  }

  // agent_deferrals is cron-written and not in the hand-trimmed types, so
  // read it through an untyped client view.
  const { data: deferrals } = await (sb as SupabaseClient).from('agent_deferrals')
    .select('on_day, held').eq('gym_id', gym.id).eq('on_day', todayISO);
  for (const d of (deferrals ?? []) as { on_day: string; held: number }[]) {
    console.log(`\nHeld back by the ask budget today: ${d.held}`);
  }

  console.log(`\nSign in as the owner and read the Timeline — that is the test.`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
