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
// Safety model: the gym slug must start with "demo-", every created
// account lives on @<slug>.temple.test (IANA-reserved, mail can never
// route), and teardown only deletes auth users it collected from the
// gym's own memberships whose email is on that exact domain.

import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../src/types/database';
import { buildDemoPlan, type DemoPlan } from './demo-gym/plan';

type Client = SupabaseClient<Database>;

const LOCAL_URL = 'http://127.0.0.1:54321';
const BATCH = 500;

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

async function insertAll<TRow>(
  sb: Client,
  table: string,
  rows: TRow[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // Table names are validated by the typed plan; the union of every
    // seeded table is unwieldy as a generic, so insert untyped here.
    // defaultToNull: false — rows in one batch have differing key
    // sets, and PostgREST otherwise fills the gaps with NULL instead
    // of the column default (bit us on store_products.track_inventory).
    const { error } = await (sb.from as (t: string) => ReturnType<Client['from']>)(table).insert(
      chunk as never,
      { defaultToNull: false },
    );
    if (error) {
      fail(`insert into ${table} failed: ${error.message}\nPartial seed left behind — run --teardown, then re-seed.`);
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

function printCounts(plan: DemoPlan): void {
  const rows: [string, number][] = [
    ['auth users / profiles', plan.users.length],
    ['gym_memberships', plan.memberships.length],
    ['member_consents', plan.consents.length],
    ['membership_plans', plan.plans.length],
    ['plan_subscriptions', plan.subscriptions.length],
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
    ['gym_websites', 1],
    ['gym_hours', plan.gymHours.length],
    ['class_programming', plan.programming.length],
    ['direct_messages', plan.directMessages.length],
  ];
  const width = Math.max(...rows.map(([n]) => n.length));
  for (const [name, count] of rows) console.log(`  ${name.padEnd(width)}  ${count}`);
}

function printCredentials(plan: DemoPlan): void {
  const members = plan.users.filter((u) => u.role === 'member');
  console.log('');
  console.log(`Gym:      ${plan.gym.name}  (slug ${plan.gym.slug})`);
  console.log(`Owner:    owner@${plan.emailDomain}`);
  console.log(`Coaches:  coach1@${plan.emailDomain}  coach2@${plan.emailDomain}`);
  console.log(`Members:  member01@${plan.emailDomain} … member${String(members.length).padStart(2, '0')}@${plan.emailDomain}`);
  console.log(`Password: ${plan.password}  (all accounts)`);
  console.log(`Teardown: npm run seed:demo -- --teardown --slug ${plan.gym.slug}`);
}

async function seed(sb: Client, plan: DemoPlan): Promise<void> {
  // Freshness: refuse rather than upsert — recovery from any partial
  // state is teardown + re-seed.
  const { data: existing } = await sb.from('gyms').select('id').eq('slug', plan.gym.slug!).maybeSingle();
  if (existing) fail(`a gym with slug "${plan.gym.slug}" already exists — run --teardown first.`);
  const priorUsers = await listDemoUsers(sb, plan.emailDomain);
  if (priorUsers.length > 0) {
    fail(`${priorUsers.length} auth user(s) already exist on @${plan.emailDomain} — run --teardown first.`);
  }

  console.log(`Creating ${plan.users.length} accounts…`);
  const idMap = new Map<string, string>();
  for (const u of plan.users) {
    const { data, error } = await sb.auth.admin.createUser({
      email: u.email,
      password: plan.password,
      email_confirm: true,
      user_metadata: { full_name: u.fullName },
    });
    if (error || !data.user) fail(`createUser ${u.email} failed: ${error?.message}`);
    idMap.set(u.id, data.user.id);
  }

  // GoTrue mints its own user ids, so every plan-side profile id is a
  // placeholder. Ids are unique random strings, so a global string
  // replacement over the serialized plan remaps every reference at
  // once (config.now degrades to a string — unused from here on).
  let serialized = JSON.stringify(plan);
  for (const [placeholder, real] of idMap) serialized = serialized.split(placeholder).join(real);
  const p: DemoPlan = JSON.parse(serialized);

  console.log('Creating gym + tenant data…');
  await insertAll(sb, 'gyms', [p.gym]);
  // store/website flags are ops-only columns that the hand-trimmed
  // Update type deliberately omits — cast for this one write.
  const { error: flagErr } = await sb
    .from('gyms')
    .update(p.gymFlags as never)
    .eq('id', p.gym.id!);
  if (flagErr) fail(`setting gym flags failed: ${flagErr.message}`);

  await insertAll(sb, 'gym_memberships', p.memberships);
  await insertAll(sb, 'member_consents', p.consents);
  await insertAll(sb, 'membership_plans', p.plans);
  await insertAll(sb, 'plan_subscriptions', p.subscriptions);
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
  await insertAll(sb, 'gym_comms_settings', [p.commsSettings]);
  await insertAll(sb, 'email_campaigns', [p.campaign]);

  const { error: pdfErr } = await sb.storage
    .from('store-digital-assets')
    .upload(p.digitalAssetPath, new TextEncoder().encode(DEMO_PDF), {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (pdfErr) fail(`digital asset upload failed: ${pdfErr.message}`);
  await insertAll(sb, 'store_products', p.storeProducts);
  await insertAll(sb, 'gym_websites', [p.website]);
  await insertAll(sb, 'gym_hours', p.gymHours);
  await insertAll(sb, 'class_programming', p.programming);
  await insertAll(sb, 'direct_messages', p.directMessages);

  console.log('');
  console.log('Seeded:');
  printCounts(p);
  printCredentials(p);
}

// GoTrue's admin API occasionally bounces a call with a transient
// verification error unrelated to the target user (seen in production:
// "invalid JWT ... unrecognized JWT kid" on deleteUser). Without a retry,
// one such blip strands an account that then blocks the next seed's
// "already exists" guard indefinitely.
async function deleteUserWithRetry(
  sb: Client,
  id: string,
  attempts = 3,
): Promise<{ message: string } | null> {
  let lastError: { message: string } | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { error } = await sb.auth.admin.deleteUser(id);
    if (!error) return null;
    lastError = error;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  return lastError;
}

async function teardown(sb: Client, slug: string, emailDomain: string): Promise<void> {
  const { data: gym } = await sb.from('gyms').select('id').eq('slug', slug).maybeSingle();

  // Collect the demo accounts BEFORE the cascade removes the
  // memberships that identify them. Two guards: only users reached via
  // this gym's memberships, and of those only emails on the exact
  // reserved domain — a real user who joined the demo gym survives.
  const toDelete = new Map<string, string>();
  if (gym) {
    const { data: memberships } = await sb
      .from('gym_memberships')
      .select('profile_id')
      .eq('gym_id', gym.id);
    for (const m of memberships ?? []) {
      const { data } = await sb.auth.admin.getUserById(m.profile_id);
      const email = data.user?.email;
      if (!email) continue;
      if (email.endsWith(`@${emailDomain}`)) toDelete.set(m.profile_id, email);
      else console.warn(`  skipping non-demo account ${email}`);
    }

    const { data: assets } = await sb.storage.from('store-digital-assets').list(gym.id);
    if (assets && assets.length > 0) {
      await sb.storage.from('store-digital-assets').remove(assets.map((a) => `${gym.id}/${a.name}`));
    }

    const { error: delErr } = await sb.from('gyms').delete().eq('id', gym.id);
    if (delErr) fail(`deleting gym failed: ${delErr.message}`);
    console.log(`Deleted gym ${slug} (cascade removed all tenant data).`);
  } else {
    console.log(`No gym with slug ${slug} — sweeping for orphaned demo accounts.`);
  }

  // Orphan sweep covers a partial seed that died before or during
  // membership creation.
  for (const u of await listDemoUsers(sb, emailDomain)) toDelete.set(u.id, u.email);

  let deleted = 0;
  for (const [id, email] of toDelete) {
    const error = await deleteUserWithRetry(sb, id);
    if (error) console.warn(`  could not delete ${email}: ${error.message}`);
    else deleted++;
  }
  console.log(`Deleted ${deleted} demo account(s) on @${emailDomain}.`);
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
    },
  });

  const discipline = values.discipline as string;
  if (discipline !== 'crossfit' && discipline !== 'hyrox') {
    fail(`--discipline must be "crossfit" or "hyrox" (got "${discipline}").`);
  }
  const slug = values.slug ?? (discipline === 'hyrox' ? 'demo-hyrox' : 'demo-ironworks');
  const gymName = values.name ?? (discipline === 'hyrox' ? 'Ironclad Hyrox Club' : 'Ironworks Strength Club');
  if (!/^demo-[a-z0-9-]+$/.test(slug)) {
    fail(`slug must match demo-[a-z0-9-]+ (got "${slug}") — the demo- prefix is the safety rail for both seed and teardown.`);
  }
  const emailDomain = `${slug}.temple.test`;

  const plan = values.teardown
    ? null
    : buildDemoPlan({
        slug,
        gymName,
        discipline,
        members: Number(values.members),
        weeksBack: Number(values['weeks-back']),
        weeksForward: Number(values['weeks-forward']),
        historyWeeks: Number(values['history-weeks']),
        tz: values.tz!,
        seed: Number(values.seed),
        now: new Date(),
        password: values.password,
      });

  if (plan && values['dry-run']) {
    console.log(`Dry run — plan for slug ${slug} (nothing written):`);
    printCounts(plan);
    printCredentials(plan);
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

  if (values.teardown) await teardown(sb, slug, emailDomain);
  else await seed(sb, plan!);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
