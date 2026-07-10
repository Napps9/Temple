// Email-automation worker. Two no-JWT paths on one function:
//
//   1. DRAIN (POST, no `run` query param) — invoked by the
//      dispatch-email-automations pg_cron job via pg_net, guarded by the
//      x-automation-secret shared secret. Sends every queued
//      email_automation_runs row via Resend and writes status back.
//
//   2. UNSUBSCRIBE (GET/POST with ?run=<run_id>) — the public link carried
//      in each automated email. GET shows a confirm page (so corporate
//      scanners/prefetchers can't auto-opt-out); POST records it. A member
//      run adds an email_unsubscribes row (blanket or per-topic) via
//      automation_unsubscribe; a lead run withdraws marketing consent via
//      lead_withdraw_marketing_consent.
//
// Delivery mirrors send-campaign / send-lead-notifications: concurrency pool,
// per-send Idempotency-Key, live-vs-simulated env gate so the loop is
// demonstrable end-to-end before a Resend key + sending domain are wired.
// v1 does not track opens/clicks (deferred — the compiled HTML carries no
// pixel/click-wrap yet).
//
// Required env (SUPABASE_* injected by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Guarding the drain:
//   AUTOMATION_WORKER_SECRET  (must equal the app.automation_worker_secret GUC)
// Optional env to go live:
//   RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-automation-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...cors, 'content-type': 'text/html; charset=utf-8' },
  });
}

const UNSUB_PLACEHOLDER = '{{unsubscribe_url}}';

type EmailContent = {
  subject: string;
  preheader: string;
  from_name: string | null;
  compiled_html: string | null;
  compiled_text: string | null;
};

type Run = {
  id: string;
  gym_id: string;
  lead_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  // The primary email (step_id null) reads from the automation; a follow-up
  // step run reads from the step. Whichever is set wins.
  automation: EmailContent | null;
  step: EmailContent | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  const url = new URL(req.url);
  const runId = url.searchParams.get('run');

  // ---- Path 2: public unsubscribe -----------------------------------------
  if (runId) {
    if (req.method === 'GET') {
      // Confirm page — a real click POSTs; scanners that only GET don't opt out.
      return html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center;">
          <h1 style="font-size:1.25rem;">Unsubscribe</h1>
          <p style="color:#475569;">Stop receiving these automated emails?</p>
          <form method="POST">
            <button style="background:#3B6BA5;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:16px;cursor:pointer;">
              Yes, unsubscribe
            </button>
          </form>
        </body>`);
    }
    if (req.method === 'POST') {
      const { data: run } = await service
        .from('email_automation_runs')
        .select('id, lead_id')
        .eq('id', runId)
        .maybeSingle();
      if (run) {
        if (run.lead_id) {
          await service.rpc('lead_withdraw_marketing_consent', { p_run_id: runId });
        } else {
          await service.rpc('automation_unsubscribe', { p_run_id: runId });
        }
      }
      return html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center;">
          <h1 style="font-size:1.25rem;">You're unsubscribed</h1>
          <p style="color:#475569;">You won't receive these automated emails any more.</p>
        </body>`);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  // ---- Path 1: drain the queue --------------------------------------------
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('AUTOMATION_WORKER_SECRET');
  if (secret && req.headers.get('x-automation-secret') !== secret) {
    return json({ error: 'Not authorised' }, 403);
  }

  let gymScope: string | undefined;
  try {
    const body = await req.json();
    gymScope = body?.gym_id;
  } catch {
    // No body (cron sends { enqueued }) — drain everything queued.
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL');

  let query = service
    .from('email_automation_runs')
    .select(
      'id, gym_id, lead_id, recipient_email, recipient_name, automation:email_automations!automation_id(subject, preheader, from_name, compiled_html, compiled_text), step:email_automation_steps!step_id(subject, preheader, from_name, compiled_html, compiled_text)',
    )
    .eq('status', 'queued');
  if (gymScope) query = query.eq('gym_id', gymScope);

  const { data: rows, error: rErr } = await query;
  if (rErr) return json({ error: rErr.message }, 500);
  const runs = (rows as unknown as Run[]) ?? [];

  // Sender identity is per-gym; cache the lookups.
  const gymIds = [...new Set(runs.map((r) => r.gym_id))];
  const senderByGym = new Map<
    string,
    { fromName: string; fromAddress: string | undefined; replyTo: string | undefined }
  >();
  await Promise.all(
    gymIds.map(async (gid) => {
      const [{ data: gym }, { data: settings }, { data: domain }] = await Promise.all([
        service.from('gyms').select('name').eq('id', gid).maybeSingle(),
        service.from('gym_comms_settings').select('from_name, reply_to').eq('gym_id', gid).maybeSingle(),
        service
          .from('gym_sending_domains')
          .select('domain, from_local, status')
          .eq('gym_id', gid)
          .maybeSingle(),
      ]);
      const gymName = gym?.name ?? 'Your gym';
      senderByGym.set(gid, {
        fromName: settings?.from_name || gymName,
        fromAddress:
          domain?.status === 'verified' && domain.domain
            ? `${domain.from_local}@${domain.domain}`
            : RESEND_FROM,
        replyTo: settings?.reply_to || undefined,
      });
    }),
  );

  const unsubBase = `${SUPABASE_URL}/functions/v1/send-email-automations`;
  let sent = 0;
  let failed = 0;
  let simulated = 0;
  let skipped = 0;

  async function deliver(r: Run) {
    const nowIso = new Date().toISOString();
    const sender = senderByGym.get(r.gym_id);
    const content = r.step ?? r.automation;
    const compiled = content?.compiled_html;
    if (!r.recipient_email || !content || !compiled) {
      await service
        .from('email_automation_runs')
        .update({ status: 'skipped', error: 'Missing recipient or compiled body' })
        .eq('id', r.id);
      skipped += 1;
      return;
    }

    const unsubUrl = `${unsubBase}?run=${r.id}`;
    const bodyHtml = compiled.split(UNSUB_PLACEHOLDER).join(unsubUrl);
    const bodyText = (content.compiled_text ?? '').split(UNSUB_PLACEHOLDER).join(unsubUrl);
    const live = Boolean(RESEND_API_KEY && sender?.fromAddress);

    if (!live) {
      await service
        .from('email_automation_runs')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', r.id);
      simulated += 1;
      return;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          'Idempotency-Key': `auto:${r.id}`,
        },
        body: JSON.stringify({
          from: `${content.from_name || sender!.fromName} <${sender!.fromAddress}>`,
          to: [r.recipient_email],
          subject: content.subject || '(no subject)',
          html: bodyHtml,
          text: bodyText || undefined,
          reply_to: sender!.replyTo,
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 500);
        await service
          .from('email_automation_runs')
          .update({ status: 'failed', error: errTxt })
          .eq('id', r.id);
        failed += 1;
        return;
      }
      await service
        .from('email_automation_runs')
        .update({ status: 'sent', sent_at: nowIso, error: null })
        .eq('id', r.id);
      sent += 1;
    } catch (e) {
      await service
        .from('email_automation_runs')
        .update({ status: 'failed', error: String(e).slice(0, 500) })
        .eq('id', r.id);
      failed += 1;
    }
  }

  const CONCURRENCY = 8;
  const queue = [...runs];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) return;
          await deliver(next);
        }
      })(),
    );
  }
  await Promise.all(workers);

  return json({ ok: true, mode: RESEND_API_KEY ? 'live' : 'simulated', sent, failed, simulated, skipped });
});
