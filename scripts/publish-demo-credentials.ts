// Publishes the current login for the public marketing demo tenant
// (demo-launchpad) to demo_marketing_credentials, which api/demo-credentials.ts
// serves to the marketing site. Run as the last step of both the initial
// bootstrap and the nightly demo-marketing-rotate workflow, right after
// seed-demo-gym.ts creates (or recreates) the tenant with a known password —
// this script doesn't need to look anything up in the database, since the
// caller already knows exactly what it just asked the seeder to create.
//
//   npx tsx scripts/publish-demo-credentials.ts --slug demo-launchpad --gym-name "Launchpad CrossFit" --password "$NEW_PASSWORD"
//
// Same env vars as seed-demo-gym.ts: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/types/database';

function fail(message: string): never {
  console.error(`publish-demo-credentials: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      'gym-name': { type: 'string' },
      password: { type: 'string' },
    },
  });

  const slug = values.slug;
  const gymName = values['gym-name'];
  const password = values.password;
  if (!slug || !gymName || !password) {
    fail('--slug, --gym-name and --password are all required.');
  }
  if (!/^demo-[a-z0-9-]+$/.test(slug)) {
    fail(`slug must match demo-[a-z0-9-]+ (got "${slug}").`);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.');

  const emailDomain = `${slug}.temple.test`;
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from('demo_marketing_credentials').upsert(
    {
      slug,
      gym_name: gymName,
      owner_email: `owner@${emailDomain}`,
      owner_password: password,
      // Matches the seeder's own deterministic member email scheme
      // (scripts/demo-gym/plan.ts) — member01 is always the first
      // seeded member.
      member_email: `member01@${emailDomain}`,
      member_password: password,
      rotated_at: new Date().toISOString(),
    },
    { onConflict: 'slug' },
  );
  if (error) fail(`upsert failed: ${error.message}`);

  console.log(`Published credentials for ${slug} (${gymName}).`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
