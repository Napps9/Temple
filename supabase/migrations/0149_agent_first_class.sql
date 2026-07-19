-- Finish the hands-free close: the class the prospect agreed to try on the
-- call is staged alongside their plan, and the app books it for them the
-- moment their membership activates after checkout.
--
-- The booking itself still goes through book_class as the signed-in member
-- (entitlement, capacity and window gates all apply) — the agent never
-- inserts a booking. Staging only records intent; my_staged_first_class
-- exposes it to the member, and clear_my_first_class retires it once the
-- booking attempt (success or not) has happened.

begin;

alter table public.pending_members
  add column if not exists first_session_id uuid
    references public.class_sessions(id) on delete set null;

-- Arity change again (see 0043): drop the 4-arg version from 0141/0144.
drop function if exists public.agent_stage_onboarding(uuid, text, text, uuid);
create function public.agent_stage_onboarding(
  p_conversation_id  uuid,
  p_full_name        text,
  p_email            text,
  p_plan_id          uuid default null,
  p_first_session_id uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym      uuid;
  v_lead     uuid;
  v_email    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_name     text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_plan     uuid;
  v_session  uuid;
  v_existing uuid;
begin
  select gym_id, lead_id into v_gym, v_lead
    from public.agent_conversations where id = p_conversation_id;
  if v_gym is null then
    raise exception 'Conversation not found';
  end if;
  if v_email is null
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email is required to send onboarding';
  end if;

  if p_plan_id is not null then
    select plan_id into v_plan
      from public.membership_plans
      where plan_id = p_plan_id and gym_id = v_gym and archived_at is null;
  end if;
  -- Only a real, future session of this gym can be staged.
  if p_first_session_id is not null then
    select id into v_session
      from public.class_sessions
      where id = p_first_session_id and gym_id = v_gym and starts_at > now();
  end if;

  select id into v_existing
    from public.pending_members
    where gym_id = v_gym and lower(email) = v_email
    limit 1;
  if v_existing is not null then
    update public.pending_members
      set full_name = coalesce(v_name, full_name),
          agreed_plan_id = coalesce(v_plan, agreed_plan_id),
          first_session_id = coalesce(v_session, first_session_id),
          linked_membership_plan_id = null,
          status = case when status = 'linked' then status else 'invited' end
      where id = v_existing;
  else
    insert into public.pending_members
      (gym_id, email, full_name, agreed_plan_id, first_session_id, status, notes)
      values (v_gym, v_email, v_name, v_plan, v_session, 'invited',
              'Staged by the AI sales agent at close');
  end if;

  if v_lead is not null then
    update public.leads
      set email = coalesce(email, v_email),
          status = case
            when status in ('cold', 'contacted', 'intro_booked', 'trial_attended')
              then 'committed'::public.lead_status
            else status
          end,
          updated_at = now()
      where id = v_lead;
  end if;
end;
$$;
revoke execute on function public.agent_stage_onboarding(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agent_stage_onboarding(uuid, text, text, uuid, uuid)
  to service_role;

-- The class staged for me, while it is still bookable and unbooked.
create function public.my_staged_first_class(p_gym_id uuid)
returns table (session_id uuid, session_name text, starts_at timestamptz)
language sql security definer set search_path = public
as $$
  select s.id, s.name, s.starts_at
  from public.pending_members pm
  join public.class_sessions s on s.id = pm.first_session_id
  where pm.gym_id = p_gym_id
    and lower(pm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and s.starts_at > now()
    and not exists (
      select 1 from public.class_bookings b
      where b.class_session_id = s.id and b.profile_id = auth.uid()
    )
  limit 1;
$$;
grant execute on function public.my_staged_first_class(uuid) to authenticated;

create function public.clear_my_first_class(p_gym_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.pending_members
    set first_session_id = null
    where gym_id = p_gym_id
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
grant execute on function public.clear_my_first_class(uuid) to authenticated;

commit;
