// Store checkout — opens a Stripe Checkout session (direct charge, no
// platform fee) for a basket of store items on the gym's connected
// account, and records a pending store_orders row the webhook settles.
//
// Prices, stock and the shipping fee are all resolved server-side from the
// catalogue under the service role — the client only sends product ids and
// quantities, never amounts. Physical baskets switch on Stripe's address
// collection + a flat shipping line; all-digital baskets skip both.
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

// Countries Stripe will let the buyer pick a shipping address from. Broad
// enough to cover where gyms and their members are; Stripe rejects codes
// it doesn't support, so this stays a curated list.
const SHIP_TO = [
  'GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE',
  'SE', 'NO', 'DK', 'FI', 'PT', 'AT', 'CH', 'PL', 'CZ', 'GR', 'JP', 'SG',
  'AE', 'ZA', 'MX', 'BR',
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

async function stripe(
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

type ProductRow = {
  id: string;
  name: string;
  kind: 'physical' | 'digital';
  price_cents: number;
  image_url: string | null;
  track_inventory: boolean;
  stock_quantity: number | null;
  active: boolean;
  archived_at: string | null;
  digital_asset_path: string | null;
  recurring: boolean;
  recurring_interval: string | null;
  stripe_price_id: string | null;
};

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
  if (!STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe is not configured yet' }, 503);
  }

  let body: {
    gym_id?: string;
    items?: { product_id?: string; quantity?: number }[];
    origin?: string;
    success_path?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  const gymId = body.gym_id;
  const origin = (body.origin ?? 'https://app.jointemple.io').replace(/\/+$/, '');
  const successPath =
    typeof body.success_path === 'string' &&
    body.success_path.startsWith('/') &&
    !body.success_path.startsWith('//')
      ? body.success_path
      : '/store?checkout=success';
  if (!gymId) return json({ error: 'gym_id is required' }, 400);

  // Normalise the basket: positive integer quantities, one entry per
  // product, a sane cap so a bad client can't build a huge session.
  const wanted = new Map<string, number>();
  for (const raw of body.items ?? []) {
    const pid = raw?.product_id;
    const qty = Math.floor(Number(raw?.quantity ?? 0));
    if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
    wanted.set(pid, Math.min(99, (wanted.get(pid) ?? 0) + qty));
  }
  if (wanted.size === 0) return json({ error: 'Your basket is empty' }, 400);
  if (wanted.size > 20) return json({ error: 'Too many items in one order' }, 400);

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await caller.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  const { data: mem } = await caller
    .from('gym_memberships')
    .select('role')
    .eq('gym_id', gymId)
    .eq('profile_id', user.id)
    .is('left_at', null)
    .maybeSingle();
  if (!mem) return json({ error: 'Not a member of this gym' }, 403);

  const { data: gym } = await service
    .from('gyms')
    .select('currency, store_enabled, store_shipping_fee_cents')
    .eq('id', gymId)
    .single();
  if (!gym?.store_enabled) {
    return json({ error: 'The store is not open at this gym' }, 409);
  }
  const currency = (gym.currency ?? 'gbp').toLowerCase();

  const { data: acct } = await service
    .from('gym_stripe_accounts')
    .select('stripe_account_id')
    .eq('gym_id', gymId)
    .maybeSingle();
  if (!acct?.stripe_account_id) {
    return json({ error: 'This gym has not connected Stripe yet' }, 409);
  }
  const account = acct.stripe_account_id as string;

  const { data: products } = await service
    .from('store_products')
    .select(
      'id, name, kind, price_cents, image_url, track_inventory, stock_quantity, active, archived_at, digital_asset_path, recurring, recurring_interval, stripe_price_id',
    )
    .eq('gym_id', gymId)
    .in('id', [...wanted.keys()]);
  const byId = new Map<string, ProductRow>(
    ((products ?? []) as ProductRow[]).map((p) => [p.id, p]),
  );

  type Line = {
    product: ProductRow;
    quantity: number;
    lineTotal: number;
  };
  const lines: Line[] = [];
  let subtotal = 0;
  let hasPhysical = false;
  for (const [pid, qty] of wanted) {
    const product = byId.get(pid);
    if (!product || !product.active || product.archived_at) {
      return json({ error: 'One of those items is no longer available' }, 409);
    }
    if (product.track_inventory && (product.stock_quantity ?? 0) < qty) {
      return json(
        { error: `Not enough stock for ${product.name}` },
        409,
      );
    }
    if (product.kind === 'physical') hasPhysical = true;
    const lineTotal = product.price_cents * qty;
    subtotal += lineTotal;
    lines.push({ product, quantity: qty, lineTotal });
  }

  // Recurring products are a subscription, bought one at a time: open a
  // subscription-mode session on a cached recurring Price. The webhook
  // creates the store_subscription and records each paid cycle as an order.
  const recurringLines = lines.filter((l) => l.product.recurring);
  if (recurringLines.length > 0) {
    if (lines.length !== 1) {
      return json(
        { error: 'Subscriptions must be bought on their own' },
        400,
      );
    }
    const product = recurringLines[0].product;
    const interval = product.recurring_interval ?? 'month';
    try {
      let customerId: string;
      const { data: existingCust } = await service
        .from('gym_stripe_customers')
        .select('stripe_customer_id')
        .eq('gym_id', gymId)
        .eq('profile_id', user.id)
        .maybeSingle();
      if (existingCust?.stripe_customer_id) {
        customerId = existingCust.stripe_customer_id as string;
      } else {
        const cust = await stripe(
          'customers',
          {
            email: user.email ?? '',
            'metadata[gym_id]': gymId,
            'metadata[profile_id]': user.id,
          },
          STRIPE_SECRET_KEY,
          account,
        );
        customerId = cust.id as string;
        await service.from('gym_stripe_customers').upsert({
          gym_id: gymId,
          profile_id: user.id,
          stripe_customer_id: customerId,
        });
      }

      // Recurring Price, created lazily and cached on the product. Cleared
      // by staff edits so a price change takes effect for new subscribers.
      let priceId = product.stripe_price_id;
      if (!priceId) {
        const prod = await stripe(
          'products',
          { name: product.name },
          STRIPE_SECRET_KEY,
          account,
        );
        const price = await stripe(
          'prices',
          {
            product: prod.id as string,
            currency,
            unit_amount: String(product.price_cents),
            'recurring[interval]': interval,
          },
          STRIPE_SECRET_KEY,
          account,
        );
        priceId = price.id as string;
        await service
          .from('store_products')
          .update({ stripe_price_id: priceId })
          .eq('id', product.id);
      }

      const subParams: Record<string, string> = {
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: `${origin}${successPath}`,
        cancel_url: `${origin}/store?checkout=cancelled`,
        'metadata[kind]': 'store_sub',
        'metadata[product_id]': product.id,
        'metadata[gym_id]': gymId,
        'metadata[profile_id]': user.id,
        'subscription_data[metadata][kind]': 'store_sub',
        'subscription_data[metadata][product_id]': product.id,
        'subscription_data[metadata][gym_id]': gymId,
        'subscription_data[metadata][profile_id]': user.id,
      };
      const session = await stripe(
        'checkout/sessions',
        subParams,
        STRIPE_SECRET_KEY,
        account,
      );
      return json({ url: session.url });
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e) }, 502);
    }
  }

  const shipping = hasPhysical ? (gym.store_shipping_fee_cents ?? 0) : 0;
  const total = subtotal + shipping;

  // Record the pending order first so the session id can be stamped onto
  // it; the webhook keys off stripe_checkout_session_id.
  const { data: order, error: orderErr } = await service
    .from('store_orders')
    .insert({
      gym_id: gymId,
      profile_id: user.id,
      status: 'pending',
      subtotal_cents: subtotal,
      shipping_cents: shipping,
      total_cents: total,
      currency: currency.toUpperCase(),
      has_physical: hasPhysical,
    })
    .select('id')
    .single();
  if (orderErr || !order) {
    return json({ error: 'Could not start the order' }, 500);
  }

  const { error: itemsErr } = await service.from('store_order_items').insert(
    lines.map((l) => ({
      order_id: order.id,
      gym_id: gymId,
      product_id: l.product.id,
      name_snapshot: l.product.name,
      kind_snapshot: l.product.kind,
      unit_price_cents: l.product.price_cents,
      quantity: l.quantity,
      line_total_cents: l.lineTotal,
    })),
  );
  if (itemsErr) {
    return json({ error: 'Could not start the order' }, 500);
  }

  try {
    const params: Record<string, string> = {
      mode: 'payment',
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}/store?checkout=cancelled`,
      'metadata[kind]': 'store_order',
      'metadata[order_id]': order.id,
      'metadata[gym_id]': gymId,
      'metadata[profile_id]': user.id,
      'payment_intent_data[metadata][kind]': 'store_order',
      'payment_intent_data[metadata][order_id]': order.id,
      'payment_intent_data[metadata][gym_id]': gymId,
      'payment_intent_data[metadata][profile_id]': user.id,
    };
    if (user.email) params['customer_email'] = user.email;

    lines.forEach((l, i) => {
      params[`line_items[${i}][price_data][currency]`] = currency;
      params[`line_items[${i}][price_data][unit_amount]`] = String(
        l.product.price_cents,
      );
      params[`line_items[${i}][price_data][product_data][name]`] = l.product.name;
      if (l.product.image_url) {
        params[`line_items[${i}][price_data][product_data][images][0]`] =
          l.product.image_url;
      }
      params[`line_items[${i}][quantity]`] = String(l.quantity);
    });

    if (hasPhysical) {
      SHIP_TO.forEach((c, i) => {
        params[`shipping_address_collection[allowed_countries][${i}]`] = c;
      });
      if (shipping > 0) {
        params['shipping_options[0][shipping_rate_data][type]'] = 'fixed_amount';
        params['shipping_options[0][shipping_rate_data][display_name]'] =
          'Shipping';
        params['shipping_options[0][shipping_rate_data][fixed_amount][amount]'] =
          String(shipping);
        params[
          'shipping_options[0][shipping_rate_data][fixed_amount][currency]'
        ] = currency;
      }
    }

    const session = await stripe(
      'checkout/sessions',
      params,
      STRIPE_SECRET_KEY,
      account,
    );

    await service
      .from('store_orders')
      .update({ stripe_checkout_session_id: session.id as string })
      .eq('id', order.id);

    return json({ url: session.url });
  } catch (e) {
    // Leave the pending order behind for support; it never settles without
    // a matching paid session, and the member simply sees the error.
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
