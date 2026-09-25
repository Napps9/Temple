// Demo-gym seeder. Creates a believable, fully-populated demo tenant
// with real signable-in accounts, or tears one down again.
//
//   npm run seed:demo                         # seed against local stack
//   npm run seed:demo -- --dry-run            # print the plan, no network
//   npm run seed:demo -- --teardown           # remove gym + demo users
//
// Against hosted: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and pass
// --yes. Full runbook: docs/demo-gym.md.
//
//   npm run seed:demo -- --owner you@example.com --yes   # into your own gym
//
// --owner seeds the same content into a gym that already exists and that
// account owns, keeping the real owner: coaches, members and everything
// they did are created around them. Teardown with --owner empties the gym
// again and removes the seeded accounts, leaving the gym and its owner.
//
// Safety model: a demo gym's slug must start with "demo-", every created
// account lives on @<slug>.temple.test (IANA-reserved, mail can never
// route), and teardown only deletes auth users it collected from the
// gym's own memberships whose email is on that exact domain.

import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../src/types/database';
import { backdatedCreatedAt, pickOwnedGym, withoutOwnerRows, type OwnedGym } from './demo-gym/attach';
import { buildDemoPlan, type DemoPlan } from './demo-gym/plan';
import { countWaiting } from './demo-gym/jobs';

type Client = SupabaseClient<Database>;

// The gym being seeded into with --owner: the real gym row and the real
// account that owns it, which the plan's placeholders are remapped onto.
type AttachTarget = { gym: OwnedGym; ownerId: string; ownerEmail: string };

const LOCAL_URL = 'http://127.0.0.1:54321';
const BATCH = 500;

// What an attached teardown empties, children before parents because none
// of this is reached by a cascade from gyms — the gym row stays. Cover
// requests are not seeded, but a demo raises them (the coach asks for
// cover) and their coach columns reference profiles without a cascade, so
// they would block deleting the coach accounts below.
const ATTACHED_CONTENT_TABLES = [
  'agent_actions',
  'agent_message_templates',
  'agent_authority',
  'direct_messages',
  'cover_request_sessions',
  'cover_requests',
  'class_programming',
  'store_products',
  'gym_hours',
  'email_campaigns',
  'gym_comms_settings',
  'pending_members',
  'leads',
  'lead_sources',
  'staff_alerts',
  'member_injuries',
  'tracked_hyrox_splits',
  'tracked_hyrox_races',
  'tracked_movement_results',
  'tracked_workouts',
  'class_waitlist',
  'class_bookings',
  'class_sessions',
  'class_recurrences',
  'class_types',
  'plan_subscription_dunning',
  'membership_invoice_links',
  'plan_subscriptions',
  'membership_plans',
];

// The tables a seed fills that an attached seed cannot share with content
// already in the gym: class_types and lead_sources are unique per name,
// and a second timetable or plan catalogue on top of an existing one is a
// gym nobody would recognise.
const ATTACHED_MUST_BE_EMPTY = ['class_types', 'class_sessions', 'membership_plans', 'lead_sources'];

// Tiny but valid single-page PDF for the demo digital product.
const DEMO_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj',
  'trailer<</Size 4/Root 1 0 R>>',
  '%%EOF',
].join('\n');

function fail(message: string): never {
  console.error(`seed-demo-gym: ${message}`);
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

// Mirrors scripts/dev.mjs: the local stack's keys come from
// `supabase status -o env` rather than being hardcoded, so CLI key
// rotations don't strand the seeder.
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

// Table names are validated by the typed plan; the union of every seeded
// table is unwieldy as a generic, so the writes below go untyped.
function table(sb: Client, name: string): ReturnType<Client['from']> {
  return (sb.from as (t: string) => ReturnType<Client['from']>)(name);
}

// onConflict turns the insert into an upsert on that key. The gym-level
// singletons (hours, comms settings, agent authority and templates) go
// this way so an attached seed can land on a gym that already holds a row
// for them; on a fresh gym it is a plain insert. ignoreDuplicates keeps
// the existing row instead of overwriting it — consents, where the real
// owner's own agreement must not be re-dated.
async function insertAll<TRow>(
  sb: Client,
  name: string,
  rows: TRow[],
  conflict?: { onConflict: string; ignoreDuplicates?: boolean },
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // defaultToNull: false — rows in one batch have differing key
    // sets, and PostgREST otherwise fills the gaps with NULL instead
    // of the column default (bit us on store_products.track_inventory).
    const { error } = conflict
      ? await table(sb, name).upsert(chunk as never, {
          onConflict: conflict.onConflict,
          ignoreDuplicates: conflict.ignoreDuplicates ?? false,
          defaultToNull: false,
        })
      : await table(sb, name).insert(chunk as never, { defaultToNull: false });
    if (error) {
      fail(`insert into ${name} failed: ${error.message}\nPartial seed left behind — run --teardown, then re-seed.`);
    }
  }
}

async function listDemoUsers(sb: Client, emailDomain: string): Promise<{ id: string; email: string }[]> {
  const found: { id: string; email: string }[] = [];
  for (let page = 1; page <= 40; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      if (u.email?.endsWith(`@${emailDomain}`)) found.push({ id: u.id, email: u.email });
    }
    if (data.users.length < 1000) break;
  }
  return found;
}

// GoTrue's admin API has no lookup by email; the same page walk
// listDemoUsers does, stopping at the first match.
async function findUserByEmail(sb: Client, email: string): Promise<{ id: string; email: string } | null> {
  for (let page = 1; page <= 40; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit?.email) return { id: hit.id, email: hit.email };
    if (data.users.length < 1000) break;
  }
  return null;
}

async function resolveOwnedGym(sb: Client, email: string, slug: string | undefined): Promise<AttachTarget> {
  const user = await findUserByEmail(sb, email);
  if (!user) return fail(`no account is signed up as ${email}.`);
  const { data: memberships, error: mErr } = await sb
    .from('gym_memberships')
    .select('gym_id')
    .eq('profile_id', user.id)
    .eq('role', 'owner')
    .is('left_at', null);
  if (mErr) fail(`reading memberships failed: ${mErr.message}`);
  const gymIds = (memberships ?? []).map((m) => m.gym_id);
  let gyms: OwnedGym[] = [];
  if (gymIds.length > 0) {
    const { data, error } = await sb
      .from('gyms')
      .select('id, slug, name, timezone, currency, created_at')
      .in('id', gymIds);
    if (error) fail(`reading gyms failed: ${error.message}`);
    gyms = data ?? [];
  }
  try {
    return { gym: pickOwnedGym(gyms, slug), ownerId: user.id, ownerEmail: user.email };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// The demo accounts reachable from this gym's memberships. Two guards:
// only users reached via the gym's own memberships, and of those only
// emails on the exact reserved domain — a real user who joined the demo
// gym survives.
async function collectDemoAccounts(sb: Client, gymId: string, emailDomain: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const { data: memberships } = await sb.from('gym_memberships').select('profile_id').eq('gym_id', gymId);
  for (const m of memberships ?? []) {
    const { data } = await sb.auth.admin.getUserById(m.profile_id);
    const email = data.user?.email;
    if (!email) continue;
    if (email.endsWith(`@${emailDomain}`)) found.set(m.profile_id, email);
    else console.warn(`  skipping non-demo account ${email}`);
  }
  return found;
}

async function countRows(sb: Client, name: string, gymId: string): Promise<number> {
  const { count, error } = await table(sb, name).select('*', { count: 'exact', head: true }).eq('gym_id', gymId);
  if (error) fail(`counting ${name} failed: ${error.message}`);
  return count ?? 0;
}

function printCounts(plan: DemoPlan): void {
  const rows: [string, number][] = [
    ['auth users / profiles', plan.users.length],
    ['gym_memberships', plan.memberships.length],
    ['member_consents', plan.consents.length],
    ['membership_plans', plan.plans.length],
    ['plan_subscriptions', plan.subscriptions.length],
    ['membership_invoice_links', plan.invoiceLinks.length],
    ['plan_subscription_dunning', plan.dunning.length],
    ['class_types', plan.classTypes.length],
    ['class_recurrences', plan.recurrences.length],
    ['class_sessions', plan.sessions.length],
    ['class_bookings', plan.bookings.length],
    ['class_waitlist', plan.waitlist.length],
    ['tracked_workouts', plan.workouts.length],
    ['tracked_movement_results', plan.movementResults.length],
    ['tracked_hyrox_races', plan.hyroxRaces.length],
    ['tracked_hyrox_splits', plan.hyroxSplits.length],
    ['member_injuries', plan.injuries.length],
    ['staff_alerts', plan.staffAlerts.length],
    ['lead_sources', plan.leadSources.length],
    ['leads', plan.leads.length],
    ['pending_members', plan.pendingMembers.length],
    ['email_campaigns', 1],
    ['store_products', plan.storeProducts.length],
    ['gym_hours', plan.gymHours.length],
    ['class_programming', plan.programming.length],
    ['direct_messages', plan.directMessages.length],
    ['agent_authority', plan.agentAuthority.length],
    ['agent_message_templates', plan.agentTemplates.length],
    ['agent_actions', plan.agentActions.length],
  ];
  const width = Math.max(...rows.map(([n]) => n.length));
  for (const [name, count] of rows) console.log(`  ${name.padEnd(width)}  ${count}`);
}

function printCredentials(plan: DemoPlan, into: AttachTarget | null): void {
  const members = plan.users.filter((u) => u.role === 'member');
  console.log('');
  console.log(`Gym:      ${plan.gym.name}  (slug ${plan.gym.slug})`);
  if (into) console.log(`Owner:    ${into.ownerEmail}  (your own password)`);
  else console.log(`Owner:    owner@${plan.emailDomain}`);
  console.log(`Coaches:  coach1@${plan.emailDomain}  coach2@${plan.emailDomain}`);
  console.log(`Members:  member01@${plan.emailDomain} … member${String(members.length).padStart(2, '0')}@${plan.emailDomain}`);
  console.log(`Password: ${plan.password}  (${into ? 'every seeded account' : 'all accounts'})`);
  console.log(`Timeline: ${countWaiting(plan.agentActions)} question(s) waiting, ${plan.agentActions.length - countWaiting(plan.agentActions)} receipt(s) behind them`);
  // Which members ended up queued behind the full class. The three are
  // picked by a propensity roll out of forty, so nothing downstream can
  // guess them — and journey 8's waitlist assertion needs to be pointed
  // at one, or it skips itself rather than passing vacuously.
  const byId = new Map(plan.users.map((u) => [u.id, u.email]));
  const queued = plan.waitlist
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((w) => byId.get(w.profile_id) ?? w.profile_id);
  if (queued.length > 0) {
    console.log(`Waitlist: ${queued.join('  ')}  (in queue order)`);
  }
  console.log(
    into
      ? `Teardown: npm run seed:demo -- --teardown --owner ${into.ownerEmail} --slug ${plan.gym.slug}`
      : `Teardown: npm run seed:demo -- --teardown --slug ${plan.gym.slug}`,
  );
}

async function seed(sb: Client, plan: DemoPlan, into: AttachTarget | null): Promise<void> {
  // Freshness: refuse rather than upsert — recovery from any partial
  // state is teardown + re-seed.
  if (into) {
    const counts = await Promise.all(
      ATTACHED_MUST_BE_EMPTY.map(async (name) => [name, await countRows(sb, name, into.gym.id)] as const),
    );
    const populated = counts.filter(([, n]) => n > 0);
    if (populated.length > 0) {
      fail(
        `${into.gym.name} already holds ${populated.map(([n, c]) => `${c} ${n}`).join(', ')} — run --teardown --owner ${into.ownerEmail} first (it empties the gym and keeps the owner).`,
      );
    }
    const others = await countRows(sb, 'gym_memberships', into.gym.id);
    if (others > 1) console.warn(`  ${others - 1} existing member account(s) besides the owner stay as they are.`);
  } else {
    const { data: existing } = await sb.from('gyms').select('id').eq('slug', plan.gym.slug!).maybeSingle();
    if (existing) fail(`a gym with slug "${plan.gym.slug}" already exists — run --teardown first.`);
  }
  const priorUsers = await listDemoUsers(sb, plan.emailDomain);
  if (priorUsers.length > 0) {
    fail(`${priorUsers.length} auth user(s) already exist on @${plan.emailDomain} — run --teardown first.`);
  }

  // The real owner and gym are never created: their placeholders join the
  // remap below alongside the ids GoTrue mints.
  const ownerPlaceholder = plan.users.find((u) => u.role === 'owner')!.id;
  const accounts = into ? plan.users.filter((u) => u.id !== ownerPlaceholder) : plan.users;
  const idMap = new Map<string, string>();
  if (into) {
    idMap.set(ownerPlaceholder, into.ownerId);
    idMap.set(plan.gym.id!, into.gym.id);
  }

  console.log(`Creating ${accounts.length} accounts…`);
  for (const u of accounts) {
    const { data, error } = await withAdminRetry(() =>
      sb.auth.admin.createUser({
        email: u.email,
        password: plan.password,
        email_confirm: true,
        user_metadata: { full_name: u.fullName },
      }),
    );
    if (error || !data.user) fail(`createUser ${u.email} failed: ${error?.message}`);
    idMap.set(u.id, data.user.id);
  }

  // GoTrue mints its own user ids, so every plan-side profile id is a
  // placeholder. Ids are unique random strings, so a global string
  // replacement over the serialized plan remaps every reference at
  // once (config.now degrades to a string — unused from here on).
  let serialized = JSON.stringify(plan);
  for (const [placeholder, real] of idMap) serialized = serialized.split(placeholder).join(real);
  const remapped: DemoPlan = JSON.parse(serialized);
  const p = into ? withoutOwnerRows(remapped, into.ownerId) : remapped;

  if (into) {
    console.log(`Filling ${into.gym.name} (slug ${into.gym.slug})…`);
    // The gym keeps its name, slug, timezone and currency — the plan was
    // built from them. It gains the discipline, the store flags, a
    // dismissed onboarding (the seeded gym is a running gym), and a
    // created_at old enough for the Timeline to page into the history.
    const backdate = backdatedCreatedAt(into.gym.created_at, plan.config.now);
    const { error: gymErr } = await sb
      .from('gyms')
      .update({
        ...(backdate ? { created_at: backdate } : {}),
        discipline: p.gym.discipline,
        ...p.gymFlags,
      } as never)
      .eq('id', into.gym.id);
    if (gymErr) fail(`updating gym failed: ${gymErr.message}`);
  } else {
    console.log('Creating gym + tenant data…');
    await insertAll(sb, 'gyms', [p.gym]);
    // store flags are ops-only columns that the hand-trimmed
    // Update type deliberately omits — cast for this one write.
    const { error: flagErr } = await sb
      .from('gyms')
      .update(p.gymFlags as never)
      .eq('id', p.gym.id!);
    if (flagErr) fail(`setting gym flags failed: ${flagErr.message}`);
  }

  await insertAll(sb, 'gym_memberships', p.memberships);
  await insertAll(sb, 'member_consents', p.consents, {
    onConflict: 'gym_id,profile_id,policy_version',
    ignoreDuplicates: true,
  });
  await insertAll(sb, 'membership_plans', p.plans);
  await insertAll(sb, 'plan_subscriptions', p.subscriptions);
  await insertAll(sb, 'membership_invoice_links', p.invoiceLinks);
  await insertAll(sb, 'plan_subscription_dunning', p.dunning);
  await insertAll(sb, 'class_types', p.classTypes);
  await insertAll(sb, 'class_recurrences', p.recurrences);
  await insertAll(sb, 'class_sessions', p.sessions);
  await insertAll(sb, 'class_bookings', p.bookings);
  await insertAll(sb, 'class_waitlist', p.waitlist);
  await insertAll(sb, 'tracked_workouts', p.workouts);
  await insertAll(sb, 'tracked_movement_results', p.movementResults);
  await insertAll(sb, 'tracked_hyrox_races', p.hyroxRaces);
  await insertAll(sb, 'tracked_hyrox_splits', p.hyroxSplits);
  await insertAll(sb, 'member_injuries', p.injuries);
  await insertAll(sb, 'staff_alerts', p.staffAlerts);
  await insertAll(sb, 'lead_sources', p.leadSources);
  await insertAll(sb, 'leads', p.leads);
  await insertAll(sb, 'pending_members', p.pendingMembers);
  await insertAll(sb, 'gym_comms_settings', [p.commsSettings], { onConflict: 'gym_id' });
  await insertAll(sb, 'email_campaigns', [p.campaign]);

  const { error: pdfErr } = await sb.storage
    .from('store-digital-assets')
    .upload(p.digitalAssetPath, new TextEncoder().encode(DEMO_PDF), {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (pdfErr) fail(`digital asset upload failed: ${pdfErr.message}`);
  await insertAll(sb, 'store_products', p.storeProducts);
  await insertAll(sb, 'gym_hours', p.gymHours, { onConflict: 'gym_id,day_of_week' });
  await insertAll(sb, 'class_programming', p.programming);
  await insertAll(sb, 'direct_messages', p.directMessages);
  // Insert: never on all three — the app has no client write path to
  // them, every production write is a service-role RPC or a cron tick.
  // The seeder is the service role, so it writes them directly; the cast
  // is the same one gymFlags uses above and for the same reason.
  await insertAll(sb, 'agent_authority', p.agentAuthority as never, { onConflict: 'gym_id,action_kind' });
  await insertAll(sb, 'agent_message_templates', p.agentTemplates as never, { onConflict: 'gym_id,kind' });
  await insertAll(sb, 'agent_actions', p.agentActions as never);

  console.log('');
  console.log('Seeded:');
  printCounts(p);
  printCredentials(p, into);
}

// GoTrue's admin API occasionally bounces a call with a transient
// verification error unrelated to the request itself (seen in
// production: "invalid JWT ... unrecognized JWT kid" on both
// createUser and deleteUser). Without a retry, one such blip either
// strands an account that blocks the next seed's "already exists"
// guard, or aborts account creation partway through.
async function withAdminRetry<R extends { error: { message: string } | null }>(
  call: () => Promise<R>,
  attempts = 3,
): Promise<R> {
  let result = await call();
  for (let attempt = 2; attempt <= attempts && result.error; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, (attempt - 1) * 1000));
    result = await call();
  }
  return result;
}

async function removeDigitalAssets(sb: Client, gymId: string): Promise<void> {
  const { data: assets } = await sb.storage.from('store-digital-assets').list(gymId);
  if (assets && assets.length > 0) {
    await sb.storage.from('store-digital-assets').remove(assets.map((a) => `${gymId}/${a.name}`));
  }
}

// Orphan sweep covers a partial seed that died before or during
// membership creation.
async function deleteDemoAccounts(sb: Client, toDelete: Map<string, string>, emailDomain: string): Promise<void> {
  for (const u of await listDemoUsers(sb, emailDomain)) toDelete.set(u.id, u.email);

  let deleted = 0;
  for (const [id, email] of toDelete) {
    const { error } = await withAdminRetry(() => sb.auth.admin.deleteUser(id));
    if (error) console.warn(`  could not delete ${email}: ${error.message}`);
    else deleted++;
  }
  console.log(`Deleted ${deleted} demo account(s) on @${emailDomain}.`);
}

async function teardown(sb: Client, slug: string, emailDomain: string): Promise<void> {
  const { data: gym } = await sb.from('gyms').select('id').eq('slug', slug).maybeSingle();

  // Collect the demo accounts BEFORE the cascade removes the
  // memberships that identify them.
  const toDelete = new Map<string, string>();
  if (gym) {
    for (const [id, email] of await collectDemoAccounts(sb, gym.id, emailDomain)) toDelete.set(id, email);
    await removeDigitalAssets(sb, gym.id);

    const { error: delErr } = await sb.from('gyms').delete().eq('id', gym.id);
    if (delErr) fail(`deleting gym failed: ${delErr.message}`);
    console.log(`Deleted gym ${slug} (cascade removed all tenant data).`);
  } else {
    console.log(`No gym with slug ${slug} — sweeping for orphaned demo accounts.`);
  }

  await deleteDemoAccounts(sb, toDelete, emailDomain);
}

// The gym and its owner stay; everything the seed put around them goes.
// Nothing cascades from a gym row that is not deleted, so each table is
// emptied for this gym in turn, and a table that will not empty is
// reported rather than aborting — the next seed's freshness check names
// whatever is left.
async function teardownAttached(sb: Client, into: AttachTarget, emailDomain: string): Promise<void> {
  const toDelete = await collectDemoAccounts(sb, into.gym.id, emailDomain);
  await removeDigitalAssets(sb, into.gym.id);

  const stuck: string[] = [];
  for (const name of ATTACHED_CONTENT_TABLES) {
    const { error } = await table(sb, name).delete().eq('gym_id', into.gym.id);
    if (error) {
      console.warn(`  could not empty ${name}: ${error.message}`);
      stuck.push(name);
    }
  }
  if (toDelete.size > 0) {
    const { error } = await sb
      .from('gym_memberships')
      .delete()
      .eq('gym_id', into.gym.id)
      .in('profile_id', [...toDelete.keys()]);
    if (error) fail(`removing seeded memberships failed: ${error.message}`);
  }
  console.log(`Emptied ${into.gym.name} (slug ${into.gym.slug}); the gym and ${into.ownerEmail} remain.`);

  await deleteDemoAccounts(sb, toDelete, emailDomain);
  if (stuck.length > 0) fail(`could not empty: ${stuck.join(', ')}.`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      // slug/name have no static default — the default depends on
      // --discipline (resolved below) — so a bare `npm run seed:demo`
      // still gets the CrossFit gym, but `--discipline hyrox` gets its
      // own name/slug without also having to pass --name/--slug.
      slug: { type: 'string' },
      name: { type: 'string' },
      discipline: { type: 'string', default: 'crossfit' },
      members: { type: 'string', default: '40' },
      'weeks-back': { type: 'string', default: '4' },
      'weeks-forward': { type: 'string', default: '2' },
      'history-weeks': { type: 'string', default: '10' },
      tz: { type: 'string', default: 'Europe/London' },
      seed: { type: 'string', default: '42' },
      teardown: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      // Undefined by default — buildDemoPlan falls back to the shared
      // DEMO_PASSWORD constant, so every existing call site is
      // unaffected. Used by the demo-marketing-rotate workflow to mint
      // a fresh password on every nightly reseed of demo-launchpad.
      password: { type: 'string' },
      // The email of a real account: seed into (or empty) the gym it owns
      // instead of creating a demo- gym. --slug then only picks between
      // several owned gyms; --name and --tz are the gym's own.
      owner: { type: 'string' },
    },
  });

  const discipline = values.discipline as string;
  if (discipline !== 'crossfit' && discipline !== 'hyrox') {
    fail(`--discipline must be "crossfit" or "hyrox" (got "${discipline}").`);
  }
  const owner = values.owner?.trim().toLowerCase() || undefined;
  if (owner && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) {
    fail(`--owner must be an email address (got "${owner}").`);
  }
  let slug = values.slug;
  if (owner) {
    if (slug && !/^[a-z0-9-]+$/.test(slug)) fail(`slug must match [a-z0-9-]+ (got "${slug}").`);
  } else {
    slug ??= discipline === 'hyrox' ? 'demo-hyrox' : 'demo-ironworks';
    if (!/^demo-[a-z0-9-]+$/.test(slug)) {
      fail(`slug must match demo-[a-z0-9-]+ (got "${slug}") — the demo- prefix is the safety rail for both seed and teardown.`);
    }
  }
  const gymName = values.name ?? (discipline === 'hyrox' ? 'Ironclad Hyrox Club' : 'Ironworks Strength Club');

  const planFor = (gym: OwnedGym | null): DemoPlan =>
    buildDemoPlan({
      slug: gym?.slug ?? slug ?? 'your-gym',
      gymName: gym?.name ?? gymName,
      discipline,
      members: Number(values.members),
      weeksBack: Number(values['weeks-back']),
      weeksForward: Number(values['weeks-forward']),
      historyWeeks: Number(values['history-weeks']),
      tz: gym?.timezone ?? values.tz!,
      seed: Number(values.seed),
      now: new Date(),
      password: values.password,
      attach: owner !== undefined,
      currency: gym?.currency,
    });

  if (values['dry-run'] && !values.teardown) {
    // With --owner the real gym is unknown without the database; the
    // stand-in slug shows the same counts.
    const plan = planFor(null);
    console.log(`Dry run — plan for slug ${plan.gym.slug} (nothing written):`);
    printCounts(plan);
    printCredentials(plan, null);
    return;
  }

  const url = process.env.SUPABASE_URL ?? LOCAL_URL;
  const local = isLocalUrl(url);
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!local) {
    if (!key) fail(`non-local target ${url} requires an explicit SUPABASE_SERVICE_ROLE_KEY.`);
    if (!values.yes) {
      fail(`refusing to touch non-local target ${url} without --yes. This creates real, signable-in accounts — never point it at production.`);
    }
  }
  if (!key) key = localServiceKey();

  console.log(`Target: ${url}${local ? ' (local stack)' : ''}`);
  const sb: Client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (owner) {
    const into = await resolveOwnedGym(sb, owner, slug);
    const emailDomain = `${into.gym.slug}.temple.test`;
    if (values.teardown) await teardownAttached(sb, into, emailDomain);
    else await seed(sb, planFor(into.gym), into);
    return;
  }

  const emailDomain = `${slug}.temple.test`;
  if (values.teardown) await teardown(sb, slug!, emailDomain);
  else await seed(sb, planFor(null), null);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
