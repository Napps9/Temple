-- delete_class_type and delete_plan refuse to drop a row that's still
-- referenced anywhere. Hard delete is reserved for empty rows; archive
-- is the affordance for anything with history.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@harddel.test');
  v_gym   uuid := _test_mk_gym('Hard Del', 'harddel');
  v_ct_with_session uuid;
  v_ct_empty        uuid;
  v_plan_with_sub   uuid;
  v_plan_empty      uuid;
  v_member uuid := _test_mk_user('m@harddel.test');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT with session', '#2563EB')
    returning id into v_ct_with_session;
  insert into public.class_types (gym_id, name, color)
    values (v_gym, 'CT empty', '#10B981')
    returning id into v_ct_empty;
  perform _test_mk_session(v_gym, v_owner, now() + interval '2 days', 60, v_ct_with_session);

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'With sub', 'unlimited')
    returning plan_id into v_plan_with_sub;
  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Empty', 'unlimited')
    returning plan_id into v_plan_empty;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  select id, v_member, v_gym, v_plan_with_sub, 'active'::public.plan_sub_state
    from public.gym_memberships
    where gym_id = v_gym and profile_id = v_member;

  perform set_config('test.ct_with', v_ct_with_session::text, true);
  perform set_config('test.ct_empty', v_ct_empty::text,       true);
  perform set_config('test.plan_with', v_plan_with_sub::text, true);
  perform set_config('test.plan_empty', v_plan_empty::text,   true);

  perform _test_act_as(v_owner);
end;
$$;

select throws_ok(
  $$ select public.delete_class_type(current_setting('test.ct_with')::uuid) $$,
  'P0001',
  'Cannot delete: class type still has sessions, recurrences, programming or plan allowlist entries. Archive instead.',
  'delete_class_type raises when sessions exist'
);

select lives_ok(
  $$ select public.delete_class_type(current_setting('test.ct_empty')::uuid) $$,
  'delete_class_type succeeds for an empty class type'
);

select throws_ok(
  $$ select public.delete_plan(current_setting('test.plan_with')::uuid) $$,
  'P0001',
  'Cannot delete: plan still has subscriptions. Archive instead.',
  'delete_plan raises when subscriptions exist'
);

select lives_ok(
  $$ select public.delete_plan(current_setting('test.plan_empty')::uuid) $$,
  'delete_plan succeeds for an empty plan'
);

select * from finish();
rollback;
