// Read a gym's existing Stripe subscriptions so the owner can bring those
// members across to Temple. Owner-gated; reads the gym's connected
// account (the same account stripe-checkout charges on). Returns a
// privacy-shaped preview — distinct prices + a row per subscriber — that
// the client feeds into the existing AI-assisted import review wizard.
//
// Grandfathering: this function only READS Stripe. The import is staged
// through import_pending_members on the client, so each member's live
// Stripe subscription keeps running untouched; Temple records the plan +
// period end and bills nothing until the owner moves them onto a
// Temple-managed plan later.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
// STRIPE_SECRET_KEY.

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

const KEEP_STATUSES = new Set(['active', 'trialing', 'past_due']);

function amountLabel(price: any): string {
  const amount = typeof price?.unit_amount === 'number' ? price.unit_amount : 0;
  const cur = (price?.currency ?? 'gbp').toUpperCase();
  return `${cur} ${(amount / 100).toFixed(2)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }
  if (!STRIPE_SECRET_KEY) return json({ error: 'Stripe is not configured' }, 500);

  let body: { gym_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  if (!gymId) return json({ error: 'gym_id is required' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isOwner, error: oErr } = await caller.rpc('user_is_owner_of', {
    target_gym_id: gymId,
  });
  if (oErr || isOwner !== true) {
    return json({ error: 'Only an owner can import from Stripe' }, 403);
  }

  const { data: acct } = await service
    .from('gym_stripe_accounts')
    .select('stripe_account_id')
    .eq('gym_id', gymId)
    .maybeSingle();
  const account = acct?.stripe_account_id as string | undefined;
  if (!account) return json({ error: 'Connect Stripe first' }, 409);

  const members: {
    email: string;
    name: string | null;
    subscription_id: string;
    customer_id: string | null;
    price_id: string;
    label: string;
    amount_cents: number;
    currency: string;
    interval: string | null;
    current_period_end: number | null;
    status: string;
  }[] = [];
  let skippedNoEmail = 0;
  let startingAfter: string | undefined;
  // Per-price label ingredients. The product name needs a separate fetch —
  // expanding it off the subscription list is 5 levels deep, past Stripe's
  // 4-level expansion cap.
  const priceMeta = new Map<
    string,
    { nickname: string | null; productId: string | null; amount: string }
  >();

  // Page through subscriptions on the connected account (cap at ~2000 so a
  // runaway never hangs the function).
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://api.stripe.com/v1/subscriptions');
    url.searchParams.set('limit', '100');
    url.searchParams.set('status', 'all');
    url.searchParams.append('expand[]', 'data.customer');
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Stripe-Account': account,
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      return json({ error: `Stripe error: ${errText.slice(0, 300)}` }, 502);
    }
    const data = await res.json();
    const subs: any[] = data.data ?? [];
    for (const sub of subs) {
      if (!KEEP_STATUSES.has(sub.status)) continue;
      const cust = sub.customer;
      const item = sub.items?.data?.[0];
      const price = item?.price;
      if (!price) continue;
      const email =
        cust && typeof cust === 'object' ? String(cust.email ?? '').trim().toLowerCase() : '';
      if (!email) {
        skippedNoEmail++;
        continue;
      }
      const priceId = String(price.id);
      if (!priceMeta.has(priceId)) {
        priceMeta.set(priceId, {
          nickname: price.nickname ? String(price.nickname) : null,
          productId: typeof price.product === 'string' ? price.product : null,
          amount: amountLabel(price),
        });
      }
      members.push({
        email,
        name: cust && typeof cust === 'object' ? (cust.name ?? null) : null,
        subscription_id: String(sub.id),
        customer_id:
          cust && typeof cust === 'object'
            ? String(cust.id)
            : typeof cust === 'string'
              ? cust
              : null,
        price_id: String(price.id),
        label: '',
        amount_cents: typeof price.unit_amount === 'number' ? price.unit_amount : 0,
        currency: String(price.currency ?? 'gbp'),
        interval: price.recurring?.interval ?? null,
        current_period_end:
          typeof sub.current_period_end === 'number' ? sub.current_period_end : null,
        status: String(sub.status),
      });
    }
    if (!data.has_more) break;
    startingAfter = subs[subs.length - 1]?.id;
    if (!startingAfter) break;
  }

  // Resolve product names directly. Expanding data.items.data.price.product
  // off the subscription list is 5 levels deep and Stripe caps expansion at
  // 4, so fetch each referenced product on its own instead.
  const productNames = new Map<string, string>();
  const productIds = [
    ...new Set(
      Array.from(priceMeta.values())
        .map((m) => m.productId)
        .filter((id): id is string => !!id),
    ),
  ];
  for (const pid of productIds) {
    const pres = await fetch(`https://api.stripe.com/v1/products/${pid}`, {
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Stripe-Account': account,
      },
    });
    if (pres.ok) {
      const p = await pres.json();
      if (p?.name) productNames.set(pid, String(p.name));
    }
  }
  for (const m of members) {
    const meta = priceMeta.get(m.price_id);
    if (!meta) continue;
    const productName = meta.productId ? productNames.get(meta.productId) : undefined;
    m.label = meta.nickname ?? productName ?? meta.amount;
  }

  const priceById = new Map<
    string,
    {
      price_id: string;
      label: string;
      amount_cents: number;
      currency: string;
      interval: string | null;
      count: number;
    }
  >();
  for (const m of members) {
    const existing = priceById.get(m.price_id) ?? {
      price_id: m.price_id,
      label: m.label,
      amount_cents: m.amount_cents,
      currency: m.currency,
      interval: m.interval,
      count: 0,
    };
    existing.count += 1;
    priceById.set(m.price_id, existing);
  }

  return json({
    prices: Array.from(priceById.values()),
    members,
    skipped_no_email: skippedNoEmail,
  });
});
