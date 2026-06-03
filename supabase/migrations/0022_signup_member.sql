-- Phase 1 / Track B: signup_member RPC.
--
-- Records the DB side of a member signup. The wrapping edge function
-- (signup-member) is responsible for the Stripe Customer + Subscription
-- creation; this RPC takes the resulting IDs and writes:
--
--   stripe_customers (upsert)
--   plan_subscriptions (insert at pending or scheduled)
--   audit_events       (one row capturing the signup)
--
-- starts_at semantics:
--   NULL or now()       → status 'pending' (SCA in flight; webhook
--                         flips to active on invoice.paid)
--   future timestamptz  → status 'scheduled' (cron + webhook both
--                         backstop activation at trial_end)
--
-- Auth model: a member may sign themselves up at a gym they already
-- belong to (gym_memberships row exists). Staff may sign someone
-- else up via user_can_assign_plan. The gym_memberships precondition
-- mirrors comp_grants — no orphan subs.

create or replace function public.signup_member(
  p_gym_id                uuid,
  p_profile_id            uuid,
  p_plan_id               uuid,
  p_stripe_customer_id    text,
  p_stripe_subscription_id text,
  p_billing_interval      interval,
  p_paid_period_end       timestamptz,
  p_starts_at             timestamptz default null
) returns table (
  plan_subscription_id uuid,
  status               public.plan_sub_state
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor             uuid := auth.uid();
  v_membership_id     uuid;
  v_target_profile    uuid := coalesce(p_profile_id, v_actor);
  v_status            public.plan_sub_state;
  v_sub_id            uuid;
  v_credit_count      integer;
  v_period_length     interval;
begin
  if v_actor is null then
    raise exception 'Not signed in';
  end if;

  -- Authorisation: self or staff with assign-plan capability.
  if v_target_profile <> v_actor
     and not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised to sign up this member';
  end if;

  -- Resolve the gym_memberships row; it must already exist.
  select id into v_membership_id
  from public.gym_memberships
  where gym_id = p_gym_id and profile_id = v_target_profile;

  if v_membership_id is null then
    raise exception
      'No gym_membership for profile % at gym %',
      v_target_profile, p_gym_id;
  end if;

  -- Resolve initial state. Future-dated → scheduled; otherwise pending.
  if p_starts_at is not null and p_starts_at > now() then
    v_status := 'scheduled';
  else
    v_status := 'pending';
  end if;

  -- Seed credit_balance from the plan so eligibility predicates work
  -- the moment the sub flips to active (no off-by-one race where the
  -- first invoice.paid arrives and the member can't book until the
  -- next refill).
  select credit_count, period_length
    into v_credit_count, v_period_length
  from public.membership_plans
  where plan_id = p_plan_id;

  -- Upsert the Stripe Customer mirror. Idempotent on (gym_id, profile_id);
  -- a member rejoining the same gym keeps the same row.
  insert into public.stripe_customers (gym_id, profile_id, customer_id, last_synced_at)
  values (p_gym_id, v_target_profile, p_stripe_customer_id, now())
  on conflict (gym_id, profile_id) do update
    set customer_id    = excluded.customer_id,
        last_synced_at = excluded.last_synced_at;

  -- Insert the plan subscription.
  insert into public.plan_subscriptions (
    gym_membership_id, profile_id, gym_id, plan_id,
    status, credit_balance, period_resets_at, paid_period_end,
    stripe_subscription_id, billing_interval
  ) values (
    v_membership_id, v_target_profile, p_gym_id, p_plan_id,
    v_status,
    v_credit_count,
    case
      when v_period_length is not null and p_paid_period_end is not null
        then p_paid_period_end - v_period_length + v_period_length
      when v_period_length is not null
        then coalesce(p_starts_at, now()) + v_period_length
      else null
    end,
    p_paid_period_end,
    p_stripe_subscription_id,
    p_billing_interval
  )
  returning id into v_sub_id;

  insert into public.audit_events (
    gym_id, actor_profile_id, subject_kind, subject_id, kind, payload
  ) values (
    p_gym_id,
    v_actor,
    'plan_subscription',
    v_sub_id,
    case v_status
      when 'scheduled' then 'plan_sub_scheduled'
      when 'pending'   then 'plan_sub_pending'
    end,
    jsonb_build_object(
      'plan_id',         p_plan_id,
      'starts_at',       p_starts_at,
      'self_signup',     v_target_profile = v_actor,
      'stripe_sub_id',   p_stripe_subscription_id
    )
  );

  return query select v_sub_id, v_status;
end;
$$;

grant execute on function public.signup_member(uuid, uuid, uuid, text, text, interval, timestamptz, timestamptz) to authenticated;
