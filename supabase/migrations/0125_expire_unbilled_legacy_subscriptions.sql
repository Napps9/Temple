-- An imported legacy plan_subscription (0124: no adopted Stripe
-- subscription, imported_legacy = true) never receives a Stripe webhook,
-- because there's no Stripe subscription object behind it to fail a charge
-- or get cancelled -- every active -> lapsed/cancelled transition in
-- stripe-webhook is keyed off stripe_subscription_id matching a real event.
-- So a member who never adds a payment method stays status = 'active'
-- forever, which means they keep passing require_membership_to_book (and
-- every other eligibility check) indefinitely, even long after their
-- carried-over renewal date (paid_period_end) has come and gone.
--
-- This sweep is the missing half: once paid_period_end passes on an
-- unlimited/credit_period legacy row that still has no payment method,
-- flip it to 'lapsed' -- the same terminal-for-booking state a real failed
-- renewal lands in (docs/entitlement-states.md). is_booking_eligible,
-- list_booking_entitlements and _book_class_for's require_membership_to_book
-- gate all already deny 'lapsed', so no change is needed there.
--
-- credit_pack is excluded: a one-off pack has no "renewal" to miss (the
-- same reasoning src/app/(member)/membership.tsx's needsBilling already
-- uses to hide the "add payment method" prompt for packs), and its own
-- credit_balance running out already blocks booking.

create or replace function public.expire_unbilled_legacy_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.plan_subscriptions ps
      set status = 'lapsed'
    from public.membership_plans mp
    where mp.plan_id = ps.plan_id
      and ps.imported_legacy
      and ps.status = 'active'
      and mp.kind <> 'credit_pack'
      and ps.paid_period_end is not null
      and ps.paid_period_end < now()
    returning ps.id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

grant execute on function public.expire_unbilled_legacy_subscriptions() to authenticated;

create extension if not exists pg_cron with schema pg_catalog;

-- cron.schedule upserts by job name, so re-running this migration replaces
-- the job rather than duplicating it.
select cron.schedule(
  'expire-unbilled-legacy-subscriptions',
  '30 3 * * *', -- daily at 03:30 UTC, off-peak, distinct from the 03:00 health-data purge
  $$select public.expire_unbilled_legacy_subscriptions();$$
);
