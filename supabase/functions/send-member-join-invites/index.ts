// Push an imported member's join link to their inbox instead of waiting
// on staff to hand out a QR code or open the full campaign editor. Marks
// each successfully-targeted pending_members row 'invited' so the import
// screen (and any later revisit) can tell "never contacted" apart from
// "sent, still waiting on them to sign up" — those two pending_members
// states existed in the schema (0046) but nothing ever wrote 'invited'
// until now.
//
// gym_id + either pending_member_ids (specific rows) or omitted (every
// still-'pending' row for the gym). From-address resolution mirrors
// send-invite / send-campaign.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Email env (no send without these): RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { safeOrigin } from '../_shared/caller.ts';

import { escapeHtml, linkFallbackHtml, templeEmailHtml } from '../_shared/email-layout.ts';
import { loadSuppressed } from '../_shared/suppression.ts';

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

function inviteHtml(gymName: string, joinUrl: string, firstName: string | null): string {
  const g = escapeHtml(gymName);
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  return templeEmailHtml({
    title: `Claim your account at ${gymName}`,
    preheader: `${gymName} moved to Temple — sign up to keep booking classes.`,
    bodyHtml: `<p style="margin:0 0 18px;">
        ${greeting} ${g} now runs on Temple. Sign up with this email address
        to claim your account — your plan and history carry over
        automatically.
      </p>
      ${linkFallbackHtml(joinUrl)}`,
    button: { label: 'Claim your account', url: joinUrl },
    footerNote: "If you weren't expecting this, you can safely ignore this email.",
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
  if (!RESEND_API_KEY) {
    return json({ error: 'Email sending isn’t set up yet' }, 503);
  }

  let body: { gym_id?: string; pending_member_ids?: string[]; origin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  if (!gymId) return json({ error: 'gym_id is required' }, 400);
  // The caller is already authorised below through effective_can as
  // themselves; origin still needs constraining because it lands in the
  // email as the clickable link.
  const origin = await safeOrigin(body.origin, gymId, SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_manage_staff',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  const [{ data: gym }, { data: settings }, { data: sendingDomain }] =
    await Promise.all([
      service.from('gyms').select('name, slug, is_demo').eq('id', gymId).single(),
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
  if (!gym?.slug) return json({ error: 'Set a public join slug first' }, 409);

  const gymName = gym.name ?? 'your gym';
  const fromName = settings?.from_name || gymName;
  const replyTo = settings?.reply_to || undefined;
  const fromAddress =
    sendingDomain?.status === 'verified' && sendingDomain.domain
      ? `${sendingDomain.from_local}@${sendingDomain.domain}`
      : RESEND_FROM;
  if (!fromAddress) {
    return json({ error: 'No verified sending domain or default from-address is set' }, 503);
  }

  const joinUrl = `${origin}/join/${gym.slug}`;

  // Of the six senders this is the only one that read neither
  // email_suppressions nor email_unsubscribes, which is why the imported
  // flag had to be read directly here. It reads all three now.
  //
  // The flag is the refusal the gym's old system carried. A join invite
  // is close to transactional, and 0175 carves a failing payment out of a
  // marketing unsubscribe — this is not that: the person said no before
  // Temple ever had their address.
  let query = service
    .from('pending_members')
    .select('id, email, full_name')
    .eq('gym_id', gymId)
    .eq('status', 'pending')
    .eq('unsubscribed', false);
  if (Array.isArray(body.pending_member_ids) && body.pending_member_ids.length > 0) {
    query = query.in('id', body.pending_member_ids);
  }
  const { data: targets, error: tErr } = await query;
  if (tErr) return json({ error: tErr.message }, 500);
  if (!targets || targets.length === 0) {
    return json({ sent: 0, failed: 0, skipped: 0 });
  }

  // A dead address and a refusal are different facts (0229) and both stop
  // a send. The unsubscribe read is not a duplicate of the flag above: a
  // person can also unsubscribe through a campaign's one-click link while
  // still pending, which the imported flag never learns.
  const suppressed = await loadSuppressed(service, [gymId]);
  const { data: unsubRows } = await service
    .from('email_unsubscribes')
    .select('email')
    .eq('gym_id', gymId)
    .is('topic', null);
  const unsubscribed = new Set(
    (unsubRows ?? []).map((r: { email: string }) => r.email.trim().toLowerCase()),
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of targets as { id: string; email: string; full_name: string | null }[]) {
    // A demo gym rides the suppression path rather than a branch of its own
    // (0278): every row counts as skipped, the caller gets its tally, and no
    // address a visitor typed receives anything.
    if (
      gym.is_demo ||
      suppressed.has(gymId, row.email) ||
      unsubscribed.has(row.email.trim().toLowerCase())
    ) {
      skipped += 1;
      continue;
    }
    const firstName = row.full_name ? row.full_name.trim().split(/\s+/)[0] : null;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'content-type': 'application/json',
          // One send per pending row; dedupes accidental double-taps.
          'Idempotency-Key': `member-join-invite:${row.id}`,
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [row.email],
          subject: `Claim your account at ${gymName}`,
          html: inviteHtml(gymName, joinUrl, firstName),
          text:
            `${gymName} now runs on Temple. Sign up with this email address ` +
            `to claim your account: ${joinUrl}\n\n` +
            `If you weren't expecting this, you can ignore this email.`,
          reply_to: replyTo,
        }),
      });
      if (!res.ok) {
        failed += 1;
        continue;
      }
      const { error: upErr } = await service
        .from('pending_members')
        .update({ status: 'invited' })
        .eq('id', row.id)
        .eq('status', 'pending');
      if (upErr) throw upErr;
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  // skipped is reported, not folded into failed: an owner looking at
  // "0 sent" needs to know the difference between nothing worked and
  // nobody was reachable.
  return json({ sent, failed, skipped });
});
