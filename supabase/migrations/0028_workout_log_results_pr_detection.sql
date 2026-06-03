-- Phase 1 / Track E: derive is_pr on insert.
--
-- personal_records_mv is refreshed hourly; without this trigger a
-- member would log a PR and not see the badge until the next refresh.
-- The trigger computes "is this the best Rx result for this (profile,
-- movement, metric_kind) seen so far?" against workout_log_results
-- directly (not the MV — that's a snapshot that may be stale).
--
-- Semantic: is_pr captures "was this a PR at the moment of logging".
-- A later better result does NOT unset is_pr on the earlier row —
-- that history is intentional. The MV continues to surface the
-- current best for "what's my back squat PR right now" lookups.
--
-- Scaled results (is_rx = false) are never PRs.

create or replace function public.fn_workout_log_result_set_pr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id    uuid;
  v_existing_best numeric;
begin
  -- Defensive: respect a caller-set is_pr (e.g. a backfill that
  -- already knows the answer). The trigger only assigns when the
  -- caller leaves it at the default false.
  if new.is_pr then
    return new;
  end if;

  if not new.is_rx then
    return new;
  end if;

  select profile_id into v_profile_id
  from public.workout_logs
  where log_id = new.log_id;
  if v_profile_id is null then
    return new;
  end if;

  if new.metric_kind = 'time' then
    if new.value_seconds is null then
      return new;
    end if;
    select min(wlr.value_seconds)
      into v_existing_best
    from public.workout_log_results wlr
    join public.workout_logs wl on wl.log_id = wlr.log_id
    where wl.profile_id   = v_profile_id
      and wlr.movement_id = new.movement_id
      and wlr.metric_kind = new.metric_kind
      and wlr.is_rx       = true
      and wlr.result_id  <> new.result_id;
    if v_existing_best is null or new.value_seconds < v_existing_best then
      new.is_pr := true;
    end if;

  elsif new.metric_kind = 'reps' then
    if new.value_reps is null then
      return new;
    end if;
    select max(wlr.value_reps)
      into v_existing_best
    from public.workout_log_results wlr
    join public.workout_logs wl on wl.log_id = wlr.log_id
    where wl.profile_id   = v_profile_id
      and wlr.movement_id = new.movement_id
      and wlr.metric_kind = new.metric_kind
      and wlr.is_rx       = true
      and wlr.result_id  <> new.result_id;
    if v_existing_best is null or new.value_reps > v_existing_best then
      new.is_pr := true;
    end if;

  else
    -- weight, distance, calories, rounds: higher is better
    if new.value_numeric is null then
      return new;
    end if;
    select max(wlr.value_numeric)
      into v_existing_best
    from public.workout_log_results wlr
    join public.workout_logs wl on wl.log_id = wlr.log_id
    where wl.profile_id   = v_profile_id
      and wlr.movement_id = new.movement_id
      and wlr.metric_kind = new.metric_kind
      and wlr.is_rx       = true
      and wlr.result_id  <> new.result_id;
    if v_existing_best is null or new.value_numeric > v_existing_best then
      new.is_pr := true;
    end if;
  end if;

  return new;
end;
$$;

create trigger workout_log_results_pr_trg
  before insert on public.workout_log_results
  for each row execute function public.fn_workout_log_result_set_pr();
