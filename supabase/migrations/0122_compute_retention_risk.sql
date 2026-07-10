-- Retention cockpit, Phase 2 — the on-demand at-risk list + summary.
--
-- Composes the signals plumbed in Phase 1 (cohort expiry/past_due, the
-- attendance-decay view, member->coach) into a weighted risk score with
-- reason codes, computed live when the cockpit opens (the owner chose
-- on-demand, mirroring compute_insight_summary — no materialised table).
--
-- Candidate set = CURRENT members (left_at is null). Departed members are the
-- win-back segment (v_winback_candidates), handled separately. Weights are
-- hard-coded for v1; a per-gym tunable (a gym_insight_targets analogue) is a
-- later, optional follow-up.
--
-- Security-definer + effective_can gate, exactly like compute_insight_summary.
-- Reading the security_invoker views inside a definer function owned by a
-- superuser bypasses their RLS, so the function sees the whole gym; the
-- effective_can check is the real authorisation boundary.

begin;

create or replace function public.compute_retention_risk(p_gym_id uuid)
returns table (
  member_id         uuid,
  full_name         text,
  risk_band         text,
  risk_score        integer,
  reasons           text[],
  days_until_expiry integer,
  is_past_due       boolean,
  last_attended_at  timestamptz,
  cadence_ratio     numeric,
  assigned_coach_id uuid
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_retention') then
    raise exception 'Not authorised';
  end if;

  return query
  with base as (
    select
      gm.profile_id  as member_id,
      p.full_name    as full_name,
      gm.created_at  as joined_at,
      c.is_expiring_soon,
      c.is_expired,
      c.days_until_expiry,
      exists (
        select 1 from public.plan_subscriptions ps
        where ps.gym_id = p_gym_id
          and ps.profile_id = gm.profile_id
          and ps.status = 'past_due'
      ) as is_past_due,
      a.last_attended_at,
      a.cadence_ratio,
      mca.coach_id as assigned_coach_id
    from public.gym_memberships gm
    join public.profiles p on p.id = gm.profile_id
    left join public.v_member_cohort c
      on c.gym_id = p_gym_id and c.profile_id = gm.profile_id
    left join public.v_member_attendance_signal a
      on a.gym_id = p_gym_id and a.profile_id = gm.profile_id
    left join public.member_coach_assignments mca
      on mca.gym_id = p_gym_id and mca.member_id = gm.profile_id
    where gm.gym_id = p_gym_id
      and gm.role = 'member'
      and gm.left_at is null
  ),
  scored as (
    select
      b.*,
      (case when b.is_past_due then 40 else 0 end)
      + (case when coalesce(b.is_expired, false) then 35 else 0 end)
      + (case when coalesce(b.is_expiring_soon, false) then 30 else 0 end)
      + (case
           when b.cadence_ratio is not null and b.cadence_ratio < 0.5 then 25
           when b.cadence_ratio is not null and b.cadence_ratio < 0.75 then 15
           else 0
         end)
      + (case
           when b.last_attended_at is null
             and b.joined_at < now() - interval '14 days' then 20
           else 0
         end) as score,
      array_remove(array[
        case when b.is_past_due then 'past_due' end,
        case when coalesce(b.is_expired, false) then 'expired' end,
        case when coalesce(b.is_expiring_soon, false) then 'expiring_soon' end,
        case when b.cadence_ratio is not null and b.cadence_ratio < 0.75
             then 'attendance_decay' end,
        case when b.last_attended_at is null
               and b.joined_at < now() - interval '14 days'
             then 'never_attended' end
      ], null) as reasons
    from base b
  )
  select
    s.member_id,
    s.full_name,
    case when s.score >= 60 then 'critical'
         when s.score >= 30 then 'at_risk'
         else 'watch' end as risk_band,
    s.score as risk_score,
    s.reasons,
    s.days_until_expiry,
    s.is_past_due,
    s.last_attended_at,
    s.cadence_ratio,
    s.assigned_coach_id
  from scored s
  where s.score > 0
  order by s.score desc, s.last_attended_at asc nulls first, s.full_name asc;
end;
$$;
grant execute on function public.compute_retention_risk(uuid) to authenticated;

-- Cheap counts for the header tiles + the nav badge, so a passive load never
-- runs the full row-level scorer just to render a number. at_risk mirrors the
-- scorer's "score > 0" definition.
create or replace function public.compute_retention_summary(p_gym_id uuid)
returns table (
  at_risk  integer,
  expiring integer,
  past_due integer,
  winback  integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_retention') then
    raise exception 'Not authorised';
  end if;

  return query
  with base as (
    select
      gm.profile_id,
      c.is_expiring_soon,
      c.is_expired,
      exists (
        select 1 from public.plan_subscriptions ps
        where ps.gym_id = p_gym_id
          and ps.profile_id = gm.profile_id
          and ps.status = 'past_due'
      ) as is_past_due,
      a.cadence_ratio,
      a.last_attended_at,
      gm.created_at as joined_at
    from public.gym_memberships gm
    left join public.v_member_cohort c
      on c.gym_id = p_gym_id and c.profile_id = gm.profile_id
    left join public.v_member_attendance_signal a
      on a.gym_id = p_gym_id and a.profile_id = gm.profile_id
    where gm.gym_id = p_gym_id
      and gm.role = 'member'
      and gm.left_at is null
  )
  select
    (select count(*)::int from base b
      where b.is_past_due
         or coalesce(b.is_expired, false)
         or coalesce(b.is_expiring_soon, false)
         or (b.cadence_ratio is not null and b.cadence_ratio < 0.75)
         or (b.last_attended_at is null and b.joined_at < now() - interval '14 days')),
    (select count(*)::int from base b where coalesce(b.is_expiring_soon, false)),
    (select count(*)::int from base b where b.is_past_due),
    (select count(*)::int from public.v_winback_candidates w where w.gym_id = p_gym_id);
end;
$$;
grant execute on function public.compute_retention_summary(uuid) to authenticated;

commit;
