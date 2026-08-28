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

import { escapeHtml, linkFallbackHtml, templeEmailHtml } from '../_shared/email-layout.ts';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Takes raw (unescaped) gymName/role — templeEmailHtml escapes the title
// and preheader, and the body escapes its own interpolations.
function inviteHtml(gymName: string, role: string, link: string): string {
  const g = escapeHtml(gymName);
  const r = escapeHtml(role);
  return templeEmailHtml({
    title: `You're invited to ${gymName}`,
    preheader: `Join ${gymName} on Temple as a ${role}.`,
    bodyHtml: `<p style="margin:0 0 18px;">
        You've been invited to join <strong>${g}</strong> on Temple as a ${r}.
        Tap below to set up your account — it only takes a minute.
      </p>
      ${linkFallbackHtml(link)}`,
    button: { label: 'Accept invite', url: link },
    footerNote: "If you weren't expecting this invite, you can safely ignore this email.",
  });
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
      service.from('gyms').select('name, is_demo').eq('id', gymId).single(),
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
  // still hand it back so the owner can share it manually. Say what's
  // missing so the owner knows it's a setup gap, not a transient error.
  // A demo gym joins the same branch (0278). This is the best-shaped guard
  // on the list: the code is already created and handed back, the UI already
  // says "share this code manually", and the visitor sees the whole invite
  // flow work — while an address they typed gets no mail. Sending it is the
  // sharpest single risk in the product, because the recipient is whoever
  // they say it is.
  if (!RESEND_API_KEY || !fromAddress || gym?.is_demo !== false) {
    const missing = gym?.is_demo !== false
      ? 'this is a demo gym, so Temple doesn’t email its invites — the code above still works'
      : !RESEND_API_KEY
        ? 'email sending isn’t set up yet'
        : 'no verified sending domain or default from-address is set';
    return json({ ok: true, sent: false, code: inviteCode, error: missing });
  }

  const subject = `You're invited to join ${gymName} on Temple`;
  const html = inviteHtml(gymName, role, link);
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
