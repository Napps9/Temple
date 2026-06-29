# PayPal — integration reference

> Implementation reference for adding PayPal alongside Stripe Connect: each
> gym onboards its own PayPal business account, funds settle to the seller,
> the platform can optionally take a fee. Recurring memberships via the
> Subscriptions API; one-offs via the Orders API. Supabase edge functions
> (Deno) + a settling webhook into Postgres.
>
> Sourcing note: developer.paypal.com HTML blocks automated fetching (403),
> so endpoint/field detail was cross-checked against PayPal's authoritative
> OpenAPI specs (github.com/paypal/paypal-rest-api-specifications). Verify
> in a browser at build time.

**Maps onto the Stripe Connect model:** Commerce Platform / Multiparty (now
branded **PayPal Complete Payments — Platforms/Marketplaces**, code `PPCP`)
≈ Connect. Partner Referrals ≈ Connect onboarding. `platform_fees` ≈
`application_fee_amount`. `PayPal-Auth-Assertion` ≈ `Stripe-Account` header.

## 1. Auth & versioning

- **Base URLs** — live `https://api-m.paypal.com`, sandbox `https://api-m.sandbox.paypal.com`.
- **Access token** — `POST /v1/oauth2/token` with HTTP Basic (`CLIENT_ID:SECRET`) + form `grant_type=client_credentials` → `access_token` (~9h). **Cache and reuse** across invocations. This is the **platform's** token; act on sellers via `PayPal-Auth-Assertion`. Scopes needed: `…/partner-referrals/readwrite`, `…/subscriptions`.
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`, `PayPal-Request-Id: <uuid>` (idempotency on creates — persist it).
- https://developer.paypal.com/api/rest/authentication/

## 2. Multi-tenant onboarding — Commerce Platform / Multiparty

**Partner Referrals v2 is current + recommended (NOT deprecated). v1 IS
deprecated — don't start on it.** You must be an approved PayPal partner.

1. **Create referral** — `POST /v2/customer/partner-referrals` with `tracking_id` (= your `gym_id`, echoed back + on webhooks), `operations` (`API_INTEGRATION` with `third_party_details.features`: `PAYMENT`, `REFUND`, `PARTNER_FEE`, `BILLING_AGREEMENT`/`RECURRING_PAYMENTS`), `products: ["PPCP"]`, `legal_consents` (`SHARE_DATA_CONSENT`), `partner_config_override.return_url`. Response → follow the `rel:"action_url"` link; redirect the gym owner there.
2. **Store per gym:** `tracking_id` (=gym_id) and **`merchant_id`** (seller's payer id — the permanent key; returned on the onboarding redirect as `merchantIdInPayPal`).
3. **Confirm ready (don't trust the redirect):** `GET /v1/customer/partners/{partner_id}/merchant-integrations/{merchant_id}` → gate on `payments_receivable: true` + `primary_email_confirmed: true` + granted scopes. Else show "finish PayPal setup".
4. **Act on behalf of seller:** add `PayPal-Auth-Assertion` to seller-scoped calls — an unsigned JWT (`{"alg":"none"}`) with payload `{ iss: <platform client_id>, payer_id: <merchant_id> }`, base64url(header)`.`base64url(payload)`.` (trailing dot). ≈ `Stripe-Account`.
5. **Platform fees:** one-off Orders → `purchase_units[].payment_instruction.platform_fees[]` (+ `payee.merchant_id` = seller); subscriptions → fee config on the **billing plan**. We take no fee → omit.
- https://developer.paypal.com/docs/multiparty/seller-onboarding/build-onboarding/ · spec: https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_partner_referrals_v2.json

## 3. Create a subscription (+ one-offs)

**Product → Plan → Subscription**, created **under the seller** (send
`PayPal-Auth-Assertion` on each create).

1. **Product** — `POST /v1/catalogs/products` `{ name, type:"SERVICE", category:"EXERCISE_AND_FITNESS" }` → `product_id` (create once, reuse).
2. **Plan** — `POST /v1/billing/plans` referencing `product_id`: `billing_cycles[]` (`frequency.interval_unit:"MONTH"`, `tenure_type:"REGULAR"`, `total_cycles:0` = forever, `pricing_scheme.fixed_price`), `payment_preferences` (`payment_failure_threshold`). New plan is `CREATED` → **`POST /v1/billing/plans/{id}/activate`** before use.
3. **Subscription** — `POST /v1/billing/subscriptions` `{ plan_id, custom_id: "<gym_id>:<member_id>" (returns on every webhook), subscriber, application_context: { return_url, cancel_url, user_action:"SUBSCRIBE_NOW" } }` → `id` (`I-…`) in `APPROVAL_PENDING` + a `rel:"approve"` link → redirect member. **Activation is async — confirm via webhook**, not the redirect.

One-offs: Orders API — `POST /v2/checkout/orders` (intent `CAPTURE`,
`purchase_units[].payee.merchant_id`, optional `platform_fees`) then
`POST /v2/checkout/orders/{id}/capture`.
- https://developer.paypal.com/docs/api/subscriptions/v1/ · spec: https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json

## 4. Webhooks

- **Create:** `POST /v1/notifications/webhooks` `{ url, event_types:[…] }` → store the returned **`webhook_id`** (needed for verification). Configure **one platform-level webhook** (merchant + seller-subscription events arrive there).
- **Events:** `MERCHANT.ONBOARDING.COMPLETED` (gym ready), `MERCHANT.PARTNER-CONSENT.REVOKED` (disable gym), `BILLING.SUBSCRIPTION.ACTIVATED/CANCELLED/SUSPENDED/PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED` (each recurring sub payment → "paid"; one-offs use `PAYMENT.CAPTURE.COMPLETED`).
- **Verify (start with the API method):** `POST /v1/notifications/verify-webhook-signature` with the 5 transmission headers (`PAYPAL-TRANSMISSION-ID/TIME/SIG`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`) + stored `webhook_id` + the **raw** event → `{ verification_status:"SUCCESS" }`. **Inject the raw body string** for `webhook_event` (don't re-serialize — key-order/whitespace changes break it). In Deno read `await req.text()`. The verify API does **not** validate the webhook *simulator's* mock events. Local-crypto verification (cert from `PAYPAL-CERT-URL`, message `transmission_id|time|webhook_id|crc32(body)`, RSA-SHA256) is faster at scale.
- https://developer.paypal.com/api/rest/webhooks/event-names/

## 5. Cancel / modify

Under the seller (`PayPal-Auth-Assertion`); cancel/activate return `204`.
- **Cancel** — `POST /v1/billing/subscriptions/{id}/cancel` `{ reason }` (terminal → `…CANCELLED`).
- **Suspend** — `POST …/{id}/suspend` (→ `…SUSPENDED`); **Activate** — `POST …/{id}/activate` (from SUSPENDED).
- **Revise plan/quantity** — `POST …/{id}/revise` (may return an `approve` link if re-approval needed).
- **Capture a failed payment now** — `POST …/{id}/capture`.

## 6. Testing (sandbox)

- `https://api-m.sandbox.paypal.com`; sandbox app creds. Create sandbox
  **Business** accounts (seller + platform/partner) and a **Personal**
  account (buyer). Run Partner Referrals in sandbox; confirm
  `MERCHANT.ONBOARDING.COMPLETED` + `payments_receivable`. Approve subs as
  the buyer; manage at sandbox.paypal.com/billing/subscriptions.
- Webhooks Simulator fires sample events (but verify-signature won't
  validate them — skip/warn in test mode).
- https://developer.paypal.com/docs/subscriptions/test-subscriptions/

## Mapping to our 4 seams

| Seam | PayPal | Store |
|---|---|---|
| Onboard | `POST /v2/customer/partner-referrals` (follow `action_url`); confirm via `merchant-integrations` + `MERCHANT.ONBOARDING.COMPLETED` | `merchant_id`, `tracking_id`=gym, `payments_receivable` |
| Create subscription | Product → Plan(+activate) → Subscription under seller (`PayPal-Auth-Assertion`); redirect to `rel:"approve"` | product_id, plan_id, `I-…`, `custom_id` |
| Webhook settle | Verify via `/v1/notifications/verify-webhook-signature` (raw body); handle `BILLING.SUBSCRIPTION.*`, `PAYMENT.SALE.COMPLETED`, `MERCHANT.PARTNER-CONSENT.REVOKED` | `webhook_id`, status, paid periods |
| Cancel | `POST /v1/billing/subscriptions/{id}/cancel` (+suspend/activate/revise) | status (reconcile vs `…CANCELLED`) |

## ⚠️ Deprecation risk

- **Partner Referrals v2 is current/recommended; v1 is deprecated** — build on v2.
- Branding moved to **PPCP — Platforms & Marketplaces**, but the endpoints (`/v2/customer/partner-referrals`, `merchant-integrations`, `platform_fees`, `PayPal-Auth-Assertion`) are unchanged.
- PayPal periodically revises webhook signature verification — keep the verifier resilient; prefer the API verify method until the crypto path is hardened.
- Track drift via the OpenAPI specs repo: https://github.com/paypal/paypal-rest-api-specifications
