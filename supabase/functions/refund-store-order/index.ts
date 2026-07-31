// Refunding a shop order.
//
// store_order_status has allowed 'refunded' since the shop was built and
// nothing wrote it: no screen, no RPC, no function. A member who ordered
// the wrong size was refunded in the Stripe dashboard and the order sat
// in Temple saying 'paid' for ever.
//
// Same shape as stripe-refund, which does memberships: the secret key
// never goes near a client, the refund runs on the gym's connected
// account, and the amount is recomputed here rather than trusted from the
// request. What differs is everything after the money moves — stock,
// digital deliveries, the order's status — and that lives in
// _refund_store_order (0225), because it is the gym's business logic
// rather than Stripe's.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//               STRIPE_SECRET_KEY

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

async function stripePost(
  path: string,
  params: Record<string, string>,
  secretKey: string,
  account: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Account': account,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data as { error?: { message?: string } })?.error?.message ??
        `Stripe ${path} failed`,
    );
  }
  return data as Record<string, unknown>;
}

// A partial refund is a number the owner typed, so it is clamped to the
// order total rather than believed. Zero or absent means all of it.
function refundCents(requested: unknown, total: number): number {
  if (requested === null || requested === undefined) return total;
  const n = typeof requested === 'number' ? requested : Number(requested);
  if (!Number.isFinite(n) || n <= 0) return total;
  const r = Math.round(n);
  return r > total ? total : r;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Server not configured' }, 500);
  }
  if (!STRIPE_SECRET_KEY) return json({ error: 'Stripe is not configured yet' }, 503);

  let body: { order_id?: string; custom_cents?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body' }, 400);
  }
  const orderId = body.order_id;
  if (!orderId) return json({ error: 'order_id is required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401);

  try {
    const { data: orderRow } = await service
      .from('store_orders')
      .select(
        'id, gym_id, profile_id, status, total_cents, currency, stripe_payment_intent_id, fulfilled_at',
      )
      .eq('id', orderId)
      .maybeSingle();
    const order = orderRow as
      | {
          id: string;
          gym_id: string;
          profile_id: string;
          status: string;
          total_cents: number;
          currency: string;
          stripe_payment_intent_id: string | null;
          fulfilled_at: string | null;
        }
      | null;
    if (!order) return json({ error: 'Order not found' }, 404);

    // The same capability the membership refund asks for. A refund is a
    // refund whatever it is against, and an owner who trusts somebody with
    // one trusts them with the other.
    const { data: canRefund } = await caller.rpc('effective_can', {
      p_gym_id: order.gym_id,
      p_capability: 'can_refund',
    });
    if (!canRefund) return json({ error: 'Not allowed' }, 403);

    if (order.status === 'refunded') {
      return json({ error: 'That order has already been refunded' }, 409);
    }
    if (order.status === 'pending' || order.status === 'cancelled') {
      return json({ error: 'That order was never paid for' }, 409);
    }
    if (!order.stripe_payment_intent_id) {
      return json({ error: 'That order has no Stripe payment to refund' }, 409);
    }

    const { data: acctRow } = await service
      .from('gym_stripe_accounts')
      .select('stripe_account_id')
      .eq('gym_id', order.gym_id)
      .maybeSingle();
    const account = acctRow?.stripe_account_id as string | undefined;
    if (!account) return json({ error: 'This gym has not connected Stripe yet' }, 409);

    const cents = refundCents(body.custom_cents, order.total_cents);
    if (cents <= 0) return json({ error: 'There is nothing to refund' }, 409);

    await stripePost(
      'refunds',
      {
        payment_intent: order.stripe_payment_intent_id,
        amount: String(cents),
        'metadata[gym_id]': order.gym_id,
        'metadata[store_order_id]': order.id,
      },
      STRIPE_SECRET_KEY,
      account,
    );

    // Stripe has the money back before Temple changes anything. The other
    // order — mark it refunded, then refund — leaves an order claiming a
    // refund that never happened if Stripe declines.
    const { error: rpcErr } = await service.rpc('_refund_store_order', {
      p_order_id: order.id,
      p_refund_cents: cents,
      p_actor: userData.user.id,
    });
    if (rpcErr) throw rpcErr;

    return json({
      refundCents: cents,
      currency: order.currency,
      restocked: order.fulfilled_at === null,
    });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Refund failed' }, 500);
  }
});
