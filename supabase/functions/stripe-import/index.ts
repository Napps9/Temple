// Read a gym's Stripe plan catalogue + existing subscriptions so the owner
// can bring both across to Temple. Owner-gated; reads the gym's connected
// account (the same account stripe-checkout charges on). Returns a
// privacy-shaped preview — distinct active prices (recurring and one-time,
// including ones with no current subscriber, count 0) + a row per
// subscriber — that the client feeds into the existing AI-assisted import
// review wizard. One-time prices carry recurring:false so the client maps
// them to credit packs.
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
  // Reads of a connected account are fine; writes are not. A demo gym
  // keeps its Stripe connection so Billing still looks like a live gym,
  // and this is the line that stops a visitor moving money on it (0278).
  if (await gymIsDemo(service, gymId)) {
    return json({ error: DEMO_NO_MONEY }, 409);
  }

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
  // Amount/currency/interval/recurring for catalogue prices, keyed by price
  // id. Lets a price with no subscriber still carry its real numbers.
  const catalogPrice = new Map<
    string,
    {
      amount_cents: number;
      currency: string;
      interval: string | null;
      recurring: boolean;
    }
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

  // Also list active prices so plans with no current subscriber can still
  // be imported — the owner may be setting up their plan catalogue, not
  // only migrating live members. Both recurring and one-time prices come
  // back (one-time → credit packs on the client). Prices already seen on a
  // subscription keep their metadata.
  let priceAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://api.stripe.com/v1/prices');
    url.searchParams.set('limit', '100');
    url.searchParams.set('active', 'true');
    if (priceAfter) url.searchParams.set('starting_after', priceAfter);

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
    const prices: any[] = data.data ?? [];
    for (const price of prices) {
      const priceId = String(price.id);
      if (!priceMeta.has(priceId)) {
        priceMeta.set(priceId, {
          nickname: price.nickname ? String(price.nickname) : null,
          productId: typeof price.product === 'string' ? price.product : null,
          amount: amountLabel(price),
        });
      }
      if (!catalogPrice.has(priceId)) {
        catalogPrice.set(priceId, {
          amount_cents:
            typeof price.unit_amount === 'number' ? price.unit_amount : 0,
          currency: String(price.currency ?? 'gbp'),
          interval: price.recurring?.interval ?? null,
          recurring: price.type === 'recurring',
        });
      }
    }
    if (!data.has_more) break;
    priceAfter = prices[prices.length - 1]?.id;
    if (!priceAfter) break;
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

  // Every known price — catalogue prices plus any referenced by a live
  // subscription (which may be archived and absent from the catalogue).
  // Seed at count 0 so a price with no subscriber still surfaces; then
  // tally subscribers.
  const priceById = new Map<
    string,
    {
      price_id: string;
      label: string;
      amount_cents: number;
      currency: string;
      interval: string | null;
      recurring: boolean;
      count: number;
    }
  >();
  for (const [priceId, meta] of priceMeta) {
    const cat = catalogPrice.get(priceId);
    const sample = members.find((m) => m.price_id === priceId);
    const productName = meta.productId
      ? productNames.get(meta.productId)
      : undefined;
    priceById.set(priceId, {
      price_id: priceId,
      label: meta.nickname ?? productName ?? meta.amount,
      amount_cents: cat?.amount_cents ?? sample?.amount_cents ?? 0,
      currency: cat?.currency ?? sample?.currency ?? 'gbp',
      interval: cat?.interval ?? sample?.interval ?? null,
      // Subscription-referenced prices absent from the catalogue are
      // recurring by definition; catalogue prices carry their real type.
      recurring: cat?.recurring ?? true,
      count: 0,
    });
  }
  for (const m of members) {
    const existing = priceById.get(m.price_id);
    if (existing) existing.count += 1;
  }

  return json({
    prices: Array.from(priceById.values()),
    members,
    skipped_no_email: skippedNoEmail,
  });
});
