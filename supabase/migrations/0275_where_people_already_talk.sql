-- Where people already talk
--
-- The front desk answers on text and on the phone. Plenty of people will
-- not do either with a business they have not joined yet, and will happily
-- message one on WhatsApp — which is what James asked for.
--
-- THE GROUNDWORK WAS ALREADY RIGHT, WHICH IS WHY THIS IS SMALL. The agent
-- brain (_shared/lead-agent.ts) takes a channel and does not otherwise
-- care; agent_conversations has been keyed (gym_id, phone, channel) since
-- 0136; and WhatsApp rides Twilio's same Messages resource, on the same
-- account, through the same webhook shape. What was missing was one value
-- in a CHECK constraint.
--
-- THE PREFIX STAYS AT THE WIRE EDGE. Twilio addresses WhatsApp as
-- "whatsapp:+447700900123". Storing that in phone would be the quiet kind
-- of mistake: agent_stop_conversation matches on phone, leads.phone is
-- E.164, agent_capture_lead dedupes on it, and every one of those would
-- silently stop matching for exactly the people who reached out on the
-- newest channel. So the prefix is added and removed at the boundary and
-- the column holds what it has always held.
--
-- INBOUND ONLY. Meta's 24-hour window means anything the agent starts
-- needs a pre-approved template, and template approval is per gym on top
-- of business verification. Answering someone who messaged first needs
-- none of that, and is the whole of what was asked for.

begin;

alter table public.agent_conversations
  drop constraint agent_conversations_channel_check;

alter table public.agent_conversations
  add constraint agent_conversations_channel_check
  check (channel in ('sms', 'voice', 'whatsapp'));

comment on column public.agent_conversations.channel is
  'How this conversation reached the gym. phone is always E.164 — the '
  '"whatsapp:" address prefix Twilio uses is added and stripped at the '
  'webhook, never stored, so lead matching keeps working across channels.';

commit;
