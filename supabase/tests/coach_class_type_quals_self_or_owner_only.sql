-- RLS isolation on coach_class_type_qualifications, mirroring
-- coach_pay_rates_self_or_owner_only.sql:
--   - A coach can SELECT their own qualification row but not another coach's.
--   - The owner (via can_set_coach_pay) can SELECT any row.
--   - A non-owner cannot INSERT a qualification row, even for themselves.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@quals.test');
  v_a     uuid := _test_mk_user('a@quals.test');
  v_b     uuid := _test_mk_user('b@quals.test');
  v_gym   uuid := _test_mk_gym('Quals Gym', 'quals-gym');
  v_ct    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'coach');
  perform _test_mk_membership(v_gym, v_b,     'coach');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CrossFit Kids', '#FF8800')
    returning id into v_ct;

  insert into public.coach_class_type_qualifications
    (gym_id, profile_id, class_type_id, qualified)
    values
      (v_gym, v_a, v_ct, false),
      (v_gym, v_b, v_ct, false);

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
  (select count(*) from public.coach_class_type_qualifications
    where profile_id = current_setting('test.b')::uuid)::int,
  0,
  'coach A cannot SELECT coach B''s qualification row'
);

select is(
  (select count(*) from public.coach_class_type_qualifications
    where profile_id = current_setting('test.a')::uuid)::int,
  1,
  'coach A can SELECT their own qualification row'
);

-- Coach A trying to insert their own qualification (no can_set_coach_pay) is blocked.
select throws_like(
  $$ insert into public.coach_class_type_qualifications
       (gym_id, profile_id, class_type_id, qualified)
     values
       (current_setting('test.gym')::uuid,
        current_setting('test.a')::uuid,
        current_setting('test.ct')::uuid,
        true)
  $$,
  '%row-level security%',
  'coach cannot INSERT their own qualification row'
);

select * from finish();
rollback;
