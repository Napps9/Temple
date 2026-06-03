-- Phase 1 / Track E: workout logs + results + PR materialised view.
--
-- Second of three workout layers (catalog → programmed → logged).
-- A workout_log is one session; many workout_log_results hang off it,
-- one per movement scored.
--
-- gym_id is nullable so a non-member (§5.4 / Track F) can self-log
-- with no gym attached. class_session_id is nullable so the member
-- can log unattended workouts too.
--
-- Personal records live in personal_records_mv, refreshed hourly by
-- a cron job registered against Track A's pg_cron scaffolding.

-- ============================================================================
-- 1. workout_logs
-- ============================================================================

create table public.workout_logs (
  log_id           uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  gym_id           uuid references public.gyms(id) on delete set null,
  class_session_id uuid references public.class_sessions(id) on delete set null,
  programmed_at    date,
  logged_at        timestamptz not null default now(),
  notes            text
);

create index workout_logs_profile_idx       on public.workout_logs(profile_id, logged_at desc);
create index workout_logs_gym_session_idx   on public.workout_logs(gym_id, class_session_id)
  where class_session_id is not null;

alter table public.workout_logs enable row level security;

create policy workout_logs_self_select on public.workout_logs
  for select using (profile_id = auth.uid());
create policy workout_logs_self_insert on public.workout_logs
  for insert with check (profile_id = auth.uid());
create policy workout_logs_self_update on public.workout_logs
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy workout_logs_self_delete on public.workout_logs
  for delete using (profile_id = auth.uid());

-- Staff (Owner/Coach/Staff) at the gym can read for coaching insight.
create policy workout_logs_staff_select on public.workout_logs
  for select using (
    gym_id is not null and public.user_can_assign_plan(gym_id)
  );

-- ============================================================================
-- 2. workout_log_results
-- ============================================================================

create table public.workout_log_results (
  result_id     uuid primary key default gen_random_uuid(),
  log_id        uuid not null references public.workout_logs(log_id) on delete cascade,
  movement_id   uuid not null references public.movements(movement_id),
  metric_kind   public.tracked_metric not null,
  value_numeric numeric,   -- weight (kg), distance (m), calories, rounds
  value_seconds integer,   -- time
  value_reps    integer,   -- reps
  is_rx         boolean not null default true,
  ordinal       integer not null default 0,
  created_at    timestamptz not null default now(),
  -- One of the three value columns must match metric_kind. The
  -- writer is responsible for putting weight/distance/etc. in
  -- value_numeric, time in value_seconds, reps in value_reps.
  check (
    (metric_kind = 'time'        and value_seconds is not null) or
    (metric_kind = 'reps'        and value_reps is not null) or
    (metric_kind in ('weight','distance','calories','rounds')
                                 and value_numeric is not null)
  )
);

create index workout_log_results_log_idx       on public.workout_log_results(log_id);
create index workout_log_results_movement_idx  on public.workout_log_results(movement_id);

alter table public.workout_log_results enable row level security;

-- Member reads/writes their own results via the parent log.
create policy workout_log_results_self_select on public.workout_log_results
  for select using (
    exists (
      select 1 from public.workout_logs wl
      where wl.log_id = workout_log_results.log_id
        and wl.profile_id = auth.uid()
    )
  );
create policy workout_log_results_self_insert on public.workout_log_results
  for insert with check (
    exists (
      select 1 from public.workout_logs wl
      where wl.log_id = workout_log_results.log_id
        and wl.profile_id = auth.uid()
    )
  );
create policy workout_log_results_self_update on public.workout_log_results
  for update using (
    exists (
      select 1 from public.workout_logs wl
      where wl.log_id = workout_log_results.log_id
        and wl.profile_id = auth.uid()
    )
  );
create policy workout_log_results_self_delete on public.workout_log_results
  for delete using (
    exists (
      select 1 from public.workout_logs wl
      where wl.log_id = workout_log_results.log_id
        and wl.profile_id = auth.uid()
    )
  );

-- Staff at the gym read the results of logs they can see.
create policy workout_log_results_staff_select on public.workout_log_results
  for select using (
    exists (
      select 1 from public.workout_logs wl
      where wl.log_id = workout_log_results.log_id
        and wl.gym_id is not null
        and public.user_can_assign_plan(wl.gym_id)
    )
  );

-- ============================================================================
-- 3. personal_records_mv
--    "Best result per (profile, movement, metric_kind)" — observed
--    history. For weight/reps/distance/calories/rounds, best = max.
--    For time, best = min (stored in best_value as seconds).
--    Refreshed hourly by cron_refresh_personal_records.
--
--    Only is_rx results count toward PRs. Scaled work doesn't.
-- ============================================================================

create materialized view public.personal_records_mv as
  select
    wl.profile_id,
    wlr.movement_id,
    wlr.metric_kind,
    case
      when wlr.metric_kind = 'time'    then min(wlr.value_seconds)::numeric
      when wlr.metric_kind = 'reps'    then max(wlr.value_reps)::numeric
      when wlr.metric_kind in ('weight','distance','calories','rounds')
                                       then max(wlr.value_numeric)
    end as best_value,
    max(wl.logged_at) as last_set_at,
    count(*)::integer as session_count
  from public.workout_logs wl
  join public.workout_log_results wlr on wlr.log_id = wl.log_id
  where wlr.is_rx = true
  group by wl.profile_id, wlr.movement_id, wlr.metric_kind;

create unique index personal_records_mv_pk
  on public.personal_records_mv(profile_id, movement_id, metric_kind);

-- ============================================================================
-- 4. aggregate_pr_across_variations
--    Walks parent_movement_id from the requested root and returns
--    the best across all descendants. "What's my best squat?" rolls
--    back squat + front squat + overhead squat together.
--    Training-max lookups deliberately do NOT use this — see
--    docs/entitlement-states.md notes on training_maxes (Track E
--    sprint 3).
-- ============================================================================

create or replace function public.aggregate_pr_across_variations(
  p_profile_id        uuid,
  p_root_movement_id  uuid,
  p_metric_kind       public.tracked_metric
) returns table (
  best_value          numeric,
  last_set_at         timestamptz,
  movement_id         uuid
)
language sql
security definer
stable
set search_path = public
as $$
  with recursive descendants as (
    select movement_id from public.movements
    where movement_id = p_root_movement_id
    union all
    select m.movement_id from public.movements m
    join descendants d on m.parent_movement_id = d.movement_id
  ),
  ranked as (
    select pr.best_value, pr.last_set_at, pr.movement_id,
           row_number() over (
             order by
               case when p_metric_kind = 'time' then pr.best_value end asc nulls last,
               case when p_metric_kind <> 'time' then pr.best_value end desc nulls last,
               pr.last_set_at desc
           ) as rnk
    from public.personal_records_mv pr
    where pr.profile_id = p_profile_id
      and pr.metric_kind = p_metric_kind
      and pr.movement_id in (select movement_id from descendants)
  )
  select best_value, last_set_at, movement_id from ranked where rnk = 1;
$$;
grant execute on function public.aggregate_pr_across_variations(uuid, uuid, public.tracked_metric) to authenticated;

-- ============================================================================
-- 5. get_personal_records — RLS-aware accessor over the MV
--    Materialised views can't carry RLS, so the MV stays
--    service-role and this SECURITY DEFINER wrapper enforces self /
--    same-gym-staff access.
-- ============================================================================

create or replace function public.get_personal_records(
  p_profile_id uuid default null
) returns table (
  profile_id    uuid,
  movement_id   uuid,
  metric_kind   public.tracked_metric,
  best_value    numeric,
  last_set_at   timestamptz,
  session_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_target uuid;
begin
  v_target := coalesce(p_profile_id, auth.uid());
  if v_target is null then
    return;
  end if;

  if v_target <> auth.uid() then
    if not exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = v_target
        and public.user_can_assign_plan(gm.gym_id)
    ) then
      raise exception 'Not authorised to read personal records';
    end if;
  end if;

  return query
    select pr.profile_id, pr.movement_id, pr.metric_kind,
           pr.best_value, pr.last_set_at, pr.session_count
    from public.personal_records_mv pr
    where pr.profile_id = v_target;
end;
$$;
grant execute on function public.get_personal_records(uuid) to authenticated;

-- ============================================================================
-- 6. cron_refresh_personal_records — hourly refresh
-- ============================================================================

create or replace function public.cron_refresh_personal_records()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.personal_records_mv;
end;
$$;

select cron.schedule(
  'temple_refresh_personal_records',
  '15 * * * *',
  $$select public.cron_refresh_personal_records();$$
);
