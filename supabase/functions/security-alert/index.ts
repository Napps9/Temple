import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { templeEmailHtml } from '../_shared/email-layout.ts';

// Ops security-alert notifier. Called by the security-monitor pg_cron job
// (via pg_net) when new security_alerts rows appear — see migration 0111.
// The DB caller has no user JWT, so verify_jwt=false; a shared secret header
// is the auth. The secret is single-sourced in Vault (name
// 'security_alert_secret') and verified via the security_alert_secret_matches
// RPC (0126) — no env-var copy to drift out of sync. Emails the Temple ops
// inbox via Resend; degrades to 503 (recorded, not emailed) when unconfigured.
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response('not configured', { status: 503 });
  }

  const provided = req.headers.get('x-security-secret') ?? '';
  const service = createClient(supabaseUrl, serviceKey);
  const { data: matches, error: verifyErr } = await service.rpc(
    'security_alert_secret_matches',
    { p_provided: provided },
  );
  if (verifyErr || matches !== true) {
    return new Response('unauthorized', { status: 401 });
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  // Single-tenant ops alert — the breach-response inbox (checklist Tier 1.4)
  // is the default when SECURITY_ALERT_EMAIL isn't set explicitly.
  const to = Deno.env.get('SECURITY_ALERT_EMAIL') ?? 'security@jointemple.io';
  if (!apiKey || !from) {
    return new Response('email not configured', { status: 503 });
  }

  let count = 0;
  try {
    const body = await req.json();
    count = Number(body?.new_alerts ?? 0);
  } catch {
    // no/invalid body — send a generic alert
  }

  const html = templeEmailHtml({
    title: 'Security monitor alert',
    bodyHtml:
      `<p>The Temple security monitor recorded <strong>${count}</strong> new ` +
      `alert(s). Review the <code>security_alerts</code> table in Supabase and ` +
      `follow <code>docs/legal/breach-response.md</code>.</p>`,
    footerNote: 'Automated Temple security monitor.',
    preheader: `${count} new security alert(s)`,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Temple security alert (${count} new)`,
      html,
    }),
  });

  if (!res.ok) {
    return new Response('send failed', { status: 502 });
  }
  return new Response('ok', { status: 200 });
});
