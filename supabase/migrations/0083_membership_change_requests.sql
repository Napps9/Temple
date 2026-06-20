-- Membership change requests + per-gym change policies.
--
-- Members don't cancel or downgrade their membership directly — they file
-- a request that staff (can_assign_plan) authorise. Upgrades to a pricier
-- plan can be self-serve. Each gym configures the rule per change type.
-- Credit packs and individual class purchases are one-off and untouched.
--
-- This migration is the data + policy foundation. The Stripe execution
-- (cancel at period end, or switch the subscription price with NO
-- proration) lives in the stripe-modify-subscription edge function; the
-- member request UI and the staff approval queue consume what's defined
-- here. Decisions are applied by that edge function under the service
-- role, so the Stripe change and the row update stay atomic — there is
-- deliberately no staff write policy on the requests table.

begin;

-- ============================================================================
-- 1. Per-gym policy: self-serve vs needs-approval, per change direction.
-- ============================================================================
create type public.membership_change_policy as enum ('self_serve', 'request');

alter table public.gyms
  add column if not exists membership_upgrade_policy
    public.membership_change_policy not null default 'self_serve',
  add column if not exists membership_downgrade_policy
    public.membership_change_policy not null default 'request',
  add column if not exists membership_cancel_policy
    public.membership_change_policy not null default 'request';

-- Owner-only: set all three policies at once.
create or replace function public.set_membership_change_policies(
  p_gym_id    uuid,
  p_upgrade   public.membership_change_policy,
  p_downgrade public.membership_change_policy,
  p_cancel    public.membership_change_policy
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change membership policies';
  end if;
  update public.gyms
    set membership_upgrade_policy   = p_upgrade,
        membership_downgrade_policy = p_downgrade,
        membership_cancel_policy    = p_cancel
    where id = p_gym_id;
end;
$$;
grant execute on function public.set_membership_change_policies(
  uuid,
  public.membership_change_policy,
  public.membership_change_policy,
  public.membership_change_policy
) to authenticated;

-- ============================================================================
-- 2. The requests themselves.
-- ============================================================================
create type public.membership_change_kind as enum ('cancel', 'switch_plan');
create type public.membership_change_status as enum
  ('pending', 'approved', 'rejected', 'withdrawn');

create table public.membership_change_requests (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  profile_id           uuid not null references public.profiles(id) on delete cascade,
  plan_subscription_id uuid not null
    references public.plan_subscriptions(id) on delete cascade,
  kind                 public.membership_change_kind not null,
  target_plan_id       uuid references public.membership_plans(plan_id),
  status               public.membership_change_status not null default 'pending',
  member_note          text,
  staff_note           text,
  decided_by           uuid references public.profiles(id),
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  -- a switch targets a plan; a cancel does not
  constraint membership_change_target_shape
    check ((kind = 'switch_plan') = (target_plan_id is not null))
);

-- One open request per subscription — no stacking.
create unique index membership_change_requests_one_pending
  on public.membership_change_requests(plan_subscription_id)
  where status = 'pending';
create index membership_change_requests_gym_pending_idx
  on public.membership_change_requests(gym_id)
  where status = 'pending';
create index membership_change_requests_member_idx
  on public.membership_change_requests(profile_id);

alter table public.membership_change_requests enable row level security;

-- Member: see + file + withdraw their own; only for their own subscription.
create policy mcr_self_select on public.membership_change_requests
  for select using (profile_id = auth.uid());

create policy mcr_self_insert on public.membership_change_requests
  for insert with check (
    profile_id = auth.uid()
    and status = 'pending'
    and decided_by is null
    and exists (
      select 1 from public.plan_subscriptions ps
      where ps.id = plan_subscription_id
        and ps.profile_id = auth.uid()
        and ps.gym_id = gym_id
    )
  );

create policy mcr_self_withdraw on public.membership_change_requests
  for update using (profile_id = auth.uid() and status = 'pending')
  with check (profile_id = auth.uid() and status = 'withdrawn');

-- Staff who can assign plans read the queue. Decisions are applied by the
-- stripe-modify-subscription edge function (service role).
create policy mcr_staff_select on public.membership_change_requests
  for select using (public.user_can_assign_plan(gym_id));

commit;
