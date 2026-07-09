-- Parent/family dependents: a guardian adds a child (only where the gym
-- opted in), completes the child's screening on their behalf, and books the
-- child into a class; a non-guardian can do none of it.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@dep.test');
  v_parent uuid := _test_mk_user('parent@dep.test');
  v_other  uuid := _test_mk_user('other@dep.test');
  v_gym    uuid := _test_mk_gym('Dep Gym', 'depgym');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_parent, 'member');
  perform _test_mk_membership(v_gym, v_other,  'member');
  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.parent', v_parent::text, true);
  perform set_config('test.other',  v_other::text,  true);
end $$;

-- 1. create_dependent is refused until the gym opts in to minors.
do $$ begin perform _test_act_as(current_setting('test.parent')::uuid); end $$;
select throws_like(
  format('select create_dependent(%L::uuid, %L, %L::date, %L)',
    current_setting('test.gym'), 'Kid One',
    (current_date - interval '10 years')::text, '2026-07'),
  '%does not accept members under 18%',
  'create_dependent is refused until the gym opts in to minors'
);

-- Owner opts in.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform set_allow_minors(current_setting('test.gym')::uuid, true);
end $$;

-- 2/3. The parent adds a child → guardianship + a managed (loginless) profile.
do $$
declare v_kid uuid;
begin
  perform _test_act_as(current_setting('test.parent')::uuid);
  v_kid := public.create_dependent(
    current_setting('test.gym')::uuid, 'Kid One',
    (current_date - interval '10 years')::date, '2026-07');
  perform set_config('test.kid', v_kid::text, true);
end $$;

select is(
  (select count(*)::int from public.guardianships
     where dependent_profile_id = current_setting('test.kid')::uuid
       and guardian_profile_id = current_setting('test.parent')::uuid),
  1,
  'create_dependent links the child to the guardian'
);
select is(
  (select managed from public.profiles where id = current_setting('test.kid')::uuid),
  true,
  'the dependent profile is managed (loginless)'
);

-- 4. A non-guardian is not the child's guardian.
do $$ begin perform _test_act_as(current_setting('test.other')::uuid); end $$;
select is(
  public.is_guardian_of(current_setting('test.kid')::uuid),
  false,
  'a non-guardian is not the guardian of the child'
);

-- 5. The guardian signs the active waiver on the child's behalf.
do $$
declare v_w uuid;
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  v_w := public.publish_waiver(current_setting('test.gym')::uuid, 'Waiver',
    current_setting('test.gym') || '/w.pdf', 'https://example.com/w.pdf');
  perform _test_act_as(current_setting('test.parent')::uuid);
  perform public.sign_waiver(current_setting('test.gym')::uuid, v_w,
    '{"paths":["M0 0 L1 1"],"width":10,"height":10}'::jsonb,
    current_setting('test.kid')::uuid);
end $$;
select is(
  (select count(*)::int from public.waiver_signatures
     where profile_id = current_setting('test.kid')::uuid),
  1,
  'a guardian can sign the waiver for their child'
);

-- 6. The guardian books the child into a class (past the waiver gate).
do $$
declare v_sess uuid;
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  v_sess := _test_mk_session(current_setting('test.gym')::uuid,
    current_setting('test.owner')::uuid, now() + interval '2 days');
  perform set_config('test.sess', v_sess::text, true);
  perform _test_act_as(current_setting('test.parent')::uuid);
  perform public.parent_book_dependent(
    current_setting('test.sess')::uuid, current_setting('test.kid')::uuid);
end $$;
select is(
  (select count(*)::int from public.class_bookings
     where session_id = current_setting('test.sess')::uuid
       and profile_id = current_setting('test.kid')::uuid),
  1,
  'a guardian books their child into a class'
);

select * from finish();
rollback;
