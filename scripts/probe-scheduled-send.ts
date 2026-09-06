// Exercises the scheduled-send path for real, on a hosted demo gym.
//
// Schedules a campaign one minute out as the gym's owner, exactly as the
// editor does, then watches with the service role what happens next: the
// dispatcher's cron_run_log rows, the campaign's status, its recipients,
// and the gateway's replies to the dispatcher's POST. Everything before
// the worker is proven by pgTAP; this is the one leg tests cannot reach,
// because pg_net is stubbed there.
//
//   npx tsx scripts/probe-scheduled-send.ts --slug demo-ironworks --yes
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. The
// slug must start with demo-: on a demo gym the worker simulates rather
// than sends (0278), which proves every hop but the Resend call — and the
// Resend call is the same code the immediate send runs on live gyms.
//
// Exits non-zero naming the first hop that did not happen, in the order
// the runbook (docs/resend-setup.md, section 3) checks them.

import { parseArgs } from 'node:util';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_AUDIENCE } from '../src/lib/email/audience';
import { FALLBACK_BRAND_SEED, starterDocument } from '../src/lib/email/blocks';
import { renderEmailHtml, renderEmailText } from '../src/lib/email/render';
import type { Database, Json } from '../src/types/database';

type Client = SupabaseClient<Database>;

function fail(message: string): never {
  console.error(`probe: ${message}`);
  process.exit(1);
}

function log(line: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      minutes: { type: 'string', default: '25' },
      yes: { type: 'boolean', default: false },
    },
  });
  const slug = values.slug ?? fail('--slug is required');
  if (!/^demo-[a-z0-9-]+$/.test(slug)) {
    fail(`slug must match demo-[a-z0-9-]+ (got "${slug}") — the demo- prefix is the safety rail.`);
  }
  if (!values.yes) fail('this schedules a real campaign on the hosted gym; pass --yes.');
  const url = process.env.SUPABASE_URL ?? fail('SUPABASE_URL is not set.');
  const anon = process.env.SUPABASE_ANON_KEY ?? fail('SUPABASE_ANON_KEY is not set.');
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fail('SUPABASE_SERVICE_ROLE_KEY is not set.');
  const password = process.env.PROBE_PASSWORD ?? 'TempleDemo1!';
  const budgetMs = Number(values.minutes) * 60_000;

  const owner: Client = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service: Client = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // cron_run_log is an ops table with no client policy, so it is absent
  // from the typed schema; the service role reads it untyped.
  const ops = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `owner@${slug}.temple.test`;
  const { data: auth, error: authErr } = await owner.auth.signInWithPassword({ email, password });
  if (authErr || !auth.user) fail(`sign-in as ${email} failed: ${authErr?.message}`);

  const { data: gym } = await owner
    .from('gyms')
    .select('id, name, is_demo')
    .eq('slug', slug)
    .maybeSingle();
  if (!gym) fail(`no gym with slug "${slug}" visible to ${email}.`);
  if (gym.is_demo !== true) fail(`${slug} is not flagged is_demo; refusing.`);

  const startedAt = new Date();
  const doc = starterDocument(
    {
      primaryColor: FALLBACK_BRAND_SEED.primaryColor,
      secondaryColor: FALLBACK_BRAND_SEED.secondaryColor,
      textColor: FALLBACK_BRAND_SEED.textColor,
    },
    { gymName: gym.name },
  );
  const { data: created, error: insErr } = await owner
    .from('email_campaigns')
    .insert({
      gym_id: gym.id,
      created_by: auth.user.id,
      title: `Scheduled-send probe ${startedAt.toISOString()}`,
      subject: 'Scheduled-send probe',
      design: doc as unknown as Json,
      audience: DEFAULT_AUDIENCE as unknown as Json,
    })
    .select('id')
    .single();
  if (insErr || !created) fail(`creating the draft failed: ${insErr?.message}`);
  const campaignId = created.id as string;

  const sendAt = new Date(startedAt.getTime() + 60_000);
  const { error: schedErr } = await owner.rpc('comms_schedule_campaign', {
    p_campaign_id: campaignId,
    p_send_at: sendAt.toISOString(),
    p_html: renderEmailHtml(doc, { preheader: '', footer: {} }),
    p_text: renderEmailText(doc, { footer: {} }),
  });
  if (schedErr) fail(`comms_schedule_campaign failed: ${schedErr.message}`);
  log(`scheduled ${campaignId} on ${gym.name} for ${sendAt.toISOString()} (cron runs */15)`);

  const since = startedAt.toISOString();
  let lastStatus = 'scheduled';
  let lastLog = 0;
  let seenResponses = new Set<number>();
  let responses: { id: number; status_code: number | null; content: string | null }[] = [];
  let runs: { id: number; ran_at: string; result: Json | null }[] = [];
  let recipients: Record<string, number> = {};

  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(30_000);

    const { data: camp } = await service
      .from('email_campaigns')
      .select('status, recipient_count, scheduled_for')
      .eq('id', campaignId)
      .single();
    const status = camp?.status ?? 'missing';
    if (status !== lastStatus) {
      log(`campaign ${lastStatus} -> ${status}`);
      lastStatus = status;
    }

    const { data: logs } = await ops
      .from('cron_run_log')
      .select('id, ran_at, result')
      .eq('job_name', 'dispatch-scheduled-campaigns')
      .gte('ran_at', since)
      .order('id', { ascending: true });
    runs = (logs ?? []) as typeof runs;
    for (const r of runs) {
      if (r.id > lastLog) {
        log(`dispatcher ran: ${JSON.stringify(r.result)}`);
        lastLog = r.id;
      }
    }

    const { data: replies, error: repErr } = await service.rpc('recent_worker_responses', {
      p_limit: 10,
    });
    if (repErr) log(`recent_worker_responses: ${repErr.message}`);
    responses = (replies ?? []).filter((r) => r.created >= since);
    for (const r of responses) {
      if (!seenResponses.has(r.id)) {
        log(`gateway replied ${r.status_code}: ${(r.content ?? '').slice(0, 160)}`);
        seenResponses = new Set([...seenResponses, r.id]);
      }
    }

    const { data: recs } = await service
      .from('email_campaign_recipients')
      .select('status')
      .eq('campaign_id', campaignId);
    recipients = {};
    for (const r of recs ?? []) recipients[r.status] = (recipients[r.status] ?? 0) + 1;

    if (status === 'sent' || status === 'failed') break;
  }

  const counts = Object.entries(recipients)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  log(`final: campaign ${lastStatus}; recipients ${counts || 'none'}`);

  if (lastStatus === 'sent') {
    console.log(
      '\nPASS  scheduled -> dispatcher -> gateway -> send-campaign -> sent.' +
        (recipients.simulated ? ' Demo gym, so every recipient is simulated, as 0278 intends.' : ''),
    );
    return;
  }

  const latest = runs.at(-1)?.result as Record<string, unknown> | null | undefined;
  const codes = responses.map((r) => r.status_code);
  let verdict: string;
  if (runs.length === 0) {
    verdict =
      'pg_cron never ran dispatch-scheduled-campaigns: no cron_run_log row since the probe began. ' +
      'Check `select * from cron.job` on the hosted project for the */15 job from 0184.';
  } else if (latest && 'skipped' in latest) {
    verdict =
      `the dispatcher skipped: ${String(latest.skipped)}. Create the two Vault rows in ` +
      'docs/resend-setup.md section 3.';
  } else if (lastStatus === 'scheduled') {
    verdict =
      'the dispatcher ran but did not pick the campaign up. Its scheduled_for should be in the past; ' +
      `last run reported ${JSON.stringify(latest)}.`;
  } else if (lastStatus === 'failed') {
    verdict =
      'the campaign failed before any send: _send_due_campaign found no recipients ' +
      '(empty audience or every address suppressed).';
  } else if (codes.length === 0) {
    verdict =
      'the dispatcher moved the campaign to sending but no gateway reply was recorded: ' +
      'net.http_post never delivered. Check `select * from net._http_response` and the pg_net worker.';
  } else if (codes.includes(401)) {
    verdict =
      'the gateway rejected the POST with 401: worker_gateway_key in Vault is not the publishable key.';
  } else if (codes.includes(403)) {
    verdict =
      'send-campaign refused the dispatcher with 403: AUTOMATION_WORKER_SECRET (Edge Function secret) ' +
      'does not equal worker_shared_secret in Vault. Set both to the same value per docs/resend-setup.md ' +
      'section 3; the dispatcher re-pokes this campaign every fifteen minutes once it does.';
  } else {
    verdict = `the worker replied ${codes.join(', ')} and the campaign is still ${lastStatus}.`;
  }
  console.error(`\nFAIL  ${verdict}`);
  process.exit(1);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
