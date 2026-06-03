-- Phase 1 / Track E: prediction_models_mv.
--
-- "What weight / time should I expect today?" — a hint, not a
-- promise, and never the source for programming percentages
-- (those resolve against training_maxes only — see 0031).
--
-- Sprint 3 model: weighted average of the last 5 Rx results per
-- (profile, movement, metric_kind), with the most recent weighted
-- highest (5,4,3,2,1). Adapts quickly to recent form without being
-- a single-day prediction. Sample_count exposed so the UI can
-- render confidence appropriately (1 result = "tentative",
-- 5+ = "stable").
--
-- Refreshed hourly off Track A's pg_cron, with a 5-minute offset
-- from the PR refresh so the two refresh jobs don't stack on the
-- same scheduler tick.

create materialized view public.prediction_models_mv as
  with ranked as (
    select
      wl.profile_id,
      wlr.movement_id,
      wlr.metric_kind,
      case wlr.metric_kind
        when 'time' then wlr.value_seconds::numeric
        when 'reps' then wlr.value_reps::numeric
        else wlr.value_numeric
      end as v,
      wl.logged_at,
      row_number() over (
        partition by wl.profile_id, wlr.movement_id, wlr.metric_kind
        order by wl.logged_at desc
      ) as rnk
    from public.workout_logs wl
    join public.workout_log_results wlr on wlr.log_id = wl.log_id
    where wlr.is_rx = true
  ),
  windowed as (
    select * from ranked where rnk <= 5 and v is not null
  )
  select
    profile_id,
    movement_id,
    metric_kind,
    round(sum(v * (6 - rnk)) / sum(6 - rnk)::numeric, 2) as predicted_value,
    max(logged_at) as last_basis_at,
    count(*)::integer as sample_count
  from windowed
  group by profile_id, movement_id, metric_kind;

create unique index prediction_models_mv_pk
  on public.prediction_models_mv(profile_id, movement_id, metric_kind);

-- ============================================================================
-- get_predictions — RLS-aware accessor (MVs can't carry RLS).
-- ============================================================================

create or replace function public.get_predictions(
  p_profile_id uuid default null
) returns table (
  profile_id      uuid,
  movement_id     uuid,
  metric_kind     public.tracked_metric,
  predicted_value numeric,
  last_basis_at   timestamptz,
  sample_count    integer
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
      raise exception 'Not authorised to read predictions';
    end if;
  end if;

  return query
    select pm.profile_id, pm.movement_id, pm.metric_kind,
           pm.predicted_value, pm.last_basis_at, pm.sample_count
    from public.prediction_models_mv pm
    where pm.profile_id = v_target;
end;
$$;

grant execute on function public.get_predictions(uuid) to authenticated;

-- ============================================================================
-- cron_refresh_prediction_models — hourly, 5 min offset from PR refresh.
-- ============================================================================

create or replace function public.cron_refresh_prediction_models()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.prediction_models_mv;
end;
$$;

select cron.schedule(
  'temple_refresh_prediction_models',
  '20 * * * *',
  $$select public.cron_refresh_prediction_models();$$
);
