-- Phase 1 / Track E: training_maxes — the third programming-base store.
--
-- Three numbers, never conflated:
--   personal_records_mv  — observed best (history-derived).
--   prediction_models_mv — today's suggested working weight (rolling).
--   training_maxes       — deliberately-set base for percentage
--                          programming (5/3/1, oly cycles).
--
-- Percentages resolve only against training_maxes — never against
-- the PR aggregation, never against predictions. A back-squat
-- training max and a front-squat training max are independent rows
-- even though both sit under "squat" in the variation tree.
--
-- source distinguishes how the value got there:
--   member  — athlete set it themselves
--   coach   — staff at the gym set it (e.g. fresh testing day)
--   seeded  — derived from history via Epley as a one-tap suggestion;
--             becomes 'member' or 'coach' on acceptance.

create type public.training_max_source as enum (
  'member',
  'coach',
  'seeded'
);

create table public.training_maxes (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  movement_id   uuid not null references public.movements(movement_id) on delete cascade,
  value_numeric numeric not null check (value_numeric > 0),
  units         text not null default 'kg' check (units in ('kg', 'lb')),
  source        public.training_max_source not null default 'member',
  set_by        uuid not null references public.profiles(id),
  set_at        timestamptz not null default now(),
  primary key (profile_id, movement_id)
);

create index training_maxes_profile_idx on public.training_maxes(profile_id);

alter table public.training_maxes enable row level security;

create policy training_maxes_self_select on public.training_maxes
  for select using (profile_id = auth.uid());
create policy training_maxes_self_manage on public.training_maxes
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Coaches at any of the athlete's gyms can read + write.
create policy training_maxes_coach_select on public.training_maxes
  for select using (
    exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = training_maxes.profile_id
        and public.user_can_issue_comp_grant(gm.gym_id)
    )
  );

create policy training_maxes_coach_manage on public.training_maxes
  for all using (
    exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = training_maxes.profile_id
        and public.user_can_issue_comp_grant(gm.gym_id)
    )
  )
  with check (
    exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = training_maxes.profile_id
        and public.user_can_issue_comp_grant(gm.gym_id)
    )
  );

-- ============================================================================
-- suggest_training_max — one-tap seed from Epley estimate.
--
-- Reads the member's best (weight, reps) Rx pair for the movement
-- from workout_log_results and returns an estimated 1RM via Epley:
--   1RM ≈ weight × (1 + reps / 30)
--
-- Conservative by design (Epley undercuts on high-rep sets), which
-- matches the spec's "deliberately-set, slightly-conservative base".
-- The athlete or coach can accept (writes the value into
-- training_maxes via the upsert RPC below) or override.
-- ============================================================================

create or replace function public.suggest_training_max(
  p_profile_id  uuid,
  p_movement_id uuid
) returns table (
  estimated_value_numeric numeric,
  source_weight           numeric,
  source_reps             integer,
  source_logged_at        timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with candidates as (
    select wlr.value_numeric, wlr.value_reps, wl.logged_at
    from public.workout_log_results wlr
    join public.workout_logs wl on wl.log_id = wlr.log_id
    where wl.profile_id   = p_profile_id
      and wlr.movement_id = p_movement_id
      and wlr.is_rx       = true
      and wlr.metric_kind = 'weight'
      and wlr.value_numeric is not null
      and wlr.value_reps   is not null
      and wlr.value_reps   between 1 and 10
  ),
  picked as (
    select value_numeric, value_reps, logged_at
    from candidates
    -- Pick the row that yields the highest Epley estimate, not just
    -- the heaviest single. A 100kg × 5 (≈ 117kg 1RM) beats a 110kg × 1.
    order by value_numeric * (1 + value_reps / 30.0) desc, logged_at desc
    limit 1
  )
  select
    round((value_numeric * (1 + value_reps / 30.0))::numeric, 1) as estimated_value_numeric,
    value_numeric as source_weight,
    value_reps    as source_reps,
    logged_at     as source_logged_at
  from picked;
$$;

grant execute on function public.suggest_training_max(uuid, uuid) to authenticated;

-- ============================================================================
-- upsert_training_max — write helper that audits and stamps set_by.
-- ============================================================================

create or replace function public.upsert_training_max(
  p_profile_id  uuid,
  p_movement_id uuid,
  p_value       numeric,
  p_units       text default 'kg',
  p_source      public.training_max_source default 'member'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  -- Authorisation: self, or a coach/owner at one of the member's gyms.
  if v_actor <> p_profile_id then
    if not exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = p_profile_id
        and public.user_can_issue_comp_grant(gm.gym_id)
    ) then
      raise exception 'Not authorised to set training max for this member';
    end if;
  end if;

  insert into public.training_maxes (
    profile_id, movement_id, value_numeric, units, source, set_by, set_at
  ) values (
    p_profile_id, p_movement_id, p_value, p_units, p_source, v_actor, now()
  )
  on conflict (profile_id, movement_id) do update
    set value_numeric = excluded.value_numeric,
        units         = excluded.units,
        source        = excluded.source,
        set_by        = excluded.set_by,
        set_at        = excluded.set_at;

  insert into public.audit_events (
    actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    v_actor, 'member', p_profile_id, 'training_max_set',
    jsonb_build_object(
      'movement_id', p_movement_id,
      'value',       p_value,
      'units',       p_units,
      'source',      p_source::text
    )
  );
end;
$$;

grant execute on function public.upsert_training_max(uuid, uuid, numeric, text, public.training_max_source) to authenticated;
