// Communications Suite — campaign delivery worker.
//
// Invoked by the staff client after comms_send_campaign has snapshotted
// the recipients and flipped the campaign to 'sending'. This worker:
//
//   1. re-authorises the caller (effective_can(can_manage_comms)) so a
//      stray JWT can't trigger another gym's send,
//   2. personalises the stored compiled HTML per recipient — wraps links
//      for click tracking, injects the open pixel, fills the unsubscribe
//      URL — and sends via Resend,
//   3. records per-recipient status + an email_events row, then closes
//      the campaign out.
//
// Delivery is pluggable: with RESEND_API_KEY + RESEND_FROM_EMAIL set it
// sends for real; without them it records a 'simulated' send so the
// suite is demonstrable end-to-end before a sending domain is wired. The
// client also has its own comms_finalize_simulation fallback for when
// this function isn't deployed at all (local dev).
//
// Required env (SUPABASE_* are injected by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Optional env to go live:
//   RESEND_API_KEY, RESEND_FROM_EMAIL  (e.g. "Iron Temple <news@mail.irontemple.com>"
//                                       — RESEND_FROM_EMAIL is the address part)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Mirrors UNSUBSCRIBE_PLACEHOLDER in src/lib/email/render.ts.
const UNSUB_PLACEHOLDER = '{{unsubscribe_url}}';

// HTML-escaped href values come back with &amp; / &lt; / &gt; / &quot;.
// The renderer's escapeHtml() runs over every URL it emits, so the
// stored compiled HTML carries entity-encoded ampersands inside
// hrefs. URL-encoding the literal `&amp;` percent-encodes the `amp;`
// part, and when the tracker URL-decodes its `u` query param we end
// up redirecting the browser to a URL with a literal "&amp;" in it
// — which a browser treats as text, not a query-param separator. So
// undo the HTML escaping on the raw URL string BEFORE handing it to
// encodeURIComponent.
function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

// Pre-build the tracker URLs we wrap into so the unsubscribe link
// (also a tracker URL) and the open pixel can't be re-wrapped on a
// second pass — the wrap loop's regex would otherwise rewrite our own
// `${trackBase}?e=...` hrefs, doubling the encoding on the embedded
// destination URL.
function personalize(
  html: string,
  ctx: { campaignId: string; recipientId: string; trackBase: string; unsubUrl: string },
): string {
  // Swap the unsubscribe placeholder FIRST so the resulting href (the
  // tracker URL) isn't a candidate for click-wrapping below.
  let out = html.split(UNSUB_PLACEHOLDER).join(ctx.unsubUrl);

  // Wrap absolute http(s) hrefs so clicks redirect through the tracker.
  // Skip anything pointing at the tracker itself.
  out = out.replace(/href="(https?:\/\/[^"]+)"/g, (_m, raw: string) => {
    if (raw.startsWith(ctx.trackBase)) return `href="${raw}"`;
    // The href value comes back HTML-entity-encoded (renderer used
    // escapeHtml). Decode before percent-encoding so the redirect lands
    // on the original URL, not one with literal "&amp;" in its query.
    const decoded = unescapeHtmlEntities(raw);
    const wrapped = `${ctx.trackBase}?e=c&c=${ctx.campaignId}&r=${ctx.recipientId}&u=${encodeURIComponent(
      decoded,
    )}`;
    return `href="${wrapped}"`;
  });

  const pixel = `<img src="${ctx.trackBase}?e=o&c=${ctx.campaignId}&r=${ctx.recipientId}" width="1" height="1" alt="" style="display:none;border:0;" />`;
  out = out.includes('</body>') ? out.replace('</body>', `${pixel}</body>`) : out + pixel;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let campaignId: string | undefined;
  try {
    const body = await req.json();
    campaignId = body?.campaign_id;
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  if (!campaignId) return json({ error: 'campaign_id is required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: campaign, error: cErr } = await service
    .from('email_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();
  if (cErr || !campaign) return json({ error: 'Campaign not found' }, 404);

  // Two ways in. A person clicking Send re-authorises as themselves (the
  // service client above bypasses RLS). A scheduled send arrives from
  // pg_cron with no user at all — dispatch_scheduled_campaigns posts the
  // service role key from Vault (0186), so that is what this accepts.
  //
  // The x-automation-secret variant is kept because send-email-automations
  // has always had it, but it is NOT the path the dispatcher uses:
  // AUTOMATION_WORKER_SECRET appears in no runbook and is almost certainly
  // unset, which makes `!!CRON_SECRET` false and that branch dead.
  // Depending on it alone would 403 every scheduled send — and because
  // _send_due_campaign has already moved the campaign to 'sending', which
  // neither the sweep nor the UI will re-send, the recipients would be
  // stranded rather than retried.
  //
  // The campaign was authorised when it was scheduled, by someone who held
  // the capability then; comms_schedule_campaign is where that is checked.
  const CRON_SECRET = Deno.env.get('AUTOMATION_WORKER_SECRET');
  const authHeaderRaw = req.headers.get('Authorization') ?? '';
  const fromCron =
    authHeaderRaw === `Bearer ${SERVICE_KEY}` ||
    (!!CRON_SECRET && req.headers.get('x-automation-secret') === CRON_SECRET);

  if (!fromCron) {
    const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
      p_gym_id: campaign.gym_id,
      p_capability: 'can_manage_comms',
    });
    if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);
  }

  if (campaign.status !== 'sending') {
    return json({ error: `Campaign is ${campaign.status}, not sending` }, 409);
  }

  const [{ data: settings }, { data: gym }, { data: sendingDomain }] = await Promise.all([
    service.from('gym_comms_settings').select('*').eq('gym_id', campaign.gym_id).maybeSingle(),
    service.from('gyms').select('name').eq('id', campaign.gym_id).single(),
    service
      .from('gym_sending_domains')
      .select('domain, from_local, status')
      .eq('gym_id', campaign.gym_id)
      .maybeSingle(),
  ]);

  const fromName =
    campaign.from_name || settings?.from_name || gym?.name || 'Your gym';
  const replyTo = campaign.reply_to || settings?.reply_to || undefined;

  // Send from the gym's own verified domain when they've authenticated one
  // (DKIM-aligned, their address); otherwise fall back to the shared
  // platform address.
  const fromAddress =
    sendingDomain?.status === 'verified' && sendingDomain.domain
      ? `${sendingDomain.from_local}@${sendingDomain.domain}`
      : RESEND_FROM;

  const { data: recipients, error: rErr } = await service
    .from('email_campaign_recipients')
    .select('id, email, full_name, subject_variant')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued');
  if (rErr) return json({ error: rErr.message }, 500);

  const trackBase = `${SUPABASE_URL}/functions/v1/track`;
  const live = Boolean(RESEND_API_KEY && fromAddress);
  let sent = 0;
  let failed = 0;
  let simulated = 0;

  // Concurrency-limited per-recipient send. A sequential loop at
  // ~200ms per Resend call hits Supabase Edge's 60s wall around the
  // 300-recipient mark, so anything above that times out mid-send
  // and leaves the campaign half-delivered. CONCURRENCY=8 keeps us
  // well inside Resend's per-second rate limits while clearing a
  // 1000-member gym in well under a minute.
  const CONCURRENCY = 8;

  // Stopping a send in flight (0228).
  //
  // comms_stop_campaign flips the campaign to 'cancelled' and skips
  // whatever is still queued. This is the other half: without it the
  // workers would keep draining their in-memory copy of the queue and
  // send the lot regardless of what the database now says.
  //
  // Polled rather than checked per recipient. A read before every email
  // doubles the round-trips on a thousand-member send to buy at most two
  // seconds of responsiveness; every two seconds is well inside the
  // window an owner spotting a mistake actually needs, and costs about
  // thirty reads on the longest send this function can survive.
  const STOP_POLL_MS = 2000;
  let stopped = false;
  let lastStopCheck = Date.now();
  async function shouldStop(): Promise<boolean> {
    if (stopped) return true;
    if (Date.now() - lastStopCheck < STOP_POLL_MS) return false;
    lastStopCheck = Date.now();
    const { data } = await service
      .from('email_campaigns')
      .select('status')
      .eq('id', campaignId)
      .maybeSingle();
    if ((data as { status?: string } | null)?.status === 'cancelled') {
      stopped = true;
    }
    return stopped;
  }

  // Variant 0 is the campaign's own subject; the rest come off
  // subject_variants in order. Assignment was decided and stored at
  // snapshot time (0185) — deciding here would re-roll on a retry and put
  // two different subjects in front of the same person.
  const variants = (campaign.subject_variants ?? []) as string[];
  function subjectFor(variant: number | null): string {
    if (!variant) return campaign.subject || '(no subject)';
    return variants[variant - 1] || campaign.subject || '(no subject)';
  }

  async function deliver(r: {
    id: string;
    email: string;
    full_name: string | null;
    subject_variant: number | null;
  }) {
    const unsubUrl = `${trackBase}?e=u&c=${campaignId}&r=${r.id}`;
    const nowIso = new Date().toISOString();

    if (!live) {
      await service
        .from('email_campaign_recipients')
        .update({ status: 'simulated', sent_at: nowIso })
        .eq('id', r.id);
      await service.from('email_events').insert({
        gym_id: campaign.gym_id,
        campaign_id: campaignId,
        recipient_id: r.id,
        kind: 'simulated',
      });
      simulated += 1;
      return;
    }

    const html = personalize(campaign.compiled_html ?? '', {
      campaignId,
      recipientId: r.id,
      trackBase,
      unsubUrl,
    });
    const text = (campaign.compiled_text ?? '').split(UNSUB_PLACEHOLDER).join(unsubUrl);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          // Idempotency key — if the function is invoked twice (network
          // retry, accidental double-tap) Resend deduplicates and we
          // never double-send to a member. Same per (campaign, recipient).
          'Idempotency-Key': `${campaignId}:${r.id}`,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [r.email],
          subject: subjectFor(r.subject_variant),
          html,
          text,
          reply_to: replyTo,
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            // Signals RFC 8058 one-click unsubscribe. The tracker
            // accepts POSTs and records the opt-out then; the GET
            // shows a confirm page so a corporate scanner / link
            // prefetcher can't auto-unsubscribe a member.
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });
      if (!res.ok) {
        const errTxt = (await res.text()).slice(0, 500);
        await service
          .from('email_campaign_recipients')
          .update({ status: 'failed', error: errTxt })
          .eq('id', r.id);
        await service.from('email_events').insert({
          gym_id: campaign.gym_id,
          campaign_id: campaignId,
          recipient_id: r.id,
          kind: 'failed',
          meta: { error: errTxt },
        });
        failed += 1;
        return;
      }
      const payload = await res.json().catch(() => ({}));
      await service
        .from('email_campaign_recipients')
        .update({
          status: 'sent',
          sent_at: nowIso,
          provider_message_id: payload?.id ?? null,
        })
        .eq('id', r.id);
      await service.from('email_events').insert({
        gym_id: campaign.gym_id,
        campaign_id: campaignId,
        recipient_id: r.id,
        kind: 'sent',
      });
      sent += 1;
    } catch (e) {
      await service
        .from('email_campaign_recipients')
        .update({ status: 'failed', error: String(e).slice(0, 500) })
        .eq('id', r.id);
      failed += 1;
    }
  }

  const queue = [...(recipients ?? [])];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          if (await shouldStop()) return;
          const next = queue.shift();
          if (!next) return;
          await deliver(next);
        }
      })(),
    );
  }
  await Promise.all(workers);

  // A stopped send stays 'cancelled'. It did send, partly, on purpose —
  // 'sent' would claim everyone got it and 'failed' would claim nobody
  // did, and both are wrong about a deliberate half.
  if (!stopped) {
    const finalStatus = sent === 0 && simulated === 0 && failed > 0 ? 'failed' : 'sent';
    await service
      .from('email_campaigns')
      .update({ status: finalStatus, sent_at: new Date().toISOString() })
      .eq('id', campaignId);
  } else {
    // Anything left in the workers' hands when they stopped is still
    // 'queued' in the database — comms_stop_campaign only saw the rows
    // that existed when it ran.
    await service
      .from('email_campaign_recipients')
      .update({
        status: 'skipped',
        error: 'The send was stopped before this one went out',
      })
      .eq('campaign_id', campaignId)
      .eq('status', 'queued');
  }

  return json({
    ok: true,
    mode: live ? 'live' : 'simulated',
    sent,
    failed,
    simulated,
  });
});
