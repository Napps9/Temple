# Self-serve AI front-desk provisioning

How a gym turns on the AI front desk without ever touching Vapi, Twilio,
or ElevenLabs. Temple owns every external account; a gym owner clicks one
button and a backend worker buys a number, creates the assistant, and
wires them together on Temple's credentials.

Status: **phase 1 (voice) — backend + UI built, live smoke-test pending the
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
   `twilio_number_sid` and `phone_number` together immediately so a later
   failure is recoverable and a retry never buys a second number.
5. **Vapi**: create the gym's assistant (`POST /assistant`); import the
   Twilio number bound to it (`POST /phone-numbers/import`, Twilio creds)
   so Vapi owns inbound voice; store `vapi_assistant_id` +
   `vapi_phone_number_id`.
6. Populate the assistant by calling the existing `sync-vapi-assistant`
   (prompt + tools + voice) with the owner's auth.
7. Persist `provision_status = 'live'`, `voice_enabled`, `enabled`;
   return the number.

Each of steps 4-5 is skipped and its stored provider id reused if the row
already has it — retrying a `failed` run resumes from the first
incomplete step rather than re-buying a number or re-creating an
assistant. On any step's failure: `provision_status = 'failed'`, keep
whatever provider IDs were captured, return a typed reason. Deprovision
can then clean up the partial state, or the owner can just retry.

## UI

- **Setup wizard, step 5** (`agent-setup.tsx`): branches on
  `front_desk_entitled` / `phone_number` / `provision_status` — not
  entitled (contact Temple), provisioning (a simulated 3-step checklist —
  `provision-front-desk` has no real progress signal, so this is a
  client-side timer, not a poll), failed (a "Try again" button, plus
  "your progress was saved" copy so a retry doesn't read as starting
  over — safe thanks to the resumability above), or live: "Talk to it
  now" (the in-app browser call, see `docs/ai-front-desk.md`) as the
  primary action, text-yourself testing demoted to a secondary link, and
  a "You're live" moment (brand-coloured, the number plus a copy button)
  on go-live before returning to the CRM.
- **Automation settings** (`settings.tsx`): the same entry point inline
  in the "AI front desk" card for a gym that skipped straight past the
  wizard, plus a destructive "Turn off & release number" card in a
  Danger Zone section at the bottom (only shown once a number exists)
  that confirms via `ConfirmDialog` and calls `deprovision-front-desk`.
- Both screens share `provisionFrontDesk` / `deprovisionFrontDesk` /
  `provisionErrorMessage` from `src/lib/agent-sync.ts`, alongside the
  existing best-effort `syncVapiAssistant`.
- "Talk to it now" needs `vapi_assistant_id` (set the moment
  provisioning creates the assistant, before the number is even bought)
  and `EXPO_PUBLIC_VAPI_KEY` — see `docs/ai-front-desk.md`'s browser
  voice call section.

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

- **SMS** for auto-provisioned gyms (phase 3) — the number bought here is
  voice-only per the option-A decision; texts stay dark until then.
- **Platform billing** that flips the entitlement flag automatically.
- Recovery UI for a `provisioning` status stuck mid-run (e.g. the owner
  closed the tab mid-request) — today the same "Set up my number" /
  "Try again" button re-invokes the function, which is safe and resumes,
  but the UI doesn't yet distinguish "stuck" from "not started".
