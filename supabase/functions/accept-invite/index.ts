// Accept a staff/member invite without the email-confirmation round-trip.
//
// The project has email confirmation on globally (needed for self-serve gym
// and member signups, where the address isn't yet proven). But an invited
// user already proved they own the address by receiving the invite email and
// clicking its link — a second confirmation is pure friction. So for the
// invite path we create the account **pre-confirmed** via the admin API
// (only possible with the service role, hence this function), gated on a
// valid, unused, unexpired invite code. The client then signs straight in and
// binds membership through the existing accept_invite RPC.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: {
    code?: string;
    email?: string;
    password?: string;
    full_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }

  const code = (body.code ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const fullName = (body.full_name ?? '').trim();
  if (!code) return json({ error: 'Missing invite code' }, 400);
  if (!email) return json({ error: 'Enter your email' }, 400);
  if (!password) return json({ error: 'Enter a password' }, 400);
  if (!fullName) return json({ error: 'Enter your full name' }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  // The invite code is the authorisation. Pre-check it here so we never
  // create a confirmed account off an invalid/consumed code (accept_invite
  // re-checks and consumes it once the client signs in).
  const { data: invite, error: inviteErr } = await service
    .from('invite_codes')
    .select('id, used_at, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (inviteErr) return json({ error: 'Could not verify the invite' }, 502);
  if (!invite) return json({ error: 'Invite code not found' }, 404);
  if (invite.used_at) return json({ error: 'This invite has already been used' }, 409);
  if (invite.expires_at && new Date(invite.expires_at as string) < new Date()) {
    return json({ error: 'This invite has expired' }, 409);
  }

  // Create the account already email-confirmed. on_auth_user_created (0042)
  // builds the profiles row from user_metadata.full_name.
  const { error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, pending_invite_code: code },
  });
  if (createErr) {
    const msg = createErr.message ?? '';
    if (createErr.status === 422 || /already|registered|exists/i.test(msg)) {
      return json(
        {
          error:
            'An account with this email already exists — sign in to accept the invite.',
          code: 'account_exists',
        },
        409,
      );
    }
    return json({ error: msg || 'Could not create the account' }, 400);
  }

  return json({ status: 'created' });
});
