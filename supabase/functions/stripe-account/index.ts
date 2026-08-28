// Stripe Connect account health + disconnect for a gym.
//
//   action 'status'      — is the gym's connected account actually reachable
//                          by our platform key, and can it take charges? A
//                          gym_stripe_accounts row existing is NOT enough:
//                          the OAuth grant can be revoked, or the row can
//                          point at an account this key can't access (wrong
//                          platform account / mode) — and the UI would still
//                          show "connected". So we ask Stripe.
//   action 'disconnect'  — best-effort OAuth deauthorize on Stripe's side,
//                          then ALWAYS clear the local row so a gym can never
//                          get stuck "connected" to a dead account (mirrors
//                          sending-domain).
//
// Owner-only (user_is_owner_of), same gate as stripe-connect-start.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//               STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { DEMO_NO_MONEY, gymIsDemo } from '../_shared/demo.ts';

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
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  const CLIENT_ID = Deno.env.get('STRIPE_CONNECT_CLIENT_ID');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  if (!STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe is not configured yet' }, 503);
  }

  let body: { gym_id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  const action = body.action ?? 'status';
  if (!gymId) return json({ error: 'gym_id is required' }, 400);
  if (action !== 'status' && action !== 'disconnect') {
    return json({ error: 'Unknown action' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isOwner, error: oErr } = await caller.rpc('user_is_owner_of', {
    target_gym_id: gymId,
  });
  if (oErr || isOwner !== true) {
    return json({ error: 'Only an owner can manage billing' }, 403);
  }

  const { data: row } = await service
    .from('gym_stripe_accounts')
    .select('stripe_account_id')
    .eq('gym_id', gymId)
    .maybeSingle();
  const accountId = (row?.stripe_account_id as string | undefined) ?? undefined;

  if (action === 'disconnect') {
    // Best-effort: revoke the OAuth grant on Stripe. A failure here (e.g.
    // the grant is already gone, or the key can't see the account) must
    // never block clearing the local row — otherwise the gym stays stuck.
    if (await gymIsDemo(service, gymId)) {
      return json({ error: DEMO_NO_MONEY }, 409);
    }
    if (accountId && CLIENT_ID) {
      try {
        await fetch('https://connect.stripe.com/oauth/deauthorize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            stripe_user_id: accountId,
          }).toString(),
        });
      } catch {
        // ignore — clear locally regardless
      }
    }
    // The 'status' action below is a plain read of the connected account and
    // stays available — it is what keeps /management/billing, a tour stop,
    // looking like a live gym. This one deauthorises the account at Stripe,
    // which would take the demo's own billing apart (0278).
    const { error: dErr } = await service
      .from('gym_stripe_accounts')
      .delete()
      .eq('gym_id', gymId);
    if (dErr) return json({ error: dErr.message }, 500);
    return json({ ok: true });
  }

  // action === 'status'
  if (!accountId) return json({ connected: false });

  const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) {
    return json({
      connected: true,
      reachable: false,
      accountId,
      error:
        (data as { error?: { message?: string } })?.error?.message ??
        'Stripe could not verify this account.',
    });
  }
  const acct = data as {
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
  };
  return json({
    connected: true,
    reachable: true,
    accountId,
    chargesEnabled: !!acct.charges_enabled,
    payoutsEnabled: !!acct.payouts_enabled,
    detailsSubmitted: !!acct.details_submitted,
  });
});
