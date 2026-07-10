-- Retention cockpit, Phase 1c — a standing win-back segment.
--
-- v_member_cohort filters role='member' and is "today"-shaped, so it can't
-- express two reactivation audiences the cockpit needs:
--   - lapsed      — a member who left (gym_memberships.left_at is not null)
--   - never_activated — an imported/invited person who never signed up
--                       (pending_members still pending/invited, not linked)
--
-- One row per candidate, tagged by kind, with a last_seen_at where we have
-- one (the leave date for lapsed; null for never-activated). Booking/billing
-- history is intentionally out of scope here — this is the "who to reach for
-- reactivation" list, scored/enriched by the caller.
--
-- security_invoker so the underlying gym_memberships / pending_members
-- tenant RLS applies; both are already staff-readable.

create or replace view public.v_winback_candidates
with (security_invoker = on)
as
select
  gm.gym_id,
  'lapsed'::text            as kind,
  gm.profile_id             as member_id,
  null::uuid                as pending_member_id,
  p.full_name               as full_name,
  gm.left_at                as last_seen_at
from public.gym_memberships gm
join public.profiles p on p.id = gm.profile_id
where gm.role = 'member'
  and gm.left_at is not null
union all
select
  pm.gym_id,
  'never_activated'::text   as kind,
  null::uuid                as member_id,
  pm.id                     as pending_member_id,
  pm.full_name              as full_name,
  null::timestamptz         as last_seen_at
from public.pending_members pm
where pm.status in ('pending', 'invited');

grant select on public.v_winback_candidates to authenticated;
