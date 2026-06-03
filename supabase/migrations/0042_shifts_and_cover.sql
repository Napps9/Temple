-- Phase 1 / Track G: shifts and cover requests (§6.5).
--
-- Coach scheduling lives in two layers. A shift is the team's
-- commitment to be on the floor at a time — usually for a class,
-- sometimes for non-class hours (open gym, intros). Cover requests
-- flag "I can't make this shift; someone please take it" and let
-- a teammate accept.
--
-- State stays simple: assigned (someone's on it), open (no
-- assignee), covered (cover request accepted, assignee swapped).
-- The accepted-cover path rewrites assigned_to so reporting only
-- needs the current shift state.
--
-- Authorisation: owners assign and create; any staff can request
-- cover for a shift they're assigned to; any staff can accept an
-- open cover request.

create type public.shift_state as enum (
  'assigned',
  'open',
  'covered'
);

create table public.shifts (
  shift_id            uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,
  class_session_id    uuid references public.class_sessions(id) on delete set null,
  assigned_to         uuid references public.profiles(id),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  state               public.shift_state not null default 'assigned',
  notes               text,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index shifts_gym_starts_idx     on public.shifts(gym_id, starts_at);
create index shifts_assigned_to_idx    on public.shifts(assigned_to) where assigned_to is not null;
create index shifts_open_idx           on public.shifts(gym_id, starts_at) where state = 'open';

alter table public.shifts enable row level security;

-- Staff see all shifts at their gym.
create policy shifts_staff_select on public.shifts
  for select using (public.user_can_assign_plan(gym_id));

-- Owners create / reassign / delete.
create policy shifts_owner_manage on public.shifts
  for all using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));

-- ============================================================================
-- shift_cover_requests
-- ============================================================================

create table public.shift_cover_requests (
  request_id    uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references public.shifts(shift_id) on delete cascade,
  requested_by  uuid not null references public.profiles(id),
  reason        text,
  accepted_by   uuid references public.profiles(id),
  accepted_at   timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  -- Only one live request per shift at a time.
  check (
    accepted_at is null or cancelled_at is null
  )
);

create unique index shift_cover_requests_one_live_per_shift
  on public.shift_cover_requests(shift_id)
  where accepted_at is null and cancelled_at is null;

create index shift_cover_requests_accepted_by_idx
  on public.shift_cover_requests(accepted_by) where accepted_by is not null;

alter table public.shift_cover_requests enable row level security;

create policy cover_requests_staff_select on public.shift_cover_requests
  for select using (
    exists (
      select 1 from public.shifts s
      where s.shift_id = shift_cover_requests.shift_id
        and public.user_can_assign_plan(s.gym_id)
    )
  );

-- The currently-assigned staff member raises the request.
create policy cover_requests_assignee_insert on public.shift_cover_requests
  for insert with check (
    requested_by = auth.uid()
    and exists (
      select 1 from public.shifts s
      where s.shift_id = shift_cover_requests.shift_id
        and s.assigned_to = auth.uid()
        and public.user_can_assign_plan(s.gym_id)
    )
  );

-- Anyone with staff capability at the gym can accept (which flips
-- accepted_by + accepted_at) or cancel.
create policy cover_requests_staff_update on public.shift_cover_requests
  for update using (
    exists (
      select 1 from public.shifts s
      where s.shift_id = shift_cover_requests.shift_id
        and public.user_can_assign_plan(s.gym_id)
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
      where s.shift_id = shift_cover_requests.shift_id
        and public.user_can_assign_plan(s.gym_id)
    )
  );

-- ============================================================================
-- accept_cover — swap the assignee + flip shift state in one call.
-- ============================================================================

create or replace function public.accept_cover(
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_req     public.shift_cover_requests;
  v_shift   public.shifts;
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  select * into v_req from public.shift_cover_requests where request_id = p_request_id;
  if v_req.request_id is null then
    raise exception 'Cover request not found';
  end if;
  if v_req.accepted_at is not null then
    raise exception 'Cover already accepted';
  end if;
  if v_req.cancelled_at is not null then
    raise exception 'Cover request was cancelled';
  end if;

  select * into v_shift from public.shifts where shift_id = v_req.shift_id;
  if not public.user_can_assign_plan(v_shift.gym_id) then
    raise exception 'Not authorised to accept cover at this gym';
  end if;
  if v_shift.assigned_to = v_actor then
    raise exception 'Cannot accept your own cover request';
  end if;

  update public.shifts
  set assigned_to = v_actor,
      state       = 'covered'
  where shift_id = v_shift.shift_id;

  update public.shift_cover_requests
  set accepted_by = v_actor,
      accepted_at = now()
  where request_id = p_request_id;

  insert into public.audit_events (
    gym_id, actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_shift.gym_id,
    v_actor,
    'shift',
    v_shift.shift_id,
    'shift_cover_accepted',
    jsonb_build_object(
      'previous_assignee', v_shift.assigned_to,
      'new_assignee',      v_actor,
      'request_id',        p_request_id
    )
  );
end;
$$;

grant execute on function public.accept_cover(uuid) to authenticated;
