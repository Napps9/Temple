# AI front desk — setup and per-gym rollout

The AI front desk answers and sells memberships to inbound leads over SMS
and phone calls. Feature overview: `docs/feature-inventory.md` ("AI front
desk"). This is the operator runbook: platform secrets once, then a
checklist per gym.

## Architecture at a glance

- One Twilio phone number per gym, mapped by
  `gym_agent_settings.phone_number` (unique). Numbers are provisioned by
  the platform operator with the service key — owners cannot self-assign.
- SMS: Twilio Messaging webhook → `lead-agent-sms` edge function → Claude
  tool loop → reply via Twilio REST. The webhook answers empty TwiML
  within Twilio's 15s deadline; the model runs in
  `EdgeRuntime.waitUntil`.
- Voice: a Vapi assistant is attached to the same number. Vapi's model
  drives the call and hits `lead-agent-voice/tool-calls` for data and
  actions; the end-of-call report lands the transcript in the same
  conversation store. Gyms without voice point Twilio's voice webhook at
  `lead-agent-voice/missed-call` instead (say-and-text fallback).
- All conversation state is in `agent_conversations` / `agent_messages`;
  staff read and take over from Manage → Leads → Conversations.

## Platform secrets (once)

```bash
supabase secrets set \
  TWILIO_ACCOUNT_SID=ACxxxxxxxx \
  TWILIO_AUTH_TOKEN=xxxxxxxx \
  VAPI_WEBHOOK_SECRET=$(openssl rand -hex 24) \
  VAPI_API_KEY=xxxxxxxx \
  PURGE_STORAGE_SECRET=$(openssl rand -hex 24) \
  ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

`PURGE_STORAGE_SECRET` pairs with a Vault secret (same value) so the
nightly retention sweeps can ask `purge-agent-storage` to delete recording
files through the Storage API — direct SQL deletes from storage.objects
are blocked by `storage.protect_delete`. In the SQL editor once:

```sql
select vault.create_secret('<the PURGE_STORAGE_SECRET value>', 'agent_storage_purge_secret');
```

Optional extras:

- `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` — voice previews in the
  picker. `voice-sample` synthesises each voice's sample clip once and
  caches it in the public `agent-voice-samples` bucket; without the key
  the play buttons degrade to a muted icon.
- `VAPI_INTERVIEW_NUMBER_ID` — interview mode ("Teach it by talking").
  One outbound-capable Vapi phone number, platform-wide: buy/import a
  number in Vapi, copy its phone number id. `agent-interview/start`
  rings the owner from it with a transient interviewer assistant;
  without it the card reports phone teaching isn't switched on.

`VAPI_API_KEY` (the private key from the Vapi dashboard) lets
`sync-vapi-assistant` push each gym's prompt, tools, voice and greeting to
its assistant. Without it, voice assistants must be maintained by hand and
coaching/voice changes made in the app never reach phone calls.

Optional:

- `LEAD_AGENT_MODEL` — defaults to `claude-sonnet-5`. The SMS loop is a
  multi-turn sales conversation, which is why it doesn't reuse
  infer-import's Haiku.
- `APP_ORIGIN` — join-link origin, defaults to
  `https://app.jointemple.io`.
- `LEAD_AGENT_SMS_URL` / `LEAD_AGENT_VOICE_URL` — override the URL used
  for Twilio signature validation if a proxy ever rewrites `req.url`
  (signatures are computed over the exact public URL).

Without `ANTHROPIC_API_KEY` the SMS agent still works end-to-end in a
degraded mode: it stores the inbound message, replies "a coach will text
you back shortly", and hands the thread off — same pluggable-delivery
philosophy as `send-lead-notifications`.

## Per-gym rollout checklist

1. **Buy the number** in the Twilio console (a UK mobile/long code for UK
   gyms — alphanumeric senders can't receive). Note: UK numbers need
   regulatory-bundle approval, and US numbers need A2P 10DLC registration
   before production SMS volume.
2. **Point the webhooks** on the number:
   - Messaging → `https://<project-ref>.supabase.co/functions/v1/lead-agent-sms`
     (HTTP POST)
   - Voice → `https://<project-ref>.supabase.co/functions/v1/lead-agent-voice/missed-call`
     (HTTP POST) — or hand the number to Vapi in step 5.
3. **Enable Advanced Opt-Out** on the Twilio Messaging Service so
   STOP/START compliance replies are carrier-handled. Our side
   independently closes the thread and withdraws consent on STOP.
4. **Provision the row** (service role — SQL editor or psql):

   ```sql
   insert into gym_agent_settings (gym_id, phone_number)
   values ('<gym-uuid>', '+447xxxxxxxxx')
   on conflict (gym_id) do update set phone_number = excluded.phone_number;
   ```

5. **Voice (optional).** In Vapi: create a bare assistant for the gym —
   any starter model/voice, no tools, no prompt — with
   - server URL `https://<project-ref>.supabase.co/functions/v1/lead-agent-voice/end-of-call`
     and the `x-vapi-secret` header set to `VAPI_WEBHOOK_SECRET`
     (subscribed to `end-of-call-report`);
   - `artifactPlan.recordingEnabled` on;
   - the gym's Twilio number imported into Vapi for inbound.

   Then record the assistant id:

   ```sql
   update gym_agent_settings
     set vapi_assistant_id = '<vapi-assistant-id>'
     where gym_id = '<gym-uuid>';
   ```

   Everything else — system prompt (owner notes + coaching + live
   plans/schedule), all six tools (including the close tools
   `start_onboarding` and `enroll_member`) pointing at
   `.../lead-agent-voice/tool-calls`, the owner's voice pick, and the
   greeting with AI disclosure + recording notice — is pushed by the
   `sync-vapi-assistant` edge function whenever the owner saves any agent
   setting or coaching correction in the app. Do not hand-edit prompt,
   tools or voice on the assistant afterwards; the next sync overwrites
   them. After setting the assistant id, have the owner re-save any agent
   card (or run the setup wizard) to trigger the first sync.

6. **Owner flips the switch** at Manage → Leads → Automation: enable the
   front desk, write the "what the agent knows" notes (address, parking,
   intro offer — the schema has no gym address field, so anything
   location-ish must go here), optionally enable voice.

## Smoke test

1. Text "hi, how much is membership?" to the number from a personal
   phone. Expect a reply quoting real plan prices within ~15s, a new
   thread under Manage → Leads → Conversations, and — after you give a
   name — a lead in Manage → Leads sourced "AI front desk" and assigned
   to a coach.
2. Reply STOP. Expect the thread to show "Opted out" and
   `marketing_consent = false` on the lead.
3. Bad-signature check:

   ```bash
   curl -si -X POST \
     https://<project-ref>.supabase.co/functions/v1/lead-agent-sms \
     -d 'MessageSid=SMtest&From=%2B447700900000&To=%2B447700900001&Body=hi'
   # expect HTTP 403 (no X-Twilio-Signature)
   ```

4. If voice is on: call the number, ask for prices, say your name, ask to
   join. Expect the join link by text mid-call and the transcript in the
   conversation thread afterwards. If voice is off: call and expect the
   "we're texting you" answer plus the opening SMS.

## Costs (rough, per gym per month)

A UK mobile number is ~£1–2; SMS ~4p per segment each way; Claude on an
average 10-message conversation is low single-digit pence; Vapi voice is
~$0.05–0.15/min plus Twilio call rates. A gym doing 100 conversations a
month runs to a few tens of pounds — priced into the plan, not metered,
for now.

## Call review, coaching & voice (0137)

- **Recording capture.** On the Vapi assistant, keep `artifactPlan.recordingEnabled`
  on and subscribe to `end-of-call-report`. `lead-agent-voice/end-of-call` pulls
  `artifact.recording` into the private `agent-call-recordings` Storage bucket
  and inserts `call_recordings`; per-turn `artifact.messages[].secondsFromStart`
  land on `agent_messages` for transcript sync. Owners toggle recording + set a
  retention window (floor 30 days) in Manage → Leads → Automation → *Call
  recording & consent*; `purge_expired_agent_recordings` (cron `0 4 * * *`) drops
  both the row and the Storage object. Playback is web-first (owners review on
  desktop) and every open writes `agent_recording_access_log`.
- **Coaching loop.** In a conversation, *Coach this turn* on any AI message writes
  `agent_coaching_corrections` (per-gym, gated `can_review_ai_calls`). The SMS
  agent injects this gym's active rules/examples into its prompt on every future
  call via `fetchCoachingText`; each save also triggers `sync-vapi-assistant`,
  which rebuilds the phone assistant's system prompt with the same coaching text —
  the corrections table is the single source of truth for both channels.
- **Voice selection.** Owners pick a regional Azure voice in settings
  (`set_gym_agent_voice_selection` stores `{provider, voiceId, region}` on
  `gym_agent_settings`); the save syncs `voice: { provider, voiceId }` to the
  assistant. Add ElevenLabs voice IDs to the in-app `AGENT_VOICES` list
  (`src/lib/agent-voices.ts`) for Scottish/Welsh/Estuary accents Azure doesn't
  cover.
- **Vapi-side copies.** Temple's recording toggle and retention window govern
  only Temple's copy in `agent-call-recordings`. Vapi retains its own recording
  and transcript under its defaults — turn off Vapi-side storage in the Vapi org
  settings if the gym's policy requires a single copy.
- **Capability.** All QC surfaces + recording RLS + the corrections write are gated
  on `can_review_ai_calls` (owner/admin by default; adjustable per gym through the
  capability-override matrix).
