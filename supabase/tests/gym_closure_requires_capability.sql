-- Closing the gym is owner/admin only. A coach can cancel a class
-- (can_edit_classes) but cannot wipe a fortnight for everyone.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@closecap.test');
  v_coach uuid := _test_mk_user('coach@closecap.test');
  v_admin uuid := _test_mk_user('admin@closecap.test');
  v_gym   uuid := _test_mk_gym('Cap Gym', 'closecap');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_admin, 'admin');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.admin', v_admin::text, true);
end;
$$;

select is(
  public.default_capability('coach'::public.gym_role, 'can_bulk_edit_classes'),
  false,
  'a coach does not get can_bulk_edit_classes by default'
);

select is(
  public.default_capability('admin'::public.gym_role, 'can_bulk_edit_classes'),
  true,
  'an admin does'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  $$ select public.close_gym_dates(
       current_setting('test.gym')::uuid,
       current_date + 10, current_date + 20, null, null) $$,
  'Not authorised',
  'a coach cannot close the gym'
);

select * from finish();
rollback;
