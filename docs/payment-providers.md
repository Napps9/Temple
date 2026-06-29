# Payment provider research — adding a second provider alongside Stripe

> Research note (2026-06). Temple integrates Stripe Connect (Standard)
> today: per-gym OAuth onboarding (`stripe-connect-start`/`-callback`),
> `stripe-checkout` / `store-checkout`, and one `stripe-webhook` keyed off
> the connected account. Subscriptions live in `plan_subscriptions` /
> `store_subscriptions`. There is already a `billing_events` table with a
> `provider` column — a clean seam to generalise behind.

**Per-provider API references** (read from the live docs, mapped to our
four integration seams — onboard / create-subscription / webhook-settle /
cancel): [`docs/payments/gocardless.md`](payments/gocardless.md) ·
[`docs/payments/square.md`](payments/square.md) ·
[`docs/payments/paypal.md`](payments/paypal.md).

UK, 2025–2026 pricing from official pages where possible. Stripe baseline:
**1.5% + 20p** standard UK cards online, **+0.5%** recurring via Billing;
Connect Standard means the **gym pays Stripe directly and the platform
takes no cut** — the model to preserve.

## 1. GoCardless — Bank Direct Debit (the UK-native one)

- **Why a gym wants it.** Pulls money straight from the member's bank via
  Bacs Direct Debit. UK gyms run on Direct Debit culture — stickier than
  cards (no card-expiry churn, low involuntary churn) and materially
  cheaper. Instant Bank Pay (open-banking A2A) covers one-off buys too.
- **Fees.** Standard **1% + 20p, capped at £4** per transaction, no
  monthly fee. On a £40/mo membership ~60p vs Stripe's ~£1.00; the cap
  makes it dramatically cheaper on high-value plans.
- **Recurring.** Its core product — mandates + subscriptions are
  first-class and very mature.
- **Multi-tenant.** Yes — **Partner / connected-merchants** model is the
  direct Connect equivalent: register a Partner account, onboard each gym
  via OAuth 2 to their own GoCardless organisation, store the org ID,
  funds settle to the gym. Maps ~1:1 onto `stripe-connect-start`.
- **Webhooks.** `mandates`, `payments`, `subscriptions`, `payouts`,
  carrying the organisation ID; HMAC signed, retried.
- **Risks.** Slow settlement (5–7 working days first payment, T+2/T+3
  recurring); **late-failing** payments (`charged_back` can arrive days
  after "submitted") — the subscription state machine must tolerate
  pending→active→maybe-failed-later; UK/SEPA-centric; bank debit only.

## 2. Square

- **Why.** All-in-one POS. Real pull is **in-person / front-desk**:
  drop-ins, merch, PT at reception on a Square reader, reconciled with the
  same account. Strong for the store and walk-ins; weak as a reason to
  switch recurring membership billing.
- **Fees.** Online **1.4% + 25p** (UK); in-person **1.75%**; recurring via
  Square Invoices **2.5%** (worse than Stripe+Billing).
- **Recurring.** Exists but less developer-flexible, oriented to Square's
  POS/Invoices ecosystem.
- **Multi-tenant.** OAuth-based multi-merchant access (per-merchant tokens)
  — workable but **not** a turnkey split-settlement marketplace product
  like Connect; you manage token refresh yourself.
- **Risks.** Weakest multi-tenant story for pure online recurring; token
  management overhead; unattractive recurring rate. Best framed as a
  future POS/store add-on.

## 3. PayPal

- **Why.** Ubiquitous wallet — "Pay with PayPal" adds buyer trust /
  conversion for one-off buys.
- **Fees.** ~**2.9% + 30p** UK online — noticeably more than Stripe.
- **Recurring.** Subscriptions API is mature but a different model (billing
  plans + reference transactions).
- **Multi-tenant.** **Commerce Platform / Multiparty (Partner Referrals)**
  is the Connect equivalent — but the **Partner Referrals onboarding API is
  officially deprecated** (existing integrations supported, no new
  features). Confirm the current recommended onboarding path before
  building anything new.
- **Webhooks.** Rich: onboarding + `BILLING.SUBSCRIPTION.*` +
  `PAYMENT.SALE.COMPLETED`, signed.
- **Risks.** Highest fees; deprecated onboarding API; aggressive
  funds-holds on new sellers. Best as a checkout conversion add-on.

## Recommendation

**GoCardless first** — the only one of the three with a *strategic*
rather than convenience reason: for the UK-first market it's cheaper,
stickier, and culturally expected, with a true Connect-equivalent that
maps onto the existing flow and recurring as its core competency.
Headline tradeoff: asynchronous Bacs settlement (slow first payment, late
failures) the state machine must tolerate.

**Then PayPal** as a checkout-conversion option for one-off buys — only
after confirming a non-deprecated onboarding path.

**Square last**, reframed as the POS / in-person / store play.

Priority: **GoCardless → PayPal → Square.**

## Provider-agnostic abstraction (the seams)

`billing_events` already carries `provider` and routes by connected
account — generalise that. Four seams, each a thin interface with a
per-provider impl behind the existing edge-function layout:

1. **connect/onboard** — start + callback OAuth. Generalise
   `gym_stripe_accounts` → `gym_payment_accounts(gym_id, provider,
   external_account_id, status, scopes)`. Same single-use `state` CSRF
   pattern for all three.
2. **create-subscription / checkout** — return a redirect URL or
   mandate-setup flow. Stripe → Checkout Session; GoCardless → billing
   request (mandate, ± Instant Bank Pay first charge); PayPal →
   Subscriptions approval link. Caller stays provider-blind.
3. **webhook settle** — one handler per provider verifying its signature,
   normalising into a common event `{ providerAccountId, kind:
   created|renewed|cancelled|failed, providerSubscriptionId, amount,
   currency, occurredAt }`, then writing the same idempotent
   `billing_events` and updating `plan_subscriptions`. Rename
   `stripe_subscription_id`/`stripe_customer_id` →
   `provider`/`provider_subscription_id`/`provider_customer_id`. GoCardless
   path must handle out-of-order / late-failing events.
4. **cancel** — `provider.cancel(subscription)`; GoCardless cancels the
   mandate, PayPal suspends/cancels the billing subscription.

A small `providers/{stripe,gocardless,paypal}.ts` module exporting
`{ onboardStart, onboardCallback, createCheckout, parseWebhook, cancel }`
plus the column rename is the whole abstraction. DB + webhook idempotency
are already provider-aware, so the lift is mostly the GoCardless
OAuth/mandate flow and teaching the settle path to handle async Bacs
timing.

### Rough effort (behind the abstraction)

| Provider | Effort | Driver |
|---|---|---|
| GoCardless | Medium | Partner OAuth ≈ existing Connect; new work is mandate setup UX + async/late-failure state machine. |
| PayPal | Medium–High | Subscriptions is its own paradigm; deprecated onboarding API; different webhook verification. |
| Square | Medium–High | Per-merchant OAuth token refresh; weaker split-settlement; recurring less code-first. |
