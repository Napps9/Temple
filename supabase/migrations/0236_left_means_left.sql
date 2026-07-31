-- 0236: Left means left
--
-- `effective_can` has required `left_at is null` since it was written, and
-- 0223 fixed `user_can_admin` when it turned out an admin who left in
-- March could still remove members in July. The other raw role helpers
-- were never done. Five of them still have no guard at all, and between
-- them they back twenty-one live RLS policies.
--
-- Verified rather than reasoned about: a coach whose membership was closed
-- 120 days ago returns TRUE from user_can_manage_classes,
-- user_can_admin_or_coach, user_can_cover and user_can_access_staff_area,
-- while user_can_admin and effective_can both correctly return false.
--
-- WHAT THAT LETS A DEPARTED COACH DO TODAY:
--
--   write   class_types, class_recurrences and class_sessions — insert,
--           update AND delete. Somebody let go on Friday can delete the
--           gym's entire timetable on Saturday.
--   write   class_bookings delete: cancel any member's booking.
--   read    plan_subscriptions and membership_change_requests — who is on
--           what plan and what they pay — plus comp_grants, cover
--           requests, coach tasks, the waitlist, SOPs and onboarding
--           responses.
--
-- The fix is one line per helper, the same line 0223 added. Nothing else
-- about them moves: the roles each accepts are unchanged, so no current
-- member's access changes. The `self` branches of the `self_or_staff`
-- policies are OR'd against `profile_id = auth.uid()` independently, so
-- tightening the staff half cannot lock anybody out of their own row.
--
-- DELIBERATELY NOT IN THIS MIGRATION: user_belongs_to, which backs 29
-- policies including the tracked_* tables — a member's own workout
-- history, PRs and race splits. Whether somebody who leaves a gym keeps
-- reading their own training record is a product decision with a GDPR
-- edge, not a permission bug, and it should be answered on purpose rather
-- than as a side effect of this. It is on the roadmap's open list.

begin;

create or replace function public.user_can_access_staff_area(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role in ('owner', 'admin', 'coach', 'staff')
  );
$$;

create or replace function public.user_can_admin_or_coach(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role in ('owner', 'admin', 'coach')
  );
$$;

create or replace function public.user_can_assign_plan(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role in ('owner', 'admin', 'coach', 'staff')
  );
$$;

create or replace function public.user_can_cover(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Owner + coach only. Admin excluded by design: admins don't coach.
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role in ('owner', 'coach')
  );
$$;

create or replace function public.user_can_manage_classes(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role in ('owner', 'admin', 'coach')
  );
$$;

-- Currently backs no policy at all — 0211 moved grant_member_comp onto
-- effective_can and the policy that used this went with it. Guarded anyway
-- rather than dropped: it is a loaded gun on the shelf, and the next
-- policy to reach for a comp-grant predicate should find a safe one. The
-- pgTAP family check is what caught this being missed from the first draft
-- of this migration, which is the whole argument for keying that check on
-- the name instead of on a list.
create or replace function public.user_can_issue_comp_grant(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role in ('owner', 'coach')
  );
$$;

-- The one that is not an RLS policy but a gate on every owner-only RPC:
-- switching a job on, setting branding, minting an invite. A gym always
-- keeps at least one owner (0223), so an owner with a closed membership
-- has already been replaced and should not still be configuring the gym
-- they left.
create or replace function public.user_is_owner_of(target_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gym_memberships
    where gym_id = target_gym_id
      and profile_id = auth.uid()
      and left_at is null
      and role = 'owner'
  );
$$;

commit;
