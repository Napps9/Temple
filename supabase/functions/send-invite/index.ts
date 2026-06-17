// Email a gym invite. The owner/admin picks a role + an address; this
// mints the code through create_invite — run AS THE CALLER, so the same
// role-permission gate applies (an admin can't mint an owner) and no
// separate authorisation is needed here — then emails the accept-invite
// link via Resend. From-address resolution mirrors send-campaign: the
// gym's verified sending domain when they've connected one, else the
// shared platform sender.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Email env (no send without these): RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inviteHtml(gymName: string, role: string, link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a;">You're invited to ${gymName}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#334155;">
        You've been invited to join <strong>${gymName}</strong> on Temple as a ${role}.
        Tap below to set up your account — it only takes a minute.
      </p>
      <a href="${link}" style="display:inline-block;background:#3B6BA5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">Accept invite</a>
      <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
        Or paste this link into your browser:<br>
        <a href="${link}" style="color:#3B6BA5;word-break:break-all;">${link}</a>
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#94a3b8;margin:16px 0 0;">
      If you weren't expecting this invite, you can safely ignore this email.
    </p>
  </div></body></html>`;
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

  let body: { gym_id?: string; role?: string; email?: string; origin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  const role = body.role;
  const email = (body.email ?? '').trim().toLowerCase();
  const origin = (body.origin ?? 'https://app.jointemple.io').replace(/\/+$/, '');
  if (!gymId || !role) return json({ error: 'gym_id and role are required' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Mint the code as the caller so create_invite's role gate applies.
  const { data: code, error: cErr } = await caller.rpc('create_invite', {
    p_gym_id: gymId,
    p_role: role,
    p_expires_at: null,
  });
  if (cErr || !code) {
    return json({ error: cErr?.message ?? 'Could not create the invite' }, 403);
  }
  const inviteCode = code as unknown as string;

  const [{ data: gym }, { data: settings }, { data: sendingDomain }] =
    await Promise.all([
      service.from('gyms').select('name').eq('id', gymId).single(),
      service
        .from('gym_comms_settings')
        .select('from_name, reply_to')
        .eq('gym_id', gymId)
        .maybeSingle(),
      service
        .from('gym_sending_domains')
        .select('domain, from_local, status')
        .eq('gym_id', gymId)
        .maybeSingle(),
    ]);

  const gymName = gym?.name ?? 'your gym';
  const fromName = settings?.from_name || gymName;
  const replyTo = settings?.reply_to || undefined;
  const fromAddress =
    sendingDomain?.status === 'verified' && sendingDomain.domain
      ? `${sendingDomain.from_local}@${sendingDomain.domain}`
      : RESEND_FROM;

  const link = `${origin}/accept-invite?code=${encodeURIComponent(inviteCode)}`;

  // The code is already created — if email isn't configured or fails, we
  // still hand it back so the owner can share it manually.
  if (!RESEND_API_KEY || !fromAddress) {
    return json({ ok: true, sent: false, code: inviteCode });
  }

  const subject = `You're invited to join ${gymName} on Temple`;
  const html = inviteHtml(escapeHtml(gymName), escapeHtml(role), link);
  const text =
    `You've been invited to join ${gymName} on Temple as a ${role}.\n\n` +
    `Accept your invite: ${link}\n\n` +
    `If you weren't expecting this, you can ignore this email.`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'content-type': 'application/json',
        // One invite code = one send; dedupes accidental double-taps.
        'Idempotency-Key': `invite:${inviteCode}`,
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [email],
        subject,
        html,
        text,
        reply_to: replyTo,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return json({
        ok: true,
        sent: false,
        code: inviteCode,
        error: errText.slice(0, 300),
      });
    }
  } catch (e) {
    return json({
      ok: true,
      sent: false,
      code: inviteCode,
      error: String(e).slice(0, 300),
    });
  }

  return json({ ok: true, sent: true, code: inviteCode, to: email });
});
