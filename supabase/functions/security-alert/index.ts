import { templeEmailHtml } from '../_shared/email-layout.ts';

// Ops security-alert notifier. Called by the security-monitor pg_cron job
// (via pg_net) when new security_alerts rows appear — see migration 0111.
// The DB caller has no user JWT, so verify_jwt=false; a shared secret header
// is the auth. Emails a fixed Temple ops address via Resend. Degrades to 503
// (recorded, not emailed) when unconfigured — never a hard dependency.
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const secret = Deno.env.get('SECURITY_ALERT_SECRET');
  if (!secret || req.headers.get('x-security-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  const to = Deno.env.get('SECURITY_ALERT_EMAIL');
  if (!apiKey || !from || !to) {
    return new Response('not configured', { status: 503 });
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
