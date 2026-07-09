-- 0113_dependents.sql
--
-- Parent/family accounts: a guardian (a normal member) can add CHILDREN as
-- dependents — profiles with NO login of their own — complete the child's
-- health screening on their behalf, and book the child into classes.
--
-- Design: a dependent is a real `profiles` row (so it flows through the
-- existing gym_memberships / PAR-Q / waiver / booking logic that all key on
-- profile_id) but with no auth.users login. That needs the profiles→auth FK
-- relaxed. Because a dependent's id is a random uuid that never equals any
-- auth.uid(), every existing `profile_id = auth.uid()` RLS policy already
-- EXCLUDES dependents by default — guardian access is granted only through the
-- explicit is_guardian_of() branches added below. Safe-by-default.
--
-- SECURITY-CRITICAL: this touches health-data access. Verified by pgTAP
-- (supabase/tests/dependents.sql) in CI; run /security-review before relying
-- on it. Dependent bookings are no-charge in this MVP (billing deferred).

-- ---------------------------------------------------------------------------
-- 1. Loginless dependent profiles
-- ---------------------------------------------------------------------------

-- Drop the hard profiles.id → auth.users FK (whatever it's named) so a
-- dependent profile can exist without a login. Real users still get
-- id = auth uid via the signup trigger (0042).
do $$
declare v_con text;
begin
  select conname into v_con
    from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and contype = 'f'
     and confrelid = 'auth.users'::regclass;
  if v_con is not null then
    execute format('alter table public.profiles drop constraint %I', v_con);
  end if;
end $$;

alter table public.profiles
  add column if not exists managed boolean not null default false;

-- The dropped FK carried ON DELETE CASCADE (auth user deleted → profile gone).
-- Replace it with a trigger so real users still clean up; dependents (no auth
-- row) are unaffected.
create or replace function public.handle_auth_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();

-- ---------------------------------------------------------------------------
-- 2. Guardianship link + helper
-- ---------------------------------------------------------------------------

create table if not exists public.guardianships (
  id                   uuid primary key default gen_random_uuid(),
  guardian_profile_id  uuid not null references public.profiles(id) on delete cascade,
  dependent_profile_id uuid not null references public.profiles(id) on delete cascade,
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  created_at           timestamptz not null default now(),
  unique (dependent_profile_id)
);

create index if not exists guardianships_guardian_idx
  on public.guardianships (guardian_profile_id);

alter table public.guardianships enable row level security;

-- A guardian can see their own links. No client writes — create_dependent
-- (definer) is the only writer.
create policy guardianships_self_select on public.guardianships
  for select using (guardian_profile_id = auth.uid());

-- Is the caller the guardian of this dependent? Used by RLS + the RPCs, so
-- the rule lives in one place.
create or replace function public.is_guardian_of(p_dependent_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.guardianships g
    where g.guardian_profile_id = auth.uid()
      and g.dependent_profile_id = p_dependent_profile_id
  );
$$;
grant execute on function public.is_guardian_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_dependent — mint a child profile + membership + consent
-- ---------------------------------------------------------------------------

create or replace function public.create_dependent(
  p_gym_id         uuid,
  p_full_name      text,
  p_dob            date,
  p_policy_version text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_dependent  uuid;
  v_guardian_name text;
  v_guardian_email text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'A name is required';
  end if;
  if p_dob is null then raise exception 'A date of birth is required'; end if;
  -- Dependents are children.
  if p_dob <= (current_date - interval '18 years') then
    raise exception 'A dependent must be under 18';
  end if;
  -- Caller must be an active member of the gym.
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id and gm.profile_id = v_caller and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;
  -- The gym must have opted in to under-18 members.
  if not coalesce((select allow_minors from public.gyms where id = p_gym_id), false) then
    raise exception 'This gym does not accept members under 18';
  end if;

  select full_name into v_guardian_name from public.profiles where id = v_caller;
  select email into v_guardian_email from auth.users where id = v_caller;

  insert into public.profiles (id, full_name, date_of_birth, managed)
    values (gen_random_uuid(), trim(p_full_name), p_dob, true)
    returning id into v_dependent;

  insert into public.gym_memberships (gym_id, profile_id, role)
    values (p_gym_id, v_dependent, 'member');

  insert into public.guardianships
    (guardian_profile_id, dependent_profile_id, gym_id)
    values (v_caller, v_dependent, p_gym_id);

  -- The guardian gives data-processing consent on the child's behalf.
  insert into public.member_consents
    (gym_id, profile_id, policy_version, lawful_basis, guardian_name, guardian_contact)
    values (p_gym_id, v_dependent, p_policy_version, 'parental_consent',
            v_guardian_name, v_guardian_email)
  on conflict (gym_id, profile_id, policy_version) do nothing;

  return v_dependent;
end;
$$;
grant execute on function public.create_dependent(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Guardian completes the child's gym screening (subject param added)
-- ---------------------------------------------------------------------------

-- sign_waiver: add p_subject_profile_id (default = caller). A guardian may
-- sign for their dependent; anyone else may only sign for themselves.
drop function if exists public.sign_waiver(uuid, uuid, jsonb);
create function public.sign_waiver(
  p_gym_id             uuid,
  p_waiver_id          uuid,
  p_signature          jsonb,
  p_subject_profile_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_subject uuid := coalesce(p_subject_profile_id, auth.uid());
  v_sig_id  uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if v_subject <> v_caller and not public.is_guardian_of(v_subject) then
    raise exception 'Not authorised to sign for this member';
  end if;
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = v_subject
      and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;
  if not exists (
    select 1 from public.waiver_documents w
    where w.id = p_waiver_id and w.gym_id = p_gym_id and w.is_active
  ) then
    raise exception 'Waiver is not the active version';
  end if;
  if p_signature is null or jsonb_typeof(p_signature) <> 'object'
     or coalesce(jsonb_array_length(p_signature->'paths'), 0) = 0 then
    raise exception 'Signature is required';
  end if;

  insert into public.waiver_signatures
    (gym_id, profile_id, waiver_id, signature)
    values (p_gym_id, v_subject, p_waiver_id, p_signature)
  on conflict (profile_id, waiver_id) do update
    set signature = excluded.signature,
        signed_at = now()
  returning id into v_sig_id;

  return v_sig_id;
end;
$$;
grant execute on function public.sign_waiver(uuid, uuid, jsonb, uuid) to authenticated;

-- submit_parq_response: add p_subject_profile_id (default = caller).
drop function if exists public.submit_parq_response(uuid, uuid, jsonb);
create function public.submit_parq_response(
  p_gym_id             uuid,
  p_questionnaire_id   uuid,
  p_answers            jsonb,
  p_subject_profile_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller      uuid := auth.uid();
  v_subject     uuid := coalesce(p_subject_profile_id, auth.uid());
  v_response_id uuid;
  v_has_flag    boolean;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if v_subject <> v_caller and not public.is_guardian_of(v_subject) then
    raise exception 'Not authorised to submit for this member';
  end if;
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id and gm.profile_id = v_subject and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;
  if not exists (
    select 1 from public.parq_questionnaires q
    where q.id = p_questionnaire_id and q.gym_id = p_gym_id
  ) then
    raise exception 'Questionnaire does not belong to this gym';
  end if;

  select coalesce(bool_or(
    coalesce((a->>'answered_yes')::boolean, false)
    and coalesce(qq.flag_on_yes, false)
  ), false)
  into v_has_flag
  from jsonb_array_elements(p_answers) a
  join public.parq_questions qq
    on qq.id = (a->>'question_id')::uuid
  where qq.questionnaire_id = p_questionnaire_id;

  insert into public.parq_responses
    (gym_id, profile_id, questionnaire_id, has_flag)
    values (p_gym_id, v_subject, p_questionnaire_id, v_has_flag)
    returning id into v_response_id;

  insert into public.parq_answers
    (response_id, question_id, answered_yes, explanation)
  select
    v_response_id,
    (a->>'question_id')::uuid,
    coalesce((a->>'answered_yes')::boolean, false),
    nullif(a->>'explanation', '')
  from jsonb_array_elements(p_answers) a;

  update public.gym_memberships gm
    set health_flag = v_has_flag,
        par_q_id    = v_response_id
    where gm.gym_id = p_gym_id and gm.profile_id = v_subject;

  if v_has_flag then
    insert into public.staff_alerts
      (gym_id, kind, subject_profile_id, related_id)
      values (p_gym_id, 'parq_flag', v_subject, v_response_id);
  end if;

  return v_response_id;
end;
$$;
grant execute on function public.submit_parq_response(uuid, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reader RPCs: let a guardian read a dependent's screening state
-- ---------------------------------------------------------------------------

create or replace function public.current_waiver_state(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  active_waiver_id uuid,
  last_signature_id uuid,
  last_signed_at    timestamptz,
  needs_waiver      boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active uuid;
  v_sig    public.waiver_signatures%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if auth.uid() <> p_profile_id
     and not public.is_guardian_of(p_profile_id)
     and not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;

  -- Audit a guardian reading their child's health state (staff reads are
  -- logged client-side; self-reads aren't logged). log_health_data_access is
  -- staff-gated, so insert directly (this definer bypasses the log's RLS).
  if auth.uid() <> p_profile_id and public.is_guardian_of(p_profile_id) then
    insert into public.health_data_access_log
      (gym_id, actor_id, subject_profile_id, action, surface)
      values (p_gym_id, auth.uid(), p_profile_id, 'view', 'guardian_waiver_state');
  end if;

  select id into v_active
    from public.waiver_documents
    where gym_id = p_gym_id and is_active
    limit 1;

  select * into v_sig
    from public.waiver_signatures
    where gym_id = p_gym_id and profile_id = p_profile_id
      and waiver_id = v_active
    limit 1;

  active_waiver_id  := v_active;
  last_signature_id := v_sig.id;
  last_signed_at    := v_sig.signed_at;
  needs_waiver      := v_active is not null and v_sig.id is null;

  return next;
end;
$$;
grant execute on function public.current_waiver_state(uuid, uuid) to authenticated;

create or replace function public.current_parq_state(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  active_questionnaire_id uuid,
  last_response_id        uuid,
  last_completed_at       timestamptz,
  last_had_flag           boolean,
  needs_parq              boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active        uuid;
  v_response      public.parq_responses%rowtype;
  v_parq_days     integer;
  v_expired_after interval;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if auth.uid() <> p_profile_id
     and not public.is_guardian_of(p_profile_id)
     and not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;

  -- Audit a guardian reading their child's PAR-Q state (see the waiver
  -- reader for the rationale).
  if auth.uid() <> p_profile_id and public.is_guardian_of(p_profile_id) then
    insert into public.health_data_access_log
      (gym_id, actor_id, subject_profile_id, action, surface)
      values (p_gym_id, auth.uid(), p_profile_id, 'view', 'guardian_parq_state');
  end if;

  select parq_expiry_days into v_parq_days from public.gyms where id = p_gym_id;
  v_expired_after := make_interval(days => coalesce(v_parq_days, 365));

  select id into v_active
    from public.parq_questionnaires
    where gym_id = p_gym_id and is_active
    limit 1;

  select * into v_response
    from public.parq_responses r
    where r.gym_id = p_gym_id and r.profile_id = p_profile_id
    order by completed_at desc
    limit 1;

  active_questionnaire_id := v_active;
  last_response_id        := v_response.id;
  last_completed_at       := v_response.completed_at;
  last_had_flag           := v_response.has_flag;

  if v_active is null then
    needs_parq := false;
  elsif v_response.id is null then
    needs_parq := true;
  elsif v_response.questionnaire_id <> v_active then
    needs_parq := true;
  elsif v_response.completed_at < (now() - v_expired_after) then
    needs_parq := true;
  else
    needs_parq := false;
  end if;

  return next;
end;
$$;
grant execute on function public.current_parq_state(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Book / cancel a dependent
-- ---------------------------------------------------------------------------

-- Mirrors staff_book_member (0103) but authorised by guardianship. No-charge
-- seat for the MVP (dependent billing is a later phase).
create or replace function public.parent_book_dependent(
  p_session_id  uuid,
  p_dependent_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_guardian_of(p_dependent_id) then
    raise exception 'Not authorised to book for this member';
  end if;
  return public._book_class_for(
    p_session_id, p_dependent_id, null, null, auth.uid(), false, true);
end;
$$;
grant execute on function public.parent_book_dependent(uuid, uuid) to authenticated;

create or replace function public.parent_cancel_dependent_booking(
  p_booking_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select profile_id into v_profile
    from public.class_bookings where id = p_booking_id;
  if v_profile is null then
    raise exception 'Booking not found';
  end if;
  if not public.is_guardian_of(v_profile) then
    raise exception 'Not authorised to cancel this booking';
  end if;
  -- The BEFORE DELETE refund trigger handles any credit (none for a
  -- no-charge dependent seat).
  delete from public.class_bookings where id = p_booking_id;
end;
$$;
grant execute on function public.parent_cancel_dependent_booking(uuid) to authenticated;

-- Remove a dependent. Mirrors leave_gym (0037) for the child — a soft
-- removal (end the membership + erase health data + drop future bookings)
-- rather than a hard profile delete, which billing_events.member_id (a NOT
-- NULL/RESTRICT FK) would block for anyone ever charged. Guardian-gated;
-- leave_gym itself can't be reused (it authorises self-or-admin, and a
-- guardian is neither).
create or replace function public.remove_dependent(
  p_dependent_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_guardian_of(p_dependent_id) then
    raise exception 'Not authorised to remove this member';
  end if;

  select gym_id into v_gym
    from public.guardianships
    where dependent_profile_id = p_dependent_id
      and guardian_profile_id = auth.uid();

  update public.gym_memberships
    set left_at = now()
    where gym_id = v_gym and profile_id = p_dependent_id and left_at is null;

  delete from public.class_bookings
    where profile_id = p_dependent_id
      and class_session_id in (
        select id from public.class_sessions
        where gym_id = v_gym and starts_at > now()
      );

  update public.plan_subscriptions
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
    where gym_id = v_gym and profile_id = p_dependent_id
      and not public.is_terminal_subscription_status(status);

  delete from public.class_waitlist
    where gym_id = v_gym and profile_id = p_dependent_id;

  -- Waivers aren't health data (leave_gym/_erase leave them), but a removed
  -- dependent has no reason to retain one.
  delete from public.waiver_signatures
    where gym_id = v_gym and profile_id = p_dependent_id;

  perform public._erase_member_health_data(v_gym, p_dependent_id, 'erase');

  delete from public.guardianships
    where dependent_profile_id = p_dependent_id
      and guardian_profile_id = auth.uid();
end;
$$;
grant execute on function public.remove_dependent(uuid) to authenticated;
