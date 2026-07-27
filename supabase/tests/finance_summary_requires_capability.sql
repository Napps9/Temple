-- Money is can_see_money, which is owner-only by default — an admin sees
-- insights but not revenue. The RPC enforces it server-side; the client
-- gate is a courtesy, not the control.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@fincap.test');
  v_admin uuid := _test_mk_user('admin@fincap.test');
  v_gym   uuid := _test_mk_gym('Fin Cap', 'fincap');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.start',
    date_trunc('month', current_date)::date::text, true);
end;
$$;

select is(
  public.default_capability('admin'::public.gym_role, 'can_see_money'),
  false,
  'an admin does not get can_see_money by default'
);

select _test_act_as(current_setting('test.admin')::uuid);

select throws_ok(
  $$ select * from public.compute_finance_summary(
       current_setting('test.gym')::uuid,
       current_setting('test.start')::date) $$,
  'Not authorised',
  'so the finance summary refuses them'
);

select throws_ok(
  $$ select * from public.compute_revenue_summary(
       current_setting('test.gym')::uuid,
       current_setting('test.start')::date,
       current_setting('test.start')::date) $$,
  'Not authorised',
  'same gate as the existing revenue summary'
);

select * from finish();
rollback;
