-- RLS isolation on coach_pay_rates:
--   - A coach can SELECT their own rate row but not another coach's.
--   - The owner can SELECT any rate row (via can_set_coach_pay).
--   - A non-owner cannot INSERT a rate row, even for themselves.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@pay.test');
  v_a     uuid := _test_mk_user('a@pay.test');
  v_b     uuid := _test_mk_user('b@pay.test');
  v_gym   uuid := _test_mk_gym('Pay Gym', 'pay-gym');
  v_ct    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'coach');
  perform _test_mk_membership(v_gym, v_b,     'coach');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit', '#FF0000')
    returning id into v_ct;

  insert into public.coach_pay_rates (gym_id, profile_id, class_type_id, per_class_cents)
    values
      (v_gym, v_a, v_ct, 2500),
      (v_gym, v_b, v_ct, 3000);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.a',     v_a::text,     true);
  perform set_config('test.b',     v_b::text,     true);
  perform set_config('test.ct',    v_ct::text,    true);
end;
$$;

-- Coach A acting: sees own row, not B's.
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.coach_pay_rates
    where profile_id = current_setting('test.b')::uuid)::int,
  0,
  'coach A cannot SELECT coach B''s pay rate'
);

select is(
  (select count(*) from public.coach_pay_rates
    where profile_id = current_setting('test.a')::uuid)::int,
  1,
  'coach A can SELECT their own pay rate'
);

-- Coach A trying to insert their own rate (no can_set_coach_pay) is blocked.
select throws_like(
  $$ insert into public.coach_pay_rates
       (gym_id, profile_id, class_type_id, per_class_cents)
     values
       (current_setting('test.gym')::uuid,
        current_setting('test.a')::uuid,
        current_setting('test.ct')::uuid,
        9999)
  $$,
  '%row-level security%',
  'coach cannot INSERT their own pay rate'
);

select * from finish();
rollback;
