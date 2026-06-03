// Phase 1 / Track F: platform-only Stripe webhook.
//
// Distinct endpoint and signing secret from the Connect-side webhook
// (supabase/functions/stripe-webhook/). Handles Temple's own Stripe
// account events — non-member tracking subscriptions only. Mixing
// Connect events here would collapse the trust boundary; keeping
// them separate is the §5.4 design call.
//
// Sprint 3 handlers: invoice.paid + customer.subscription.updated.
// payment_failed / payment_action_required can be added with the
// same RPC pattern once the platform-side dunning copy lands.

import Stripe from 'npm:stripe@^17.5.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const stripeSecret = Deno.env.get('STRIPE_PLATFORM_SECRET_KEY') ?? '';
const webhookSecret = Deno.env.get('STRIPE_PLATFORM_WEBHOOK_SECRET') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const stripe = new Stripe(stripeSecret, {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'invoice.paid':
        await handlePlatformInvoicePaid(event);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handlePlatformSubscriptionUpdated(event);
        break;
      default:
        break;
    }
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('platform webhook handler error', event.type, err);
    return new Response('internal', { status: 500 });
  }
});

async function handlePlatformInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subscriptionId) return;

  const firstLine = invoice.lines?.data?.[0];
  const periodEnd = firstLine?.period?.end ?? null;

  const { error } = await supabase.rpc('record_platform_invoice_paid', {
    p_event_id: event.id,
    p_subscription_id: subscriptionId,
    p_amount_cents: invoice.amount_paid ?? 0,
    p_currency: invoice.currency ?? '',
    p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_occurred_at: new Date(event.created * 1000).toISOString(),
    p_payload: invoice as unknown as Record<string, unknown>,
  });
  if (error) throw error;
}

async function handlePlatformSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;

  const { error } = await supabase.rpc('record_platform_subscription_updated', {
    p_event_id: event.id,
    p_subscription_id: subscription.id,
    p_stripe_status: subscription.status,
    p_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    p_cancel_at: subscription.cancel_at
      ? new Date(subscription.cancel_at * 1000).toISOString()
      : null,
    p_occurred_at: new Date(event.created * 1000).toISOString(),
    p_payload: subscription as unknown as Record<string, unknown>,
  });
  if (error) throw error;
}
