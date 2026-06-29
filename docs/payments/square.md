# Square — integration reference

> Implementation reference for adding Square as a payment provider beside
> our Stripe Connect setup: each gym connects its own Square merchant
> account, funds settle to the gym, the platform takes no fee. Recurring
> monthly memberships + in-person/POS + store one-offs. Supabase edge
> functions (Deno) + a settling webhook into Postgres.
>
> Sourced from current Square docs (developer.squareup.com). NOTE: direct
> fetches of developer.squareup.com return 403 (WAF), so before coding,
> byte-verify (a) the exact current `Square-Version` value to pin and
> (b) the sandbox SCA test-card table on the cited pages.

## 1. Auth & versioning

- **Base URLs** — production `https://connect.squareup.com`, sandbox
  `https://connect.squareupsandbox.com`. OAuth authorize/token/revoke are
  on the same hosts under `/oauth2/authorize`, `/oauth2/token`,
  `/oauth2/revoke`.
- **`Square-Version` header** — pin it on every request (monthly dated
  versions, e.g. `2025-04-16`). Square echoes it on every response. Don't
  rely on the Console default.
- **Auth** — `Authorization: Bearer <ACCESS_TOKEN>` = the per-merchant
  OAuth token (not a platform key).
- **Idempotency** — write endpoints take an `idempotency_key` (UUID) in
  the body; persist it so retries are safe.
- **Rate limits** — `429` + `Retry-After` → retry with backoff; `401/403`
  → token problem (refresh / re-onboard), not retryable.
- Versioning: https://developer.squareup.com/docs/build-basics/versioning-overview
- REST conventions: https://developer.squareup.com/docs/build-basics/general-considerations/using-rest-api

## 2. Multi-tenant onboarding (per-merchant OAuth — like Connect Standard)

One app in the Developer Console; each gym authorizes and you get an
access + refresh token **for that seller**; call all APIs with their token.

1. **Authorize redirect** → `https://connect.squareup.com/oauth2/authorize?client_id=...&scope=PAYMENTS_WRITE+PAYMENTS_READ+SUBSCRIPTIONS_WRITE+SUBSCRIPTIONS_READ+CUSTOMERS_WRITE+CUSTOMERS_READ+ITEMS_WRITE+ITEMS_READ+ORDERS_WRITE+ORDERS_READ+INVOICES_WRITE+INVOICES_READ+MERCHANT_PROFILE_READ&session=false&state=<CSRF>` (scopes space-separated, `+`-encoded). Verify `state`.
2. **Code → token** — `POST /oauth2/token` `{client_id, client_secret, grant_type:"authorization_code", code, redirect_uri}` → `access_token, refresh_token, expires_at, merchant_id`. Store per gym (encrypted, RLS-locked: a `square_connections` table), plus the gym's `location_id` (ListLocations) — subs + payments are location-scoped.
3. **Token lifetime** — **access tokens expire after 30 days.** Use the **code flow** (refresh tokens long-lived, reusable). Run a scheduled refresh ≥7 days before `expires_at` via `grant_type=refresh_token`. On 401 mid-request, refresh once + retry.
4. **On-behalf-of** — every call uses the gym's token; funds settle to the gym automatically.

**Split settlement / app fee — precise:** `CreatePayment` accepts
`app_fee_money` for **one-off** charges only (3-way split, caps apply).
**Subscriptions API billing has NO app-fee path.** We take no fee → omit
`app_fee_money` everywhere; every penny settles to the gym.
- OAuth: https://developer.squareup.com/docs/oauth-api/overview · https://developer.squareup.com/reference/square/o-auth-api/obtain-token · https://developer.squareup.com/docs/oauth-api/refresh-revoke-limit-scope
- Permissions: https://developer.squareup.com/docs/oauth-api/square-permissions
- App fees: https://developer.squareup.com/docs/payments-api/take-payments-and-collect-fees

## 3. Create a subscription

Three APIs: **Catalog** (plan), **Customers** (payer + card on file),
**Subscriptions** (enrol).

Object model: `SUBSCRIPTION_PLAN` → `SUBSCRIPTION_PLAN_VARIATION` (cadence
`MONTHLY` + `SubscriptionPhase`s; `STATIC` price for a flat membership;
omit `periods` on the final phase to recur forever) → a `Subscription`
references one variation + one customer at one location.

1. `POST /v2/catalog/object` — `SUBSCRIPTION_PLAN`.
2. `POST /v2/catalog/object` — `SUBSCRIPTION_PLAN_VARIATION` (monthly, one `STATIC` phase, no `periods`).
3. `POST /v2/customers` → `customer_id`; capture a card (Web/In-App Payments SDK nonce) → `POST /v2/cards` (`source_id=<nonce>`, `customer_id`) → **`card_id`**.
4. `POST /v2/subscriptions` `{idempotency_key, location_id, plan_variation_id, customer_id, card_id, start_date}`.

**Card on file is mandatory for auto-charge** — with `card_id` Square
charges each cycle; without it Square emails an invoice to pay manually.
Billing runs through **Orders + Invoices**, so settle on `invoice.*` /
`payment.*` (§4). One-offs/POS/store: `POST /v2/payments` (no app fee);
refunds `POST /v2/refunds`.
- Plans/variations: https://developer.squareup.com/docs/subscriptions-api/plans-and-variations
- Create sub: https://developer.squareup.com/reference/square/subscriptions-api/create-subscription
- Billing: https://developer.squareup.com/docs/subscriptions-api/subscription-billing

## 4. Webhooks

Subscribe (Console or Webhook Subscriptions API) → your edge-fn URL; each
subscription has a **signature key** + **notification URL** (separate per
env).

Events for our seams: `payment.created`/`updated`,
`invoice.payment_made` (membership paid), `invoice.scheduled_charge_failed`
(dunning/suspend), `subscription.created`/`updated` (lifecycle),
`refund.created`/`updated`, `oauth.authorization.revoked` (gym
disconnected → mark connection dead, prompt reconnect).

**Verify** the `x-square-hmacsha256-signature` header = Base64
HMAC-SHA-256 of `notificationUrl + rawRequestBody` keyed by the signature
key. In Deno: read the **raw** body (don't re-serialize), compute via Web
Crypto, constant-time compare. Notification URL must match
character-for-character.

Payload: top-level `merchant_id` (→ gym), `type`, `event_id` (dedupe in
Postgres), `data.object`. Settle: verify → dedupe on `event_id` → switch
on `type` → upsert mirror → fast 2xx (Square retries non-2xx).
- Subscribe/validate/events: https://developer.squareup.com/docs/webhooks/step2subscribe · https://developer.squareup.com/docs/webhooks/step3validate · https://developer.squareup.com/docs/webhooks/v2webhook-events-tech-ref

## 5. Cancel / modify

Subscriptions API (gym's token); actions are **scheduled** (often
end-of-cycle) — reconcile true state from `subscription.updated`.
- `POST /v2/subscriptions/{id}/cancel` — runs to cycle end then `CANCELED`.
- `POST /v2/subscriptions/{id}/pause` · `/resume`.
- `POST /v2/subscriptions/{id}/swap-plan` (`plan_variation_id`) — tier up/down at cycle end.
- `DELETE /v2/subscriptions/{id}/actions/{action_id}` — undo a pending action.
- https://developer.squareup.com/docs/subscriptions-api/pause-resume-cancel-subscriptions · https://developer.squareup.com/docs/subscriptions-api/swap-plan-variations

## 6. Testing

- Sandbox host `https://connect.squareupsandbox.com`; sandbox app creds +
  test seller. Test card `4111 1111 1111 1111`; server-side nonces like
  `cnon:card-nonce-ok`; dedicated SCA/3DS test cards.
- Build plans/variations/customers/cards/subscriptions/invoices in sandbox;
  subscribe to sandbox webhooks (separate signature key) to exercise the
  settle fn. Square publishes a gym-membership cURL walkthrough — use it as
  the smoke test.
- https://developer.squareup.com/docs/devtools/sandbox/overview · https://developer.squareup.com/docs/testing/test-values

## Mapping to our 4 seams

| Seam | Square |
|---|---|
| Onboard | OAuth code flow → store per-gym access+refresh+expires+merchant+location; scheduled refresh before 30-day expiry. |
| Create subscription | UpsertCatalogObject plan→variation → CreateCustomer → CreateCard → `POST /v2/subscriptions` (`card_id` required). One-offs: `POST /v2/payments`. |
| Webhook settle | Verify Base64 HMAC of `notificationUrl+rawBody` → dedupe on `event_id` → switch `payment.*`/`invoice.*`/`subscription.*`/`refund.*`/`oauth.authorization.revoked` → upsert → 2xx. |
| Cancel | `POST /v2/subscriptions/{id}/cancel` (+pause/resume/swap-plan, DeleteSubscriptionAction). |

## Biggest limitation vs Stripe Connect (online recurring)

1. **No application fee on subscriptions** (only one-off `CreatePayment`). Moot for us (no fee) but a hard ceiling if that changes.
2. **Catalog-coupled, order/invoice-driven** — more assembly (plan+variation+customer+card-on-file) and invoice-centric webhooks vs Stripe's flatter Price/Subscription model.
3. **30-day token expiry** → a per-gym refresh job is mandatory; a missed refresh silently breaks that gym's billing. Build refresh + `oauth.authorization.revoked` handling as first-class.
