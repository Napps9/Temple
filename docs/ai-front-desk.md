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
  ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

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

5. **Voice (optional).** In Vapi: create an assistant for the gym with
   - server URL `https://<project-ref>.supabase.co/functions/v1/lead-agent-voice/tool-calls`
     and the `x-vapi-secret` header set to `VAPI_WEBHOOK_SECRET`;
   - end-of-call report webhook to `.../lead-agent-voice/end-of-call`
     (same header);
   - tools `get_gym_info`, `capture_lead {name, email?, notes?}`,
     `send_join_link`, `request_handoff {reason}` (async: false), matching
     the definitions in `supabase/functions/_shared/lead-agent.ts`;
   - a system prompt mirroring `buildSystemPrompt`'s rules (answer only
     from `get_gym_info`, capture the lead once named, never take payment,
     hand off when unsure);
   - import the gym's Twilio number into Vapi for inbound.

   Then record the assistant id and let the owner switch voice on:

   ```sql
   update gym_agent_settings
     set vapi_assistant_id = '<vapi-assistant-id>'
     where gym_id = '<gym-uuid>';
   ```

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
