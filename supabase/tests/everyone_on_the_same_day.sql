-- 0274: the billing anchor. Null keeps today's behaviour; the day is
-- clamped to one that exists every month; the next anchor is strictly
-- ahead; and the part-month is measured against a real period.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@anchor.test');
  v_mem   uuid := _test_mk_user('mem@anchor.test');
  v_gym   uuid := _test_mk_gym('Anchor Gym', 'anchor-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_mem, 'member');
  update public.gyms set timezone = 'Europe/London' where id = v_gym;
  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.owner', v_owner::text, false);
  perform set_config('test.mem', v_mem::text, false);
end $$;

-- 1. Null is the default, and null means "nothing changes".
select is(
  (select billing_anchor_day from public.gyms
    where id = current_setting('test.gym')::uuid),
  null,
  'a gym starts with no common billing date'
);
select is(
  (select count(*)::int from public.gym_billing_anchor(
     current_setting('test.gym')::uuid, 8900)),
  0,
  'and the anchor function answers with nothing rather than a date'
);

-- 3-4. Only an owner sets it, and only to a day every month has.
select _test_act_as(current_setting('test.mem')::uuid);
select throws_ok(
  format('select public.set_gym_billing_anchor(%L, 1::smallint)',
         current_setting('test.gym')),
  'Only an owner can change the billing date',
  'a member cannot move the gym onto a common date'
);

select _test_act_as(current_setting('test.owner')::uuid);
select throws_ok(
  format('select public.set_gym_billing_anchor(%L, 31::smallint)',
         current_setting('test.gym')),
  'Pick a day between 1 and 28 — later days do not exist every month',
  'the 31st is refused rather than quietly clamped'
);

-- 5-7. Set to the 1st: the next anchor is ahead, and it is the 1st.
select lives_ok(
  format('select public.set_gym_billing_anchor(%L, 1::smallint)',
         current_setting('test.gym')),
  'an owner picks the 1st'
);
select ok(
  (select anchor_at > now() from public.gym_billing_anchor(
     current_setting('test.gym')::uuid, 8900)),
  'the next anchor is strictly ahead — never a zero-length first period'
);
select is(
  (select extract(day from (anchor_at at time zone 'Europe/London'))::int
     from public.gym_billing_anchor(current_setting('test.gym')::uuid, 8900)),
  1,
  'and it falls on the day the owner picked, in the gym''s own timezone'
);

-- 8-9. The part-month is a fraction of the price, never more than it.
select ok(
  (select prorated_cents between 0 and 8900
     from public.gym_billing_anchor(current_setting('test.gym')::uuid, 8900)),
  'the part-month never exceeds a full month'
);
select is(
  (select prorated_cents from public.gym_billing_anchor(
     current_setting('test.gym')::uuid, 0)),
  0,
  'a free plan prorates to nothing rather than dividing by a price of zero'
);

select * from finish();
rollback;
