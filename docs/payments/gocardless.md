# GoCardless — integration reference

> Implementation reference for adding GoCardless (bank Direct Debit) as a
> second payment provider beside Stripe Connect: each gym connects its own
> GoCardless organisation via partner OAuth, funds settle to the gym, the
> platform takes no fee. Supabase edge functions (Deno) + a settling
> webhook into Postgres.
>
> Sourcing note: developer.gocardless.com is blocked to automated fetchers
> (403), so concrete values below were taken from GoCardless's **official
> client-library source on GitHub** (which encodes the live API) + doc
> excerpts. Open the cited URLs in a browser to byte-verify at build time.

**Mental model — this is bank debit, not cards:**
- Money moves slowly and can reverse late: a first Bacs collection takes
  **~5–7 working days** to confirm; an indemnity **chargeback can land
  weeks** after "confirmed". Drive entitlement from events, never
  optimistically.
- The **mandate** is the durable object (≈ "card on file"). Set it up once,
  then attach **subscriptions** and **one-off payments** to it.

## 1. Auth & versioning

- **Base URLs** — live `https://api.gocardless.com`, sandbox
  `https://api-sandbox.gocardless.com`.
- **Headers (every request):** `Authorization: Bearer <access_token>`,
  `GoCardless-Version: 2015-07-06` (pin it — the SDKs still send this GA
  date), `Content-Type: application/json`, `Accept: application/json`.
- **Idempotency:** `Idempotency-Key: <uuid>` on creates; replay returns the
  original (`409 idempotent_creation_conflict` linking the existing
  resource). Short-window dedupe only.
- **Rate limit:** ~1000 req/min per merchant → `429` + `RateLimit-*`
  headers; back off.
- Docs: https://developer.gocardless.com/api-reference

## 2. Partner / multi-tenant onboarding (the Connect equivalent)

Register one **partner app** per env → `client_id` + `client_secret`. Each
gym runs OAuth authorization-code to connect their own organisation.

1. **Authorize** → `https://connect.gocardless.com/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&scope=read_write&initial_view=signup` (sandbox: `connect-sandbox.gocardless.com`). Need `read_write` to create mandates/subs/payments.
2. **Token** → `POST https://connect.gocardless.com/oauth/access_token` `{client_id, client_secret, code, grant_type:"authorization_code", redirect_uri}` → `access_token` (**long-lived, no timer expiry** — unlike Square) + `organisation_id` (`OR…`).
3. **Store per gym:** `access_token` (encrypted) + `organisation_id`.
4. **Act on behalf:** call the normal API with that gym's `access_token` as the Bearer. **No `Stripe-Account`-style header — the token IS the tenancy boundary.** `organisation_id` is the webhook routing key.

**Go-live gating:** GoCardless must **verify the creditor** (KYC + payout
bank) before live collection — the analogue of Stripe `charges_enabled`.
Track verification; don't let an unverified gym collect.
- https://developer.gocardless.com/partners/connecting-your-users/ · https://developer.gocardless.com/partners/getting-your-users-verified

## 3. Create a subscription

Object model: **Customer → Customer Bank Account → Mandate →
(Subscription | Payment)**. Use **Billing Requests** to set up the mandate
(hosted, SCA-compliant), then create a subscription against it.

1. **Billing Request** — `POST /billing_requests` `{ "billing_requests": { "mandate_request": { "scheme":"bacs", "currency":"GBP" }, "metadata": {...} } }`. Add a `payment_request` block for **Instant Bank Pay** (one-off, instant-confirm open-banking; GBP UK / EUR DE) in the same "dual flow".
2. **Billing Request Flow** — `POST /billing_request_flows` `{ "billing_request_flows": { "redirect_uri", "exit_uri", "links": { "billing_request": "BRQ…" } } }` → returns **`authorisation_url`** (valid ~15 min); redirect the member there. On completion you get a customer + bank account + mandate (`MD…`) and webhooks fire.
3. **Subscription** — `POST /subscriptions` `{ "subscriptions": { "amount": 4500 (minor units), "currency":"GBP", "interval_unit":"monthly", "interval":1, "day_of_month":1 (or -1=last), "name", "metadata" (≤3 keys), "links": { "mandate":"MD…" } } }`. GoCardless auto-creates each cycle's `payment` — you don't create them; you watch payment webhooks. Currencies: GBP, EUR, SEK, AUD, DKK, NZD.

One-off buys: `POST /payments` against an existing mandate, or Instant Bank
Pay for instant confirmation with no mandate.
- https://developer.gocardless.com/billing-requests/overview · https://developer.gocardless.com/recurring-payments/subscriptions/

## 4. Webhooks

A webhook POST carries a batch: `{ "events": [ … ] }`. Each event has `id`
(`EV…`), `resource_type`, `action`, `links`, `details`, `created_at`.

Actions to settle on:
- `mandates`: `active` (billable) · `cancelled`/`failed`/`expired`/`replaced` (dead → suspend).
- `payments`: `confirmed` (**treat this, not `created`, as "paid"**) · `paid_out` (in a gym payout) · `failed`/`cancelled` (dunning) · `charged_back`/`late_failure_settled` (**late reversal → claw back access**).
- `subscriptions`: `created` · `cancelled`/`finished`/`paused`/`resumed`.
- `payouts`: `paid` (reconcile).

**Verify:** `Webhook-Signature` header = lowercase **hex HMAC-SHA256 of the
raw body** keyed by the endpoint **webhook secret**. In Deno: read raw
bytes before parsing, HMAC-SHA256 via Web Crypto, hex-encode, constant-time
compare. **Route by `event.links.organisation` → gym.** Respond 2xx fast;
**idempotent on `event.id`** (batches/retries re-deliver).
- https://developer.gocardless.com/mandates/responding-to-mandate-events/

## 5. Cancel / modify

- **Cancel subscription** — `POST /subscriptions/{SB…}/actions/cancel` (fires `subscriptions → cancelled`).
- **Pause/resume** — `POST /subscriptions/{SB…}/actions/pause` `{ "subscriptions": { "pause_cycles": N } }` · `/actions/resume`.
- **Amend** — `PUT /subscriptions/{SB…}` (amount/name/metadata, limits apply).
- **Cancel mandate** (kills everything on it) — `POST /mandates/{MD…}/actions/cancel`.
- `422 invalid_state` if already terminal or a payment is already bank-submitted (can't pull back submitted payments).

## 6. Testing (sandbox)

- `https://api-sandbox.gocardless.com` + sandbox token; `connect-sandbox`
  for OAuth. Never use real bank details/emails.
- **Test UK Bacs bank:** account `55779911`, sort code `20-00-00`,
  `country_code: GB`.
- **Scenario Simulators** (Dashboard or API) drive the async lifecycle:
  activate mandate, confirm/pay-out payment, fail payment, cancel mandate,
  chargeback/late-failure — exercise dunning + claw-back. GC CLI can
  `trigger` events and forward webhooks to localhost.
- https://developer.gocardless.com/resources/test-bank-details · https://developer.gocardless.com/developer-tools/scenario-simulators

## Mapping to our 4 seams

| Seam | GoCardless |
|---|---|
| Onboard | Partner OAuth (`connect.gocardless.com/oauth/authorize` scope `read_write` → `/oauth/access_token`); store per-gym `access_token` + `organisation_id`; act via that token (no on-behalf header); gate on creditor verification. |
| Create subscription | `POST /billing_requests` (mandate_request) → `POST /billing_request_flows` → redirect to `authorisation_url` → `POST /subscriptions` against `links.mandate`. One-offs: Instant Bank Pay or `POST /payments`. |
| Webhook settle | Verify hex HMAC-SHA256(secret, raw body); route by `links.organisation`; settle on mandates active/cancelled/failed, payments confirmed/paid_out/failed/charged_back, subscriptions created/cancelled, payouts paid; idempotent on `event.id`. |
| Cancel | `POST /subscriptions/{id}/actions/cancel` (+pause/resume; `PUT` amend; `POST /mandates/{id}/actions/cancel`). |

**Postgres reminders:** store `organisation_id` next to each gym's
credentials (one-lookup webhook routing); drive entitlement from
`payments confirmed`/`charged_back` (long, reversible Bacs tail), never
from subscription creation.
