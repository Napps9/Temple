-- Article 9 protective surround for special-category health data.
--
-- PAR-Q (0032) and the injury tracker (0034) shipped health data into
-- production ahead of the GDPR controls that were specced to sit
-- underneath them. This migration lands the buildable half of that
-- surround:
--
--   1. Consent capture     — member_consents + record_consent(); a
--      lawful-basis record the onboarding flow writes before health
--      data can be collected. Entry is gated on it client-side.
--   2. Date of birth        — profiles.date_of_birth, collected in the
--      same onboarding step.
--   3. Erasure on removal   — _erase_member_health_data() hard-deletes
--      every health row for a (gym, member); leave_gym (the single
--      removal path for both self-leave and admin-remove) now calls it.
--   4. Retention purge      — purge_expired_health_data() sweeps health
--      data for members who left more than 3 months ago (the safety
--      net for anyone who left before erasure-on-removal existed, and
--      the "3 months" half of the retention rule).
--   5. Access audit trail   — health_data_access_log + the
--      log_health_data_access() RPC the staff health surfaces call,
--      so "who looked at this member's health data, and when" is
--      answerable.
--
-- The health rows in scope: parq_responses (+ answers via cascade),
-- member_injuries (+ updates via cascade), staff_alerts of the health
-- kinds, the denormalised gym_memberships.health_flag / par_q_id /
-- emergency_contact, and member_consents itself.

begin;

-- ============================================================================
-- 1. Date of birth
-- ============================================================================

alter table public.profiles
  add column if not exists date_of_birth date;

-- ============================================================================
-- 2. Consent capture
-- ============================================================================

create table if not exists public.member_consents (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  -- Which version of the consent text the member agreed to. Bumping
  -- the app-side CONSENT_POLICY_VERSION re-gates everyone.
  policy_version text not null,
  -- Lawful basis under GDPR Art. 6/9. Defaults to explicit consent;
  -- the column lets a gym record a different basis later without a
  -- schema change.
  lawful_basis  text not null default 'consent',
  consented_at  timestamptz not null default now(),
  -- Consent can't dangle past the membership it was granted under.
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade,
  unique (gym_id, profile_id, policy_version)
);

create index member_consents_lookup_idx
  on public.member_consents (gym_id, profile_id);

alter table public.member_consents enable row level security;

-- Self read/write; staff with can_see_full_pii can read (to confirm a
-- member consented). No staff writes — consent is the member's act.
create policy member_consents_self_or_staff_select on public.member_consents
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_full_pii')
  );

create policy member_consents_self_insert on public.member_consents
  for insert with check (profile_id = auth.uid());

-- record_consent — the member grants consent for the active policy
-- version. Idempotent on (gym, profile, version).
create or replace function public.record_consent(
  p_gym_id         uuid,
  p_policy_version text,
  p_lawful_basis   text default 'consent'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = v_caller
      and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  insert into public.member_consents
    (gym_id, profile_id, policy_version, lawful_basis)
    values (p_gym_id, v_caller, p_policy_version, coalesce(p_lawful_basis, 'consent'))
  on conflict (gym_id, profile_id, policy_version) do nothing;
end;
$$;

grant execute on function public.record_consent(uuid, text, text)
  to authenticated;

-- ============================================================================
-- 3. Access audit trail
-- ============================================================================

create table if not exists public.health_data_access_log (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  actor_id           uuid references public.profiles(id) on delete set null,
  subject_profile_id uuid references public.profiles(id) on delete set null,
  action             text not null
    check (action in ('view', 'erase', 'purge')),
  surface            text,
  created_at         timestamptz not null default now()
);

create index health_data_access_log_gym_idx
  on public.health_data_access_log (gym_id, created_at desc);
create index health_data_access_log_subject_idx
  on public.health_data_access_log (subject_profile_id, created_at desc);

alter table public.health_data_access_log enable row level security;

-- Only admins (can_manage_staff) can read the log; the actor columns
-- are deliberately not self-readable so the trail can't be quietly
-- inspected by the very people it records. No direct writes — entries
-- come from the security-definer functions below.
create policy health_data_access_log_admin_select on public.health_data_access_log
  for select using (public.effective_can(gym_id, 'can_manage_staff'));

-- log_health_data_access — the staff health surfaces call this when
-- they open a member's health data. Gated on can_see_health_flag so
-- only someone actually permitted to read health data can write a
-- 'view' row for it.
create or replace function public.log_health_data_access(
  p_gym_id  uuid,
  p_subject uuid,
  p_surface text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;
  insert into public.health_data_access_log
    (gym_id, actor_id, subject_profile_id, action, surface)
    values (p_gym_id, auth.uid(), p_subject, 'view', p_surface);
end;
$$;

grant execute on function public.log_health_data_access(uuid, uuid, text)
  to authenticated;

-- ============================================================================
-- 4. Erasure
-- ============================================================================

-- Internal: hard-delete every health row for a (gym, member) and log
-- the erasure. Revoked from the API surface — only the security-
-- definer callers (leave_gym, purge_expired_health_data, the public
-- erase wrapper) invoke it, and they do their own authorisation.
create or replace function public._erase_member_health_data(
  p_gym_id  uuid,
  p_profile uuid,
  p_action  text default 'erase'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- parq_answers cascade from parq_responses; injury_updates cascade
  -- from member_injuries.
  delete from public.parq_responses
    where gym_id = p_gym_id and profile_id = p_profile;

  delete from public.member_injuries
    where gym_id = p_gym_id and profile_id = p_profile;

  delete from public.staff_alerts
    where gym_id = p_gym_id
      and subject_profile_id = p_profile
      and kind in ('parq_flag', 'injury_new', 'injury_update');

  delete from public.member_consents
    where gym_id = p_gym_id and profile_id = p_profile;

  -- Clear the denormalised health columns on the membership.
  update public.gym_memberships
    set health_flag = false,
        par_q_id = null,
        emergency_contact = null
    where gym_id = p_gym_id and profile_id = p_profile;

  insert into public.health_data_access_log
    (gym_id, actor_id, subject_profile_id, action, surface)
    values (p_gym_id, auth.uid(), p_profile,
            case when p_action = 'purge' then 'purge' else 'erase' end,
            'erase_member_health_data');
end;
$$;

revoke execute on function public._erase_member_health_data(uuid, uuid, text)
  from public, anon, authenticated;

-- Public wrapper: a member can erase their own health data; an admin
-- can erase a member's. (leave_gym calls the internal helper directly.)
create or replace function public.erase_member_health_data(
  p_gym_id  uuid,
  p_profile uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if auth.uid() <> p_profile and not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  perform public._erase_member_health_data(p_gym_id, p_profile, 'erase');
end;
$$;

grant execute on function public.erase_member_health_data(uuid, uuid)
  to authenticated;

-- ============================================================================
-- 5. Erasure on removal — leave_gym now purges health data
-- ============================================================================

create or replace function public.leave_gym(p_gym_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_uid <> p_profile_id and not public.user_can_admin(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  update public.gym_memberships
    set left_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and left_at is null;

  delete from public.class_bookings
    where profile_id = p_profile_id
      and class_session_id in (
        select id from public.class_sessions
        where gym_id = p_gym_id and starts_at > now()
      );

  update public.plan_subscriptions
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now())
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and not public.is_terminal_subscription_status(status);

  update public.comp_grants
    set revoked_at = now()
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and revoked_at is null;

  delete from public.class_waitlist
    where gym_id = p_gym_id and profile_id = p_profile_id;

  -- Removal from the membership erases the member's special-category
  -- health data immediately (the "OR after member is removed" half of
  -- the retention rule). Re-joining means re-consenting + re-screening.
  perform public._erase_member_health_data(p_gym_id, p_profile_id, 'erase');
end;
$$;

grant execute on function public.leave_gym(uuid, uuid) to authenticated;

-- ============================================================================
-- 6. Retention purge — 3 months after a member leaves
-- ============================================================================

-- Sweeps health data for memberships whose left_at is older than the
-- retention window. Catches members who left before erasure-on-removal
-- existed, and backstops any path that sets left_at without erasing.
-- Returns the number of memberships purged. Schedule via pg_cron (or a
-- nightly CI invocation) — also safe to run manually.
create or replace function public.purge_expired_health_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select gm.gym_id, gm.profile_id
    from public.gym_memberships gm
    where gm.left_at is not null
      and gm.left_at < now() - interval '3 months'
      -- Only touch memberships that still have health rows to purge.
      and (
        gm.health_flag
        or gm.par_q_id is not null
        or gm.emergency_contact is not null
        or exists (
          select 1 from public.parq_responses r
          where r.gym_id = gm.gym_id and r.profile_id = gm.profile_id
        )
        or exists (
          select 1 from public.member_injuries mi
          where mi.gym_id = gm.gym_id and mi.profile_id = gm.profile_id
        )
        or exists (
          select 1 from public.member_consents mc
          where mc.gym_id = gm.gym_id and mc.profile_id = gm.profile_id
        )
      )
  loop
    perform public._erase_member_health_data(
      v_row.gym_id, v_row.profile_id, 'purge');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Owner / admin can trigger a manual sweep; the scheduler runs it as
-- the table owner.
grant execute on function public.purge_expired_health_data() to authenticated;

commit;
