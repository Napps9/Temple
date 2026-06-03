-- Phase 1 / Track D sprint 5: enable Realtime delivery on chat_messages.
--
-- Adds the chat_messages table to Supabase's default realtime
-- publication. RLS on the table continues to gate who actually
-- receives a given change event — staff at the gym + the member
-- on the thread; nobody else.
--
-- announcement reads also benefit from realtime so the in-app
-- badge clears when staff publishes from another tab.

alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.announcements;
