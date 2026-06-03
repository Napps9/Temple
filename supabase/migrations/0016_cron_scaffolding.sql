-- Phase 1 / Track A: pg_cron scaffolding + state-advance jobs.
--
-- Foundational infrastructure. Lands in sprint 1 so dependent tracks
-- (E's PR / prediction MV refresh, G's reporting view refresh) have
-- a refresher available without waiting on Track B.
--
-- The state-advance jobs operate on tables that exist after Phase 0 +
-- 0012–0015. Per-track jobs (MV refresh, downgrade re-eligibility,
-- etc.) are registered in their own migrations against the same
-- pg_cron instance.

create extension if not exists pg_cron;

-- ============================================================================
-- 1. cron_advance_subscription_states
--    Hourly. Walks plan_subscriptions and applies the clock-driven
--    transitions documented in docs/entitlement-states.md.
--
--    Webhook-driven transitions (pending → active, active → lapsed)
--    are NOT here — the Stripe webhook is the only writer of those.
--    scheduled → pending is here as a BACKSTOP only; the webhook
--    handler on invoice.paid activates straight from scheduled or
--    pending so the trial-end charge doesn't race the clock.
-- ============================================================================

create or replace function public.cron_advance_subscription_states()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- cancelled_at_period_end → cancelled when paid_period_end passes
  update public.plan_subscriptions
  set status = 'cancelled'
  where status = 'cancelled_at_period_end'
    and paid_period_end is not null
    and paid_period_end <= now();

  -- refunded_retained → cancelled when paid_period_end passes
  update public.plan_subscriptions
  set status = 'cancelled'
  where status = 'refunded_retained'
    and paid_period_end is not null
    and paid_period_end <= now();

  -- scheduled → pending at starts_at (BACKSTOP; webhook is primary)
  update public.plan_subscriptions
  set status = 'pending'
  where status = 'scheduled'
    and starts_at is not null
    and starts_at <= now();

  -- pending → lapsed past the SCA-abandon window (7 days).
  -- Future-dated subs spend the window before starts_at as 'scheduled',
  -- not 'pending', so this only catches genuinely abandoned signups.
  update public.plan_subscriptions
  set status = 'lapsed'
  where status = 'pending'
    and created_at < now() - interval '7 days';
end;
$$;

-- ============================================================================
-- 2. cron_refill_credit_balances
--    Hourly. Refills credit_balance when period_resets_at has passed.
--
--    Dunning gate: only refill subs that are active AND
--    paid-current (paid_period_end >= now() OR null). Past-due,
--    paused, cancelled, lapsed, refunded_retained do NOT refill —
--    honours §3.2's no-refill-during-dunning invariant.
-- ============================================================================

create or replace function public.cron_refill_credit_balances()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.plan_subscriptions ps
  set
    credit_balance   = mp.credit_count,
    period_resets_at = ps.period_resets_at + mp.period_length
  from public.membership_plans mp
  where mp.plan_id = ps.plan_id
    and ps.status = 'active'
    and (ps.paid_period_end is null or ps.paid_period_end >= now())
    and ps.period_resets_at is not null
    and ps.period_resets_at <= now()
    and mp.period_length is not null;
end;
$$;

-- ============================================================================
-- 3. Schedule the jobs hourly. cron.schedule with the same name is
--    idempotent — re-running this migration replaces, not duplicates.
-- ============================================================================

select cron.schedule(
  'temple_advance_subscription_states',
  '0 * * * *',
  $$select public.cron_advance_subscription_states();$$
);

select cron.schedule(
  'temple_refill_credit_balances',
  '5 * * * *',
  $$select public.cron_refill_credit_balances();$$
);
