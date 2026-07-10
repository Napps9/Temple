-- Retention cockpit, Phase 1b — a per-member attendance/engagement signal.
--
-- Attendance is captured (class_bookings.attended_at, indexed on
-- (gym_id, attended_at)) but never derived per member: src/lib/attendance.ts
-- aggregates gym-wide only. The at-risk list needs each member's own cadence
-- vs their own baseline, so a member drifting away from *their* normal shows
-- up even if they were never a high-frequency attendee.
--
-- One row per (gym_id, profile_id) that has ever attended:
--   last_attended_at  — most recent attended session (its scheduled start)
--   bookings_28d      — attended sessions in the last 28 days
--   bookings_prev_28d — attended sessions in the 28 days before that
--   baseline_weekly   — average attended sessions/week over the trailing
--                       ~10 weeks that EXCLUDE the most recent fortnight, so
--                       a current dip doesn't drag its own baseline down.
--                       NULL when there's no history in that window.
--   cadence_ratio     — recent weekly rate (bookings_28d / 4) over baseline.
--                       NULL when baseline is NULL — a member with no
--                       baseline has "no signal", never "decayed".
--
-- security_invoker so the existing class_bookings tenant-select RLS applies;
-- attendance is already staff-visible, so no new access is granted.
-- A member who has never attended has no row here — the retention scorer
-- LEFT JOINs and treats a missing row as "never attended", not "decayed".

create or replace view public.v_member_attendance_signal
with (security_invoker = on)
as
with attended as (
  select
    cb.gym_id,
    cb.profile_id,
    cs.starts_at
  from public.class_bookings cb
  join public.class_sessions cs on cs.id = cb.class_session_id
  where cb.attended_at is not null
),
counts as (
  select
    gym_id,
    profile_id,
    max(starts_at) as last_attended_at,
    count(*) filter (
      where starts_at >= now() - interval '28 days' and starts_at < now()
    ) as bookings_28d,
    count(*) filter (
      where starts_at >= now() - interval '56 days' and starts_at < now() - interval '28 days'
    ) as bookings_prev_28d,
    -- Baseline window: days 14..84 back (~10 weeks), excluding the recent
    -- fortnight so a current dip doesn't lower its own baseline.
    count(*) filter (
      where starts_at >= now() - interval '84 days' and starts_at < now() - interval '14 days'
    ) as baseline_count
  from attended
  group by gym_id, profile_id
)
select
  gym_id,
  profile_id,
  last_attended_at,
  bookings_28d,
  bookings_prev_28d,
  case when baseline_count = 0 then null
       else round(baseline_count::numeric / 10.0, 3) end as baseline_weekly,
  case when baseline_count = 0 then null
       else round((bookings_28d::numeric / 4.0) / (baseline_count::numeric / 10.0), 3)
  end as cadence_ratio
from counts;

grant select on public.v_member_attendance_signal to authenticated;
