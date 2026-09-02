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

1. **No per-gym billing gate.** Temple charges a flat monthly fee per
   gym via manual invoice, not per-feature — every gym on the platform
   is already a paying customer, so provisioning needs no separate
   allowlist. `gym_agent_settings.front_desk_entitled` (0152) defaults
   to `true` (0163); it stays as a manual, service-role-only
   off-switch for a specific gym (non-payment, abuse) rather than an
   opt-in gate every gym has to be granted.
2. **Temple owns the numbers.** Temple's Twilio account holds the UK
   regulatory bundle; every gym's number is bought under it and used on
   the gym's behalf (standard SaaS). Not per-gym Twilio KYC.
3. **Mobile when we can, local when we can't.** A UK **local** number is
   voice-only; a UK **mobile** carries voice and SMS. A Twilio regulatory
   bundle is approved against one regulation (country + number type +
   end-user type), so a bundle approved for local numbers cannot buy a
   mobile — Twilio refuses the purchase with a 400 (error 21649). Which
   types Temple can buy is therefore whatever bundles it holds:
   provisioning reads each configured bundle's regulation from the
   Numbers API, asks for a mobile if a mobile bundle is approved, and
   otherwise (or if Twilio still refuses) buys a local voice-only
   number. `sms_capable` records what was actually bought (0270).

## Data model (0152)

Added to `gym_agent_settings` (service-role writes only, as with
`phone_number` / `vapi_assistant_id` since 0136):

| column | why |
| --- | --- |
| `front_desk_entitled boolean` | defaults true (0163); an explicit `false` is a manual off-switch, provisioning refuses only then |
| `provision_status text` | `none / provisioning / live / failed / released` — drives the wizard's live state |
| `twilio_number_sid text` | Twilio's handle for the number, to release it on churn |
| `vapi_phone_number_id text` | Vapi's handle for the number, to delete it on churn |
| `provisioned_at timestamptz` | when it went live |

`set_gym_front_desk_entitled(gym, bool)` — security-definer, **service
role only**. An owner cannot flip their own entitlement — it's an
operator escape hatch (e.g. non-payment, abuse), not something a gym
ever needs to request.

## `provision-front-desk` (owner-triggered)

1. Re-check the caller is owner/admin (`effective_can can_review_ai_calls`).
2. Guard: entitled? not already live? env configured? Idempotent — a
   gym already `live` returns its number.
3. `provision_status = 'provisioning'`.
4. **Twilio**: resolve which number types the configured bundles cover
   (`GET /v2/RegulatoryCompliance/Bundles/{sid}` → status +
   `regulation_sid`; `GET .../Regulations/{sid}` → `number_type`), skipping
   any bundle that isn't `twilio-approved` / `provisionally-approved`
   (none usable → reason `bundle_not_approved`). Then, mobile first and
   local second, find an available GB number of that type and buy it with
   the matching `BundleSid` + emergency `AddressSid`; a refused purchase
   moves on to the next type rather than failing. Store
   `twilio_number_sid` and `phone_number` together immediately so a later
   failure is recoverable and a retry never buys a second number.
5. **Vapi**: create the gym's assistant (`POST /assistant`); import the
   Twilio number bound to it (`POST /phone-number` with `provider:
   'twilio'` + Twilio creds, `smsEnabled: false` so Vapi leaves our SMS
   webhook alone) so Vapi owns inbound voice; store `vapi_assistant_id` +
   `vapi_phone_number_id`. Vapi's resource paths are singular — the old
   `/phone-numbers/import` answers 404.
6. Populate the assistant by calling the existing `sync-vapi-assistant`
   (prompt + tools + voice) with the owner's auth.
7. Persist `provision_status = 'live'`, `voice_enabled`, `enabled`;
   return the number.

Each of steps 4-5 is skipped and its stored provider id reused if the row
already has it — retrying a `failed` run resumes from the first
incomplete step rather than re-buying a number or re-creating an
assistant. On any step's failure: `provision_status = 'failed'`, keep
whatever provider IDs were captured, return a typed reason plus the
provider's own message as `detail` — the wizard shows it, because the
function log is the only other place it lands and the owner can't read
that. Deprovision can then clean up the partial state, or the owner can
just retry.

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
  This one was approved for **local** numbers, so on its own it buys
  voice-only numbers.
- A second bundle approved for **mobile** numbers (same business docs,
  submitted against the GB / mobile / business regulation). Its SID →
  `TWILIO_UK_MOBILE_BUNDLE_SID`. Optional: without it, provisioning
  simply never asks for a mobile. With it, every new gym gets a number
  that can text.
- An **emergency address** on the account. Its SID →
  `TWILIO_UK_ADDRESS_SID`.

Nothing can buy a UK number until a bundle is approved, so that approval
gates the first real end-to-end test. Provisioning doesn't trust the env
to say which type a bundle covers — it asks Twilio — so a bundle set in
the "wrong" variable still buys the type it was approved for.

## Not in phase 1

- **SMS** for gyms provisioned without a mobile bundle — their number is
  voice-only and `sms_capable` says so; texts stay dark for them until
  they take a number that can text.
- **Platform billing** that flips the entitlement flag automatically.
- Recovery UI for a `provisioning` status stuck mid-run (e.g. the owner
  closed the tab mid-request) — today the same "Set up my number" /
  "Try again" button re-invokes the function, which is safe and resumes,
  but the UI doesn't yet distinguish "stuck" from "not started".
