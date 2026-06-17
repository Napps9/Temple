// Stripe Connect (Standard) — OAuth callback. Stripe redirects the
// browser here (a GET) after the gym authorises. We validate the
// single-use `state`, exchange the `code` for the connected account id,
// store it on gym_stripe_accounts, and bounce the browser back to the
// app's billing page. verify_jwt is off (Stripe's redirect carries no
// auth header); the server-stored single-use state is the CSRF guard.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const FALLBACK_ORIGIN = 'https://app.jointemple.io';

function redirect(origin: string, status: 'connected' | 'error'): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/management/billing?stripe=${status}` },
  });
}

Deno.serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return redirect(FALLBACK_ORIGIN, 'error');
  }
  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  // Resolve the state first so we know which app origin to return to.
  let stateRow: { gym_id: string; origin: string; created_by: string | null } | null =
    null;
  if (state) {
    const { data } = await service
      .from('stripe_oauth_states')
      .select('gym_id, origin, created_by')
      .eq('state', state)
      .maybeSingle();
    stateRow = data ?? null;
  }
  const appOrigin = stateRow?.origin ?? FALLBACK_ORIGIN;

  // Single-use: drop the token whatever the outcome.
  const burnState = async () => {
    if (state) await service.from('stripe_oauth_states').delete().eq('state', state);
  };

  if (oauthError || !code || !stateRow || !STRIPE_SECRET_KEY) {
    await burnState();
    return redirect(appOrigin, 'error');
  }

  try {
    const res = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_secret: STRIPE_SECRET_KEY,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.stripe_user_id) {
      await burnState();
      return redirect(appOrigin, 'error');
    }

    await service.from('gym_stripe_accounts').upsert({
      gym_id: stateRow.gym_id,
      stripe_account_id: data.stripe_user_id as string,
      connected_by: stateRow.created_by,
      connected_at: new Date().toISOString(),
    });
    await burnState();
    return redirect(appOrigin, 'connected');
  } catch {
    await burnState();
    return redirect(appOrigin, 'error');
  }
});
