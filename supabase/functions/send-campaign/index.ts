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

function personalize(
  html: string,
  ctx: { campaignId: string; recipientId: string; trackBase: string; unsubUrl: string },
): string {
  // Wrap absolute http(s) links so clicks redirect through the tracker.
  // The unsubscribe placeholder isn't an http link yet, so it's skipped
  // here and substituted below.
  let out = html.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url) => {
    const wrapped = `${ctx.trackBase}?e=c&c=${ctx.campaignId}&r=${ctx.recipientId}&u=${encodeURIComponent(
      url,
    )}`;
    return `href="${wrapped}"`;
  });
  out = out.split(UNSUB_PLACEHOLDER).join(ctx.unsubUrl);
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

  // Re-authorise as the caller (the service client above bypasses RLS).
  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: campaign.gym_id,
    p_capability: 'can_manage_comms',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  if (campaign.status !== 'sending') {
    return json({ error: `Campaign is ${campaign.status}, not sending` }, 409);
  }

  const [{ data: settings }, { data: gym }] = await Promise.all([
    service.from('gym_comms_settings').select('*').eq('gym_id', campaign.gym_id).maybeSingle(),
    service.from('gyms').select('name').eq('id', campaign.gym_id).single(),
  ]);

  const fromName =
    campaign.from_name || settings?.from_name || gym?.name || 'Your gym';
  const replyTo = campaign.reply_to || settings?.reply_to || undefined;

  const { data: recipients, error: rErr } = await service
    .from('email_campaign_recipients')
    .select('id, email, full_name')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued');
  if (rErr) return json({ error: rErr.message }, 500);

  const trackBase = `${SUPABASE_URL}/functions/v1/track`;
  const live = Boolean(RESEND_API_KEY && RESEND_FROM);
  let sent = 0;
  let failed = 0;
  let simulated = 0;

  for (const r of recipients ?? []) {
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
      continue;
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
        },
        body: JSON.stringify({
          from: `${fromName} <${RESEND_FROM}>`,
          to: [r.email],
          subject: campaign.subject || '(no subject)',
          html,
          text,
          reply_to: replyTo,
          headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
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
        continue;
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

  const finalStatus = sent === 0 && simulated === 0 && failed > 0 ? 'failed' : 'sent';
  await service
    .from('email_campaigns')
    .update({ status: finalStatus, sent_at: new Date().toISOString() })
    .eq('id', campaignId);

  return json({
    ok: true,
    mode: live ? 'live' : 'simulated',
    sent,
    failed,
    simulated,
  });
});
