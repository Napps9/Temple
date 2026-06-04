-- rejoin_gym clears left_at only — it does NOT re-activate cancelled
-- subs / comps. Re-subscribing is a deliberate billing event.

begin;
select plan(3);

\ir _helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@rejoin.test');
  v_gym   uuid := _test_mk_gym('Rejoin', 'rejoin');
  v_member uuid := _test_mk_user('m@rejoin.test');
  v_plan   uuid;
  v_mid    uuid;
  v_sub    uuid;
  v_comp   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state)
  returning id into v_sub;
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by)
  values
    (v_gym, v_member, now() - interval '5 days', now() + interval '25 days', v_owner)
  returning grant_id into v_comp;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.sub',    v_sub::text,    true);
  perform set_config('test.comp',   v_comp::text,   true);

  perform _test_act_as(v_owner);
  perform public.leave_gym(v_gym, v_member);
  perform public.rejoin_gym(v_gym, v_member);
end;
$$;

select is(
  (select left_at from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid),
  null,
  'rejoin_gym clears left_at'
);

select is(
  (select status::text from public.plan_subscriptions
    where id = current_setting('test.sub')::uuid),
  'cancelled',
  'cancelled sub stays cancelled after rejoin (no auto-reactivation)'
);

select isnt(
  (select revoked_at from public.comp_grants
    where grant_id = current_setting('test.comp')::uuid),
  null,
  'revoked comp_grant stays revoked after rejoin'
);

select * from finish();
rollback;
