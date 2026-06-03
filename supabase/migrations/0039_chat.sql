-- Phase 1 / Track D: in-app chat (§4.4).
--
-- One thread per (gym_id, member). Staff at the gym share access
-- to every thread — there's no "specific coach assigned" model in
-- sprint 4; the team handles incoming. Realtime delivery via
-- Supabase Realtime is a sprint 5 refinement; for now the client
-- polls on focus and after send.

create table public.chat_threads (
  thread_id            uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  last_message_at      timestamptz,
  last_member_read_at  timestamptz,
  last_staff_read_at   timestamptz,
  created_at           timestamptz not null default now(),
  unique (gym_id, profile_id),
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index chat_threads_gym_last_idx
  on public.chat_threads(gym_id, last_message_at desc nulls last);

alter table public.chat_threads enable row level security;

create policy chat_threads_self_select on public.chat_threads
  for select using (profile_id = auth.uid());

create policy chat_threads_self_insert on public.chat_threads
  for insert with check (profile_id = auth.uid());

create policy chat_threads_self_update on public.chat_threads
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy chat_threads_staff_all on public.chat_threads
  for all using (public.user_can_assign_plan(gym_id))
  with check (public.user_can_assign_plan(gym_id));

-- ============================================================================
-- chat_messages
-- ============================================================================

create table public.chat_messages (
  message_id        uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.chat_threads(thread_id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id),
  body              text not null check (length(body) > 0 and length(body) <= 4000),
  created_at        timestamptz not null default now()
);

create index chat_messages_thread_idx
  on public.chat_messages(thread_id, created_at desc);

alter table public.chat_messages enable row level security;

create policy chat_messages_self_select on public.chat_messages
  for select using (
    exists (
      select 1 from public.chat_threads t
      where t.thread_id = chat_messages.thread_id
        and t.profile_id = auth.uid()
    )
  );

create policy chat_messages_self_insert on public.chat_messages
  for insert with check (
    sender_profile_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.thread_id = chat_messages.thread_id
        and t.profile_id = auth.uid()
    )
  );

create policy chat_messages_staff_select on public.chat_messages
  for select using (
    exists (
      select 1 from public.chat_threads t
      where t.thread_id = chat_messages.thread_id
        and public.user_can_assign_plan(t.gym_id)
    )
  );

create policy chat_messages_staff_insert on public.chat_messages
  for insert with check (
    sender_profile_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.thread_id = chat_messages.thread_id
        and public.user_can_assign_plan(t.gym_id)
    )
  );

-- ============================================================================
-- Trigger: keep thread.last_message_at in sync.
-- ============================================================================

create or replace function public.fn_chat_thread_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_threads
  set last_message_at = new.created_at
  where thread_id = new.thread_id;
  return new;
end;
$$;

create trigger chat_messages_touch_thread_trg
  after insert on public.chat_messages
  for each row execute function public.fn_chat_thread_last_message();
