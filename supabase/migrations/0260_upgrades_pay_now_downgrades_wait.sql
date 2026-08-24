-- Upgrades pay now, downgrades wait for the renewal.
--
-- The owner decision behind this: a member who upgrades mid-cycle should be
-- charged the pro-rated difference immediately (they get the better plan
-- today, so they pay for the slice of the period they'll use it), while a
-- downgrade must not take anything away mid-cycle — it waits for the next
-- renewal, and where the plan being left carries a notice period, for the
-- first renewal after that notice has run. Until now both directions were an
-- immediate price swap with no proration, which undercharged upgrades and
-- broke "you keep what you paid for" on downgrades.
--
-- The Stripe side of an upgrade (proration_behavior=always_invoice) lives in
-- the stripe-modify-subscription edge function. This migration is the
-- deferred half: a scheduled change is three columns on the subscription
-- row, applied by the apply-plan-changes edge worker shortly BEFORE the
-- renewal it lands on — the swap must precede Stripe's invoice creation or
-- the renewal bills the old price. There is no month arithmetic anywhere:
-- the sweep applies a change only when the row's own paid_period_end has
-- moved past pending_change_not_before, and paid_period_end is maintained
-- by the invoice.paid webhook — so "the first renewal after the notice"
-- falls out of data we already keep, not out of date math that could drift
-- from Stripe's billing anchor.

begin;

-- ============================================================================
-- 1. The scheduled change, on the subscription itself.
-- ============================================================================

alter table public.plan_subscriptions
  add column if not exists pending_plan_id uuid
    references public.membership_plans(plan_id),
  add column if not exists pending_change_not_before timestamptz,
  add column if not exists pending_change_requested_at timestamptz;

comment on column public.plan_subscriptions.pending_plan_id is
  'Scheduled downgrade target. Applied by the apply-plan-changes worker at '
  'the first renewal on or after pending_change_not_before; null = nothing '
  'scheduled. Written only by the stripe-modify-subscription function '
  '(service role) and cleared by cancel_pending_plan_change or the worker.';

-- ============================================================================
-- 2. Cancelling a scheduled change — the member's own, or staff for anyone.
-- ============================================================================

create or replace function public.cancel_pending_plan_change(
  p_plan_subscription_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.plan_subscriptions%rowtype;
begin
  select * into v_row
    from public.plan_subscriptions
    where id = p_plan_subscription_id;
  if not found then
    raise exception 'Subscription not found';
  end if;
  if v_row.profile_id <> auth.uid()
     and not public.user_can_assign_plan(v_row.gym_id) then
    raise exception 'Not allowed';
  end if;
  if v_row.pending_plan_id is null then
    raise exception 'No plan change is scheduled';
  end if;
  update public.plan_subscriptions
     set pending_plan_id             = null,
         pending_change_not_before   = null,
         pending_change_requested_at = null
   where id = p_plan_subscription_id;
end;
$$;
grant execute on function public.cancel_pending_plan_change(uuid) to authenticated;

-- ============================================================================
-- 3. The sweep. Counts what is due and pokes the worker, on the same
--    secret + gateway + cron_run_log shape as the other dispatchers.
--    Due = an active subscription whose renewal is inside the lead window
--    and past its notice gate. The 45-minute lead against a 15-minute
--    cadence means a change is applied 30–45 minutes before Stripe
--    invoices the renewal.
-- ============================================================================

create or replace function public.dispatch_plan_changes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due     integer;
  v_posted  boolean := false;
  v_started timestamptz := clock_timestamp();
  v_secret  text := public._worker_shared_secret();
  v_gateway text := public._worker_gateway_key();
begin
  select count(*)::int into v_due
    from public.plan_subscriptions ps
    where ps.pending_plan_id is not null
      and ps.status = 'active'
      and ps.stripe_subscription_id is not null
      and ps.paid_period_end is not null
      and ps.paid_period_end <= now() + interval '45 minutes'
      and (ps.pending_change_not_before is null
           or ps.paid_period_end >= ps.pending_change_not_before);

  if v_due > 0 and v_secret is not null and v_gateway is not null then
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/apply-plan-changes',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', v_gateway,
          'x-automation-secret', v_secret),
        body := jsonb_build_object('due', v_due));
      v_posted := true;
    exception when others then
      null;
    end;
  end if;

  perform public._log_cron_run('dispatch-plan-changes',
    jsonb_build_object('due', v_due, 'posted', v_posted,
                       'has_secret', v_secret is not null and v_gateway is not null),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_due;
end;
$$;
revoke execute on function public.dispatch_plan_changes()
  from public, anon, authenticated;

select cron.schedule(
  'dispatch-plan-changes',
  '*/15 * * * *',
  $$select public.dispatch_plan_changes();$$
);

commit;
