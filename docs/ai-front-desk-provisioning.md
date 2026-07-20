# Self-serve AI front-desk provisioning

How a gym turns on the AI front desk without ever touching Vapi, Twilio,
or ElevenLabs. Temple owns every external account; a gym owner clicks one
button and a backend worker buys a number, creates the assistant, and
wires them together on Temple's credentials.

Status: **phase 1 (voice) — backend built, live smoke-test pending the
Twilio UK regulatory bundle.**

---

## Principle

The platform holds one Vapi account, one ElevenLabs key, one Twilio
account. Per-gym resources (a phone number, a Vapi assistant) are
provisioned on demand under those accounts and torn down on churn. The
gym owner only ever sees Temple's UI.

## Decisions (agreed)

1. **Billing gate = operator-set entitlement flag.** Temple has no
   platform-billing model today (all Stripe code is gyms charging their
   own members via Connect). So `gym_agent_settings.front_desk_entitled`
   is flipped per gym by an operator (service role). When platform
   billing lands later, its webhook flips the same flag — no rework.
2. **Temple owns the numbers.** Temple's Twilio account holds the UK
   regulatory bundle; every gym's number is bought under it and used on
   the gym's behalf (standard SaaS). Not per-gym Twilio KYC.
3. **Voice-first (option A).** Phase 1 provisions a UK **local** number
   for voice only. SMS (which needs a mobile number or a shared
   messaging service) is a later phase; until then the SMS agent stays
   dark for auto-provisioned gyms.

## Data model (0152)

Added to `gym_agent_settings` (service-role writes only, as with
`phone_number` / `vapi_assistant_id` since 0136):

| column | why |
| --- | --- |
| `front_desk_entitled boolean` | the billing gate; provisioning refuses without it |
| `provision_status text` | `none / provisioning / live / failed / released` — drives the wizard's live state |
| `twilio_number_sid text` | Twilio's handle for the number, to release it on churn |
| `vapi_phone_number_id text` | Vapi's handle for the number, to delete it on churn |
| `provisioned_at timestamptz` | when it went live |

`set_gym_front_desk_entitled(gym, bool)` — security-definer, **service
role only**. An owner cannot grant themselves a billed number.

## `provision-front-desk` (owner-triggered)

1. Re-check the caller is owner/admin (`effective_can can_review_ai_calls`).
2. Guard: entitled? not already live? env configured? Idempotent — a
   gym already `live` returns its number.
3. `provision_status = 'provisioning'`.
4. **Twilio**: find an available GB local voice number, buy it with the
   regulatory `BundleSid` + emergency `AddressSid`; store
   `twilio_number_sid` immediately so a later failure is recoverable.
5. **Vapi**: create the gym's assistant (`POST /assistant`); import the
   Twilio number bound to it (`POST /phone-number`, Twilio creds) so
   Vapi owns inbound voice; store `vapi_assistant_id` +
   `vapi_phone_number_id`.
6. Populate the assistant by calling the existing `sync-vapi-assistant`
   (prompt + tools + voice) with the owner's auth.
7. Persist `phone_number`, `provision_status = 'live'`, `voice_enabled`,
   `enabled`; return the number.

On any step's failure: `provision_status = 'failed'`, keep whatever
provider IDs were captured, return a typed reason. Deprovision can then
clean up the partial state.

## `deprovision-front-desk` (churn / owner turn-off)

Best-effort delete of the Vapi phone-number, the Vapi assistant, and the
Twilio number, then null the columns and set `provision_status =
'released'`, `enabled = false`.

## Hosted config the worker needs

Already set: `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `ELEVENLABS_API_KEY` (voice, platform-wide).

**New, and the critical path:**
- A **UK regulatory bundle** approved on Temple's Twilio account
  (business docs — multi-day approval). Its SID → `TWILIO_UK_BUNDLE_SID`.
- An **emergency address** on the account. Its SID →
  `TWILIO_UK_ADDRESS_SID`.

Nothing can buy a UK number until the bundle is approved, so that
approval gates the first real end-to-end test.

## Not in phase 1

- The wizard **"Go live" button** (self-serve trigger) — built next, once
  we can watch a real provision run against the approved bundle.
- **SMS** for auto-provisioned gyms (phase 3).
- **Platform billing** that flips the entitlement flag automatically.
