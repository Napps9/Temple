// Phase 1 / Track A: Stripe Connect webhook receiver.
//
// The webhook is the only writer of pending|scheduled → active and
// active → lapsed for plan_subscriptions. State mutations are
// delegated to SECURITY DEFINER RPCs (record_invoice_paid /
// record_subscription_updated) so the billing_events insert, the
// status update, and the audit_events emit happen atomically.
//
// Idempotency is rooted in billing_events.(provider, provider_event_id)
// — replays return 200 without re-applying.
//
// Sprint 1 scope: invoice.paid + customer.subscription.updated.
// Later sprints add invoice.payment_failed (with inline dunning
// enqueue), invoice.payment_action_required, charge.refunded,
// account.updated, payment_method.attached|detached.

import Stripe from 'npm:stripe@^17.5.0';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
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
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('missing stripe-signature', { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
    );
  } catch (err) {
    return new Response(
      `invalid signature: ${(err as Error).message}`,
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'invoice.paid':
        await handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event);
        break;
      case 'invoice.payment_action_required':
        await handleInvoicePaymentActionRequired(event);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event);
        break;
      default:
        // Unhandled event types still return 200 so Stripe stops
        // retrying. Unknown types are expected during rollout.
        break;
    }
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('webhook handler error', event.type, err);
    return new Response('internal', { status: 500 });
  }
});

function stripeRecurringToInterval(
  recurring: Stripe.Price.Recurring | null | undefined,
): string | null {
  if (!recurring?.interval || !recurring.interval_count) return null;
  // Postgres parses "1 month", "3 month", "7 day", "1 year".
  return `${recurring.interval_count} ${recurring.interval}`;
}

async function handleInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subscriptionId) return;

  // Connect events carry the connected account id on the envelope.
  const accountId = event.account ?? null;

  // The covered period ends at lines[0].period.end for the renewal.
  const firstLine = invoice.lines?.data?.[0];
  const periodEnd = firstLine?.period?.end ?? null;
  const billingInterval = stripeRecurringToInterval(firstLine?.price?.recurring);

  const { error } = await supabase.rpc('record_invoice_paid', {
    p_event_id: event.id,
    p_account_id: accountId,
    p_subscription_id: subscriptionId,
    p_amount_cents: invoice.amount_paid ?? 0,
    p_currency: invoice.currency ?? '',
    p_paid_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_billing_interval: billingInterval,
    p_occurred_at: new Date(event.created * 1000).toISOString(),
    p_payload: invoice as unknown as Record<string, unknown>,
  });
  if (error) throw error;
}

async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subscriptionId) return;

  const { error } = await supabase.rpc('record_invoice_payment_failed', {
    p_event_id: event.id,
    p_subscription_id: subscriptionId,
    p_occurred_at: new Date(event.created * 1000).toISOString(),
  });
  if (error) throw error;
}

async function handleInvoicePaymentActionRequired(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subscriptionId) return;

  const { error } = await supabase.rpc(
    'record_invoice_payment_action_required',
    {
      p_event_id: event.id,
      p_subscription_id: subscriptionId,
      p_occurred_at: new Date(event.created * 1000).toISOString(),
    },
  );
  if (error) throw error;
}

async function handleSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const accountId = event.account ?? null;
  const firstItem = subscription.items?.data?.[0];
  const billingInterval = stripeRecurringToInterval(firstItem?.price?.recurring);

  const { error } = await supabase.rpc('record_subscription_updated', {
    p_event_id: event.id,
    p_account_id: accountId,
    p_subscription_id: subscription.id,
    p_stripe_status: subscription.status,
    p_paid_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    p_billing_interval: billingInterval,
    p_occurred_at: new Date(event.created * 1000).toISOString(),
    p_payload: subscription as unknown as Record<string, unknown>,
  });
  if (error) throw error;
}
