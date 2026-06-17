# Stripe billing setup (Connect Standard)

Temple bills the marketplace way: each gym connects its **own** Stripe
account (Connect **Standard**) and charges its members directly. Temple
takes **no** application fee — the gym keeps 100%. Phase 1 (live now) is
the connection itself; member charges / subscriptions / webhooks follow.

## One-time platform setup (Temple's Stripe account)

You need one Stripe account that acts as the *platform*. In its dashboard:

1. **Enable Connect** (Connect → Get started) — pick the platform /
   marketplace option.
2. **Connect → Settings → OAuth (Standard)**: note the **client ID**
   (`ca_…`) and register this **redirect URI**:
   `https://<project-ref>.supabase.co/functions/v1/stripe-connect-callback`
   (`<project-ref>` is the host of your `SUPABASE_URL`, e.g.
   `abcd1234.supabase.co`).
3. Copy the platform **secret key** (`sk_…`) from Developers → API keys.

## Supabase edge-function secrets

Set these next to `RESEND_API_KEY` / `ANTHROPIC_API_KEY`
(Supabase → Edge Functions → Secrets):

| Secret | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | platform secret key (`sk_…`) |
| `STRIPE_CONNECT_CLIENT_ID` | Connect OAuth client id (`ca_…`) |

Until both are set, the Connect button returns "Stripe Connect is not
configured yet" — nothing breaks, it just can't start the flow.

## How it flows

1. Owner → Manage → Settings → **Billing & payments → Connect Stripe**.
2. `stripe-connect-start` (owner-gated) mints a single-use `state` and
   returns the Stripe authorize URL; the browser goes to Stripe.
3. The gym signs in / creates an account and authorises Temple.
4. Stripe redirects to `stripe-connect-callback`, which swaps the code
   for the connected account id, stores it on `gym_stripe_accounts`, and
   bounces back to `/management/billing`.

## Test mode first

Do all of this with Stripe in **test mode** (test `sk_…` + test Connect
client id). Connecting a test account is free and reusable. Switch to
live keys when you're ready to take real money.

## Coming next (not built yet)

- Member checkout / subscriptions on the connected account
  (`plan_subscriptions` already models the entitlement side).
- Webhooks → write `billing_events` + update `plan_subscriptions`,
  which flips the `billing_live` flag on and lights up the revenue tiles.
- Cancel / manage a subscription.
