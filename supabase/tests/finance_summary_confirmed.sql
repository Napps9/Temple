-- Confirmed revenue is settled billing_events inside the calendar month,
-- grouped by the currency they arrived in. Refunds are recorded but never
-- netted off.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@finconf.test');
  v_gym   uuid := _test_mk_gym('Fin Confirmed', 'finconf');
  v_start date := date_trunc('month', current_date)::date;
  v_end   date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  -- Helper-free inserts: billing_events is service-role-only by RLS, and
  -- this block still runs unswitched.
  insert into public.billing_events
    (provider, provider_event_id, provider_account_id, gym_id, member_id,
     kind, amount_cents, currency, occurred_at, payload)
  values
    -- Inside the month, two kinds the webhook really writes.
    ('stripe', 'evt_in_1', 'acct_1', v_gym, v_owner, 'checkout', 5000, 'GBP',
     v_start::timestamptz + interval '9 hours', '{}'::jsonb),
    ('stripe', 'evt_in_2', 'acct_1', v_gym, v_owner, 'invoice', 2500, 'GBP',
     v_end::timestamptz + interval '9 hours', '{}'::jsonb),
    -- A store sale in the same month: same total, not a separate one.
    ('stripe', 'evt_in_3', 'acct_1', v_gym, v_owner, 'store_order', 1000, 'GBP',
     v_start::timestamptz + interval '2 days', '{}'::jsonb),
    -- A refund inside the month must not reduce the total.
    ('stripe', 'evt_ref', 'acct_1', v_gym, v_owner, 'refund', -3000, 'GBP',
     v_start::timestamptz + interval '3 days', '{}'::jsonb),
    -- Either side of the month.
    ('stripe', 'evt_before', 'acct_1', v_gym, v_owner, 'invoice', 9999, 'GBP',
     v_start::timestamptz - interval '1 second', '{}'::jsonb),
    ('stripe', 'evt_after', 'acct_1', v_gym, v_owner, 'invoice', 8888, 'GBP',
     (v_end + 1)::timestamptz, '{}'::jsonb),
    -- A second currency in the same month gets its own row.
    ('stripe', 'evt_eur', 'acct_1', v_gym, v_owner, 'invoice', 4000, 'EUR',
     v_start::timestamptz + interval '4 days', '{}'::jsonb);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.start', v_start::text, true);
  perform _test_act_as(v_owner);
end;
$$;

select is(
  (select confirmed_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)
   where currency = 'GBP'),
  8500::bigint,
  'sums the settled events inside the month (5000 + 2500 + 1000)'
);

select is(
  (select confirmed_count from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)
   where currency = 'GBP'),
  3,
  'counts them, refund excluded'
);

select is(
  (select confirmed_cents from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)
   where currency = 'EUR'),
  4000::bigint,
  'a second currency gets its own row rather than being folded in'
);

select is(
  (select count(*)::int from public.compute_finance_summary(
     current_setting('test.gym')::uuid, current_setting('test.start')::date)),
  2,
  'one row per currency, and no row invented for the months either side'
);

select * from finish();
rollback;
