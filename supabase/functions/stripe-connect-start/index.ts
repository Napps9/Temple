// Stripe Connect (Standard) — start the OAuth round trip. An owner kicks
// this off; we mint a single-use CSRF `state` (tied to the gym + the app
// origin to return to), store it, and hand back the Stripe authorize URL.
// The browser is sent there; Stripe redirects to stripe-connect-callback.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//               STRIPE_CONNECT_CLIENT_ID (ca_… from the Connect settings)

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
  const CLIENT_ID = Deno.env.get('STRIPE_CONNECT_CLIENT_ID');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  if (!CLIENT_ID) {
    return json({ error: 'Stripe Connect is not configured yet' }, 503);
  }

  let body: { gym_id?: string; origin?: string; return_path?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  const origin = (body.origin ?? 'https://app.jointemple.io').replace(/\/+$/, '');
  // Where to land when Stripe returns. Mirrors the DB's CHECK (0210):
  // one leading slash, no scheme or protocol-relative form, short — the
  // trusted origin is supplied by us, this is only ever a route on it.
  const requested = body.return_path ?? '';
  const returnPath =
    /^\/[A-Za-z0-9._~/-]*$/.test(requested) &&
    !requested.startsWith('//') &&
    requested.length <= 120
      ? requested
      : '/management/billing';
  if (!gymId) return json({ error: 'gym_id is required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Connecting the gym's billing is an owner-only action.
  const { data: isOwner, error: oErr } = await caller.rpc('user_is_owner_of', {
    target_gym_id: gymId,
  });
  if (oErr || isOwner !== true) {
    return json({ error: 'Only an owner can connect Stripe' }, 403);
  }

  // A demo gym already has a connection; what this would do is hand a visitor
  // an OAuth link that attaches somebody's REAL Stripe account to a tenant the
  // next visitor also signs into (0278).
  if (await gymIsDemo(service, gymId)) {
    return json({ error: DEMO_NO_MONEY }, 409);
  }
  const { data: userData } = await caller.auth.getUser();

  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const { error: sErr } = await service.from('stripe_oauth_states').insert({
    state,
    gym_id: gymId,
    origin,
    return_path: returnPath,
    created_by: userData?.user?.id ?? null,
  });
  if (sErr) return json({ error: 'Could not start the connection' }, 500);

  const redirectUri = `${SUPABASE_URL}/functions/v1/stripe-connect-callback`;
  const url =
    'https://connect.stripe.com/oauth/authorize?response_type=code' +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    '&scope=read_write' +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return json({ url });
});
