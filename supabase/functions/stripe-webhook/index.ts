// Stripe billing Phase 2 — webhook. Receives Connect events from gyms'
// connected accounts, verifies the signature, and records the result:
//   checkout.session.completed → create/activate the plan_subscription
//   invoice.paid               → extend paid_period_end (renewals), reset
//                                credit_period credits
//   customer.subscription.deleted → mark cancelled
// Every handled payment also writes a billing_events row (idempotent on
// the Stripe event id), which flips the gym's billing_live flag on.
//
// verify_jwt is off — Stripe carries no JWT; the signature is the guard.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//               STRIPE_WEBHOOK_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { templeEmailHtml } from '../_shared/email-layout.ts';

// Verify the Stripe-Signature header (t=…,v1=…) with HMAC-SHA256 over
// `${t}.${rawBody}`, within a 5-minute tolerance.
async function verifySignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (expected.length !== v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return mismatch === 0;
}

async function stripeGet(
  path: string,
  secretKey: string,
  account: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Account': account },
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
      : c === '<' ? '&lt;'
        : c === '>' ? '&gt;'
          : c === '"' ? '&quot;' : '&#39;',
  );
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

// Email the buyer their receipt the moment the order settles — line items,
// totals, the shipping address Stripe captured, and a 7-day signed link
// per digital good (they can always re-download in the app). Best-effort:
// a missing key or a Resend hiccup never blocks settlement.
// deno-lint-ignore no-explicit-any
async function sendStoreReceipt(
  service: any,
  args: { orderId: string; gymId: string; profileId: string },
  env: { resendKey?: string; resendFrom?: string },
): Promise<void> {
  if (!env.resendKey) return;

  const { data: userRes } = await service.auth.admin.getUserById(args.profileId);
  const email: string | undefined = userRes?.user?.email;
  if (!email) return;

  const [{ data: order }, { data: items }, { data: gym }, { data: settings }, { data: domain }] =
    await Promise.all([
      service
        .from('store_orders')
        .select('subtotal_cents, shipping_cents, total_cents, currency, has_physical, shipping_name, shipping_address')
        .eq('id', args.orderId)
        .single(),
      service
        .from('store_order_items')
        .select('id, name_snapshot, kind_snapshot, quantity, line_total_cents')
        .eq('order_id', args.orderId),
      service.from('gyms').select('name').eq('id', args.gymId).single(),
      service
        .from('gym_comms_settings')
        .select('from_name, reply_to')
        .eq('gym_id', args.gymId)
        .maybeSingle(),
      service
        .from('gym_sending_domains')
        .select('domain, from_local, status')
        .eq('gym_id', args.gymId)
        .maybeSingle(),
    ]);
  if (!order) return;

  const fromAddress =
    domain?.status === 'verified' && domain.domain
      ? `${domain.from_local}@${domain.domain}`
      : env.resendFrom;
  if (!fromAddress) return;
  const gymName = gym?.name ?? 'your gym';
  const fromName = settings?.from_name || gymName;
  const cur = order.currency as string;

  const itemRows = (items ?? []) as {
    id: string;
    name_snapshot: string;
    kind_snapshot: string;
    quantity: number;
    line_total_cents: number;
  }[];

  const { data: deliveries } = await service
    .from('store_digital_deliveries')
    .select('name_snapshot, asset_path')
    .in('order_item_id', itemRows.map((i) => i.id).length ? itemRows.map((i) => i.id) : ['']);

  const links: { name: string; url: string }[] = [];
  for (const d of (deliveries ?? []) as { name_snapshot: string; asset_path: string }[]) {
    const { data: signed } = await service.storage
      .from('store-digital-assets')
      .createSignedUrl(d.asset_path, 7 * 24 * 3600);
    if (signed?.signedUrl) links.push({ name: d.name_snapshot, url: signed.signedUrl });
  }

  const itemsHtml = itemRows
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;color:#334155;">${i.quantity}× ${escapeHtml(i.name_snapshot)}</td><td style="padding:6px 0;text-align:right;color:#334155;">${money(i.line_total_cents, cur)}</td></tr>`,
    )
    .join('');
  const shippingRow =
    order.shipping_cents > 0
      ? `<tr><td style="padding:6px 0;color:#64748b;">Shipping</td><td style="padding:6px 0;text-align:right;color:#64748b;">${money(order.shipping_cents, cur)}</td></tr>`
      : '';
  const addr = (order.shipping_address ?? {}) as Record<string, string>;
  const shippingBlock =
    order.has_physical && (order.shipping_name || addr.line1)
      ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#64748b;">Shipping to:<br>${escapeHtml(order.shipping_name ?? '')}<br>${[addr.line1, addr.line2, addr.city, addr.postal_code, addr.country].filter(Boolean).map(escapeHtml).join(', ')}</p>`
      : '';
  const downloadsBlock = links.length
    ? `<div style="margin:20px 0 0;"><p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0f172a;">Your downloads</p>${links
        .map(
          (l) =>
            `<a href="${l.url}" style="display:inline-block;margin:4px 0;background:#3B6BA5;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:8px;">Download ${escapeHtml(l.name)}</a><br>`,
        )
        .join('')}<p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">These links expire in 7 days — you can always re-download from the store in the app.</p></div>`
    : '';

  const html = templeEmailHtml({
    title: 'Thanks for your order',
    preheader: `Your receipt from ${gymName}`,
    bodyHtml: `<p style="margin:0 0 16px;">Here's your receipt from <strong>${escapeHtml(gymName)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${itemsHtml}
        <tr><td style="padding:6px 0;border-top:1px solid #e2e8f0;color:#64748b;">Subtotal</td><td style="padding:6px 0;border-top:1px solid #e2e8f0;text-align:right;color:#64748b;">${money(order.subtotal_cents, cur)}</td></tr>
        ${shippingRow}
        <tr><td style="padding:6px 0;font-weight:700;color:#111111;">Total</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#111111;">${money(order.total_cents, cur)}</td></tr>
      </table>
      ${downloadsBlock}
      ${shippingBlock}`,
    footerNote: `Sent by ${gymName} via Temple.`,
  });

  const text =
    `Thanks for your order from ${gymName}.\n\n` +
    itemRows.map((i) => `${i.quantity}x ${i.name_snapshot} — ${money(i.line_total_cents, cur)}`).join('\n') +
    `\n\nSubtotal: ${money(order.subtotal_cents, cur)}` +
    (order.shipping_cents > 0 ? `\nShipping: ${money(order.shipping_cents, cur)}` : '') +
    `\nTotal: ${money(order.total_cents, cur)}\n` +
    (links.length
      ? `\nDownloads (expire in 7 days, or re-download in the app):\n${links.map((l) => `${l.name}: ${l.url}`).join('\n')}\n`
      : '');

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendKey}`,
        'content-type': 'application/json',
        'Idempotency-Key': `store-receipt:${args.orderId}`,
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [email],
        subject: `Your order from ${gymName}`,
        html,
        text,
        reply_to: settings?.reply_to || undefined,
      }),
    });
  } catch (_e) {
    // best-effort
  }
}

const ok = () =>
  new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

// Upsert a store_subscriptions row from a Stripe subscription object (one
// carrying metadata.kind === 'store_sub'). Creating it from the product
// snapshot also covers the race where invoice.paid lands before
// checkout.session.completed. Returns the row's key fields, or null when
// the subscription isn't a store one.
// deno-lint-ignore no-explicit-any
async function ensureStoreSubscription(
  // deno-lint-ignore no-explicit-any
  service: any,
  // deno-lint-ignore no-explicit-any
  subObj: any,
): Promise<{ id: string; gym_id: string; profile_id: string; currency: string } | null> {
  const meta = subObj?.metadata ?? {};
  if (meta.kind !== 'store_sub') return null;
  const subId: string = subObj.id;

  const items = subObj.items?.data as { current_period_end?: number }[] | undefined;
  const cpe =
    (subObj.current_period_end as number | undefined) ?? items?.[0]?.current_period_end;
  const periodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;
  const cancelAtEnd = !!subObj.cancel_at_period_end;
  const sStatus: string = subObj.status ?? 'active';
  const status =
    sStatus === 'past_due' || sStatus === 'unpaid'
      ? 'past_due'
      : sStatus === 'canceled'
        ? 'cancelled'
        : 'active';

  const { data: existing } = await service
    .from('store_subscriptions')
    .select('id, gym_id, profile_id, currency, status, current_period_end')
    .eq('stripe_subscription_id', subId)
    .maybeSingle();
  if (existing) {
    // 'cancelled' is terminal — a stale/out-of-order subscription.updated
    // event must not resurrect it to active.
    if (existing.status === 'cancelled') return existing;
    const upd: Record<string, unknown> = {
      status,
      cancel_at_period_end: cancelAtEnd,
      updated_at: new Date().toISOString(),
    };
    // Never move the renewal date backwards on a replayed/reordered event.
    if (
      periodEnd &&
      (!existing.current_period_end || periodEnd > existing.current_period_end)
    ) {
      upd.current_period_end = periodEnd;
    }
    await service.from('store_subscriptions').update(upd).eq('id', existing.id);
    return existing;
  }

  const productId: string | undefined = meta.product_id;
  const gymId: string | undefined = meta.gym_id;
  const profileId: string | undefined = meta.profile_id;
  if (!productId || !gymId || !profileId) return null;

  const [{ data: product }, { data: gym }] = await Promise.all([
    service
      .from('store_products')
      .select('name, kind, price_cents, recurring_interval, digital_asset_path')
      .eq('id', productId)
      .maybeSingle(),
    service.from('gyms').select('currency').eq('id', gymId).maybeSingle(),
  ]);
  if (!product) return null;

  const { data: ins } = await service
    .from('store_subscriptions')
    .insert({
      gym_id: gymId,
      profile_id: profileId,
      product_id: productId,
      name_snapshot: product.name,
      kind_snapshot: product.kind,
      unit_price_cents: product.price_cents,
      currency: ((gym?.currency as string) ?? 'gbp').toUpperCase(),
      interval: product.recurring_interval ?? 'month',
      digital_asset_path:
        product.kind === 'digital' ? product.digital_asset_path : null,
      status,
      cancel_at_period_end: cancelAtEnd,
      current_period_end: periodEnd,
      stripe_subscription_id: subId,
      stripe_customer_id: subObj.customer ?? null,
    })
    .select('id, gym_id, profile_id, currency')
    .single();
  return ins ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  // Optional — store receipts simply don't send without them.
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL');
  if (!SUPABASE_URL || !SERVICE_KEY || !STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    return new Response('Function is not configured', { status: 500 });
  }

  const raw = await req.text();
  const sigHeader = req.headers.get('Stripe-Signature') ?? '';
  if (!(await verifySignature(raw, sigHeader, WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const account: string | null = event.account ?? null; // connected account
  const type: string = event.type;
  // deno-lint-ignore no-explicit-any
  const obj: any = event.data?.object ?? {};
  console.log('stripe-webhook received', { type, account, eventId: event.id });

  async function recordBilling(args: {
    gymId: string;
    memberId: string;
    planSubId: string | null;
    kind: string;
    amountCents: number;
    currency: string;
  }) {
    await service.from('billing_events').upsert(
      {
        provider: 'stripe',
        provider_event_id: event.id,
        provider_account_id: account,
        gym_id: args.gymId,
        plan_subscription_id: args.planSubId,
        member_id: args.memberId,
        kind: args.kind,
        amount_cents: args.amountCents,
        currency: args.currency,
        occurred_at: new Date((event.created ?? Date.now() / 1000) * 1000).toISOString(),
        payload: obj,
      },
      { onConflict: 'provider,provider_event_id', ignoreDuplicates: true },
    );
  }

  try {
    if (type === 'checkout.session.completed') {
      const meta = obj.metadata ?? {};

      // Store orders settle through their own path: the dedicated RPC
      // marks paid, decrements stock and grants digital deliveries
      // atomically, then we record the sale and email the receipt.
      if (meta.kind === 'store_order') {
        const orderId: string | undefined = meta.order_id;
        if (!orderId) return ok();
        const shipping =
          obj.shipping_details ?? obj.collected_information?.shipping_details ?? null;
        const shipName: string | null =
          shipping?.name ?? obj.customer_details?.name ?? null;
        const shipAddr = shipping?.address ?? null;
        const { data: settled, error: settleErr } = await service.rpc(
          '_mark_store_order_paid',
          {
            p_session_id: obj.id,
            p_payment_intent:
              typeof obj.payment_intent === 'string' ? obj.payment_intent : null,
            p_amount_total: (obj.amount_total as number) ?? 0,
            p_shipping_name: shipName,
            p_shipping: shipAddr,
          },
        );
        if (settleErr) throw settleErr;
        const row = Array.isArray(settled) ? settled[0] : settled;
        if (row?.newly_paid) {
          await recordBilling({
            gymId: row.gym_id,
            memberId: row.profile_id,
            planSubId: null,
            kind: 'store_order',
            amountCents: (obj.amount_total as number) ?? row.total_cents ?? 0,
            currency: ((obj.currency as string) ?? row.currency ?? 'gbp').toUpperCase(),
          });
          await sendStoreReceipt(
            service,
            { orderId: row.order_id, gymId: row.gym_id, profileId: row.profile_id },
            { resendKey: RESEND_API_KEY, resendFrom: RESEND_FROM },
          );
        }
        return ok();
      }

      // Recurring store products: ensure the store_subscription exists.
      // The first paid cycle (order + receipt) is recorded by invoice.paid.
      if (meta.kind === 'store_sub') {
        const subId: string | null = obj.subscription ?? null;
        if (subId && account) {
          const subObj = await stripeGet(
            `subscriptions/${subId}`,
            STRIPE_SECRET_KEY,
            account,
          );
          const sub = subObj
            ? await ensureStoreSubscription(service, subObj)
            : null;
          // A box subscription collected a delivery address — seed it onto
          // the subscription so each cycle's order ships to the right place.
          const shipping =
            obj.shipping_details ??
            obj.collected_information?.shipping_details ??
            null;
          let shipName: string | null =
            shipping?.name ?? obj.customer_details?.name ?? null;
          let shipAddr = shipping?.address ?? null;
          // Subscription-mode Checkout often attaches the collected shipping
          // to the Customer rather than the Session — fall back to that so a
          // box never lands with no delivery address.
          if (sub && !shipAddr && obj.customer && account) {
            const cust = await stripeGet(
              `customers/${obj.customer}`,
              STRIPE_SECRET_KEY,
              account,
            );
            const cs = cust?.shipping as
              | { name?: string; address?: Record<string, unknown> }
              | undefined;
            if (cs?.address) {
              shipName = cs.name ?? shipName;
              shipAddr = cs.address;
            }
          }
          if (sub && shipAddr) {
            await service
              .from('store_subscriptions')
              .update({
                shipping_name: shipName,
                shipping_address: shipAddr,
                updated_at: new Date().toISOString(),
              })
              .eq('id', sub.id);
          }
        }
        return ok();
      }

      const gymId: string | undefined = meta.gym_id;
      const planId: string | undefined = meta.plan_id;
      const profileId: string | undefined = meta.profile_id;
      if (!gymId || !planId || !profileId) {
        console.warn('stripe-webhook checkout.session.completed: missing metadata', {
          gymId,
          planId,
          profileId,
          sessionId: obj.id,
        });
        return ok();
      }

      const { data: membership } = await service
        .from('gym_memberships')
        .select('id')
        .eq('gym_id', gymId)
        .eq('profile_id', profileId)
        .is('left_at', null)
        .maybeSingle();
      if (!membership) {
        console.warn(
          'stripe-webhook checkout.session.completed: no active gym_membership',
          { gymId, profileId },
        );
        return ok();
      }

      const { data: plan } = await service
        .from('membership_plans')
        .select('plan_id, kind, credit_count')
        .eq('plan_id', planId)
        .maybeSingle();
      if (!plan) {
        console.warn('stripe-webhook checkout.session.completed: plan not found', {
          planId,
        });
        return ok();
      }

      const customerId: string | null = obj.customer ?? null;
      const subId: string | null = obj.subscription ?? null;

      // Credit plans grant their credit_count; unlimited has no balance.
      const creditBalance =
        plan.kind === 'unlimited' ? null : (plan.credit_count as number | null);

      // Recurring plans get their renewal date from the subscription.
      // current_period_end moved off the Subscription onto its items in
      // newer API versions (2025-03+ / dahlia), so read whichever is set —
      // otherwise paid_period_end lands null and the member sees no renewal
      // date until the first invoice.paid.
      let paidPeriodEnd: string | null = null;
      if (subId && account) {
        const sub = await stripeGet(`subscriptions/${subId}`, STRIPE_SECRET_KEY, account);
        const items = (sub?.items as { data?: { current_period_end?: number }[] } | undefined)?.data;
        const cpe =
          (sub?.current_period_end as number | undefined) ??
          items?.[0]?.current_period_end;
        if (cpe) paidPeriodEnd = new Date(cpe * 1000).toISOString();
      }

      const row = {
        gym_membership_id: membership.id,
        profile_id: profileId,
        gym_id: gymId,
        plan_id: planId,
        status: 'active',
        credit_balance: creditBalance,
        paid_period_end: paidPeriodEnd,
        stripe_subscription_id: subId,
        stripe_customer_id: customerId,
        imported_legacy: false,
      };

      // A member converting an imported/legacy plan onto real billing:
      // stripe-checkout verified this row is their own unbilled legacy
      // subscription for this exact plan and minted the id into
      // metadata, so update it in place rather than insert a second
      // row — otherwise the member ends up with two "active" rows for
      // the same plan (the untouched legacy one plus a new live one).
      const legacySubscriptionId = meta.legacy_subscription_id as string | undefined;

      // One row per Stripe subscription; credit packs (no sub) insert fresh
      // so repeat purchases stack as separate credit pools.
      // supabase-js does not throw on a failed write, so every insert /
      // update result is checked: a swallowed error here is a paid member
      // whose subscription silently never lands. Throwing reaches the
      // outer catch → 500 → Stripe retries (billing_events is idempotent).
      let planSubId: string | null = null;
      if (legacySubscriptionId) {
        const { data: updated, error: upErr } = await service
          .from('plan_subscriptions')
          .update(row)
          .eq('id', legacySubscriptionId)
          .select('id')
          .maybeSingle();
        if (upErr) throw upErr;
        planSubId = updated?.id ?? legacySubscriptionId;
      } else if (subId) {
        const { data: existing } = await service
          .from('plan_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subId)
          .maybeSingle();
        if (existing) {
          const { error: upErr } = await service
            .from('plan_subscriptions')
            .update(row)
            .eq('id', existing.id);
          if (upErr) throw upErr;
          planSubId = existing.id;
        } else {
          const { data: ins, error: insErr } = await service
            .from('plan_subscriptions')
            .insert(row)
            .select('id')
            .single();
          if (insErr) throw insErr;
          planSubId = ins?.id ?? null;
        }
      } else {
        const { data: ins, error: insErr } = await service
          .from('plan_subscriptions')
          .insert(row)
          .select('id')
          .single();
        if (insErr) throw insErr;
        planSubId = ins?.id ?? null;
      }

      console.log('stripe-webhook recorded subscription', {
        planSubId,
        gymId,
        profileId,
        planId,
        status: row.status,
      });

      await recordBilling({
        gymId,
        memberId: profileId,
        planSubId,
        kind: 'checkout',
        amountCents: (obj.amount_total as number) ?? 0,
        currency: ((obj.currency as string) ?? 'gbp').toUpperCase(),
      });
    } else if (type === 'invoice.paid') {
      // invoice.subscription was moved onto invoice.parent in newer API
      // versions (2025+/dahlia); read whichever carries it, or every
      // subscription invoice silently stops recording (no member invoice,
      // no renewal-date update).
      const subId: string | null =
        (obj.subscription as string | null | undefined) ??
        (obj.parent?.subscription_details?.subscription as string | undefined) ??
        (obj.subscription_details?.subscription as string | undefined) ??
        null;
      if (!subId) {
        console.warn('stripe-webhook invoice.paid: no subscription on invoice', {
          invoiceId: obj.id,
        });
        return ok();
      }

      // Store subscription? Record this cycle as a paid order (+ a fresh
      // digital delivery) and email the receipt. Idempotent on the invoice.
      let storeSub = (
        await service
          .from('store_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subId)
          .maybeSingle()
      ).data;
      if (!storeSub && account) {
        const subObj = await stripeGet(
          `subscriptions/${subId}`,
          STRIPE_SECRET_KEY,
          account,
        );
        if (subObj?.metadata?.kind === 'store_sub') {
          storeSub = await ensureStoreSubscription(service, subObj);
        }
      }
      if (storeSub) {
        // Backfill a box's delivery address from the invoice when we don't
        // have one yet (covers the race where the first invoice beats the
        // checkout event). Guarded in SQL so it only fills a null physical.
        if (obj.customer_shipping?.address) {
          await service
            .from('store_subscriptions')
            .update({
              shipping_name: obj.customer_shipping.name ?? null,
              shipping_address: obj.customer_shipping.address,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', subId)
            .eq('kind_snapshot', 'physical')
            .is('shipping_address', null);
        }
        const sLine = obj.lines?.data?.[0];
        const sPeriodEnd = sLine?.period?.end as number | undefined;
        const { data: cycle, error: cycErr } = await service.rpc(
          '_record_store_subscription_cycle',
          {
            p_stripe_subscription_id: subId,
            p_stripe_invoice_id: obj.id,
            p_amount_total: (obj.amount_paid as number) ?? 0,
            p_period_end: sPeriodEnd
              ? new Date(sPeriodEnd * 1000).toISOString()
              : null,
          },
        );
        if (cycErr) throw cycErr;
        const crow = Array.isArray(cycle) ? cycle[0] : cycle;
        if (crow?.newly_created) {
          await recordBilling({
            gymId: crow.gym_id,
            memberId: crow.profile_id,
            planSubId: null,
            kind: 'store_subscription',
            amountCents: (obj.amount_paid as number) ?? 0,
            currency: ((obj.currency as string) ?? crow.currency ?? 'gbp').toUpperCase(),
          });
          await sendStoreReceipt(
            service,
            { orderId: crow.order_id, gymId: crow.gym_id, profileId: crow.profile_id },
            { resendKey: RESEND_API_KEY, resendFrom: RESEND_FROM },
          );
        }
        return ok();
      }

      const { data: ps } = await service
        .from('plan_subscriptions')
        .select('id, gym_id, profile_id, plan_id')
        .eq('stripe_subscription_id', subId)
        .maybeSingle();
      // If the checkout event hasn't created the sub yet, skip — it will.
      if (!ps) {
        console.warn('stripe-webhook invoice.paid: no plan_subscription for sub', {
          subId,
        });
        return ok();
      }

      const line = obj.lines?.data?.[0];
      const periodEnd = line?.period?.end as number | undefined;
      const { data: plan } = await service
        .from('membership_plans')
        .select('kind, credit_count')
        .eq('plan_id', ps.plan_id)
        .maybeSingle();

      // deno-lint-ignore no-explicit-any
      const update: any = { status: 'active' };
      if (periodEnd) update.paid_period_end = new Date(periodEnd * 1000).toISOString();
      if (plan?.kind === 'credit_period') update.credit_balance = plan.credit_count;
      const { error: upErr } = await service
        .from('plan_subscriptions')
        .update(update)
        .eq('id', ps.id);
      if (upErr) throw upErr;

      await recordBilling({
        gymId: ps.gym_id,
        memberId: ps.profile_id,
        planSubId: ps.id,
        kind: 'invoice',
        amountCents: (obj.amount_paid as number) ?? 0,
        currency: ((obj.currency as string) ?? 'gbp').toUpperCase(),
      });
    } else if (type === 'customer.subscription.updated') {
      // Keep store subscriptions in sync — cancel-at-period-end toggles,
      // renewal date, past_due. Membership subs carry no store metadata,
      // so this is a no-op for them.
      if (obj.metadata?.kind === 'store_sub') {
        await ensureStoreSubscription(service, obj);
      }
    } else if (type === 'customer.subscription.deleted') {
      const subId: string = obj.id;
      const { error: delErr } = await service
        .from('plan_subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('stripe_subscription_id', subId);
      if (delErr) throw delErr;
      const { error: storeDelErr } = await service
        .from('store_subscriptions')
        .update({
          status: 'cancelled',
          cancel_at_period_end: false,
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subId);
      if (storeDelErr) throw storeDelErr;
    }
  } catch (e) {
    // 500 → Stripe retries; the idempotent billing_events insert makes
    // that safe.
    console.error('stripe-webhook handler error', e);
    return new Response('handler error', { status: 500 });
  }

  return ok();
});
