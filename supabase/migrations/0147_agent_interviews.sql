-- Interview mode: the owner teaches the AI front desk by talking to it.
--
-- The agent-interview edge function rings the owner and an interviewer
-- assistant asks how to talk about their gym (intro offer, beginner path,
-- the questions prospects ask, what never to say). The end-of-call
-- transcript is distilled by Claude into a DRAFT brief — never applied
-- automatically: the owner reviews it in the app and applies or discards.
-- A silent rewrite of the live agent from a phone call would be a trust
-- and injection hazard; the draft step is the design, not a nicety.
--
-- Rows are written by the edge function (service role). Owners read their
-- own gym's interviews; the only client write is the applied/discarded
-- verdict via set_agent_interview_status.

begin;

create table public.agent_interviews (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  phone       text not null,
  status      text not null default 'calling'
                check (status in ('calling', 'completed', 'failed', 'applied', 'discarded')),
  transcript  text,
  draft_brief text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index agent_interviews_gym_idx on public.agent_interviews(gym_id, created_at desc);

alter table public.agent_interviews enable row level security;
create policy agent_interviews_owner_select on public.agent_interviews
  for select using (public.user_is_owner_of(gym_id));

create function public.set_agent_interview_status(
  p_id     uuid,
  p_status text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.agent_interviews where id = p_id;
  if v_gym is null or not public.user_is_owner_of(v_gym) then
    raise exception 'Only the gym owner can review an interview';
  end if;
  if p_status not in ('applied', 'discarded') then
    raise exception 'An interview can only be marked applied or discarded';
  end if;
  update public.agent_interviews
    set status = p_status, updated_at = now()
    where id = p_id;
end;
$$;
grant execute on function public.set_agent_interview_status(uuid, text) to authenticated;

commit;
