-- leave_gym transitions every non-terminal sub to 'cancelled' and
-- revokes every active comp_grant. Rows stay for history (no delete).

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@leavecancel.test');
  v_gym   uuid := _test_mk_gym('Leave Cancel', 'leavecancel');
  v_member uuid := _test_mk_user('m@leavecancel.test');
  v_plan   uuid;
  v_sub_active   uuid;
  v_sub_paused   uuid;
  v_sub_pending  uuid;
  v_sub_lapsed   uuid;
  v_comp_active  uuid;
  v_comp_already_revoked uuid;
  v_mid uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  v_mid := _test_mk_membership(v_gym, v_member, 'member');

  insert into public.membership_plans (gym_id, name, kind)
    values (v_gym, 'Unlimited', 'unlimited')
    returning plan_id into v_plan;

  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values
    (v_mid, v_member, v_gym, v_plan, 'active'::public.plan_sub_state)
  returning id into v_sub_active;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values
    (v_mid, v_member, v_gym, v_plan, 'paused'::public.plan_sub_state)
  returning id into v_sub_paused;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status)
  values
    (v_mid, v_member, v_gym, v_plan, 'pending'::public.plan_sub_state)
  returning id into v_sub_pending;
  insert into public.plan_subscriptions
    (gym_membership_id, profile_id, gym_id, plan_id, status, cancelled_at)
  values
    (v_mid, v_member, v_gym, v_plan, 'lapsed'::public.plan_sub_state, now() - interval '30 days')
  returning id into v_sub_lapsed;

  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by)
  values
    (v_gym, v_member, now() - interval '5 days', now() + interval '25 days', v_owner)
  returning grant_id into v_comp_active;
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by, revoked_at)
  values
    (v_gym, v_member, now() - interval '40 days', now() + interval '20 days', v_owner,
     now() - interval '10 days')
  returning grant_id into v_comp_already_revoked;

  perform set_config('test.gym',           v_gym::text,            true);
  perform set_config('test.member',        v_member::text,         true);
  perform set_config('test.sub_active',    v_sub_active::text,     true);
  perform set_config('test.sub_paused',    v_sub_paused::text,     true);
  perform set_config('test.sub_pending',   v_sub_pending::text,    true);
  perform set_config('test.sub_lapsed',    v_sub_lapsed::text,     true);
  perform set_config('test.comp_active',   v_comp_active::text,    true);
  perform set_config('test.comp_revoked',  v_comp_already_revoked::text, true);

  perform _test_act_as(v_owner);
  perform public.leave_gym(v_gym, v_member);
end;
$$;

select is(
  (select status::text from public.plan_subscriptions
    where id = current_setting('test.sub_active')::uuid),
  'cancelled',
  'active sub → cancelled'
);

select is(
  (select status::text from public.plan_subscriptions
    where id = current_setting('test.sub_paused')::uuid),
  'cancelled',
  'paused sub → cancelled'
);

select is(
  (select status::text from public.plan_subscriptions
    where id = current_setting('test.sub_pending')::uuid),
  'cancelled',
  'pending sub → cancelled'
);

-- A previously-lapsed sub is untouched (already terminal).
select is(
  (select status::text from public.plan_subscriptions
    where id = current_setting('test.sub_lapsed')::uuid),
  'lapsed',
  'lapsed sub stays lapsed (terminal status not flipped)'
);

select isnt(
  (select revoked_at from public.comp_grants
    where grant_id = current_setting('test.comp_active')::uuid),
  null,
  'active comp_grant.revoked_at populated'
);

select is(
  (select count(*)::int from public.plan_subscriptions
    where profile_id = current_setting('test.member')::uuid),
  4,
  'all sub rows preserved (no deletion)'
);

select is(
  (select left_at is not null
    from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid),
  true,
  'gym_memberships.left_at populated'
);

select * from finish();
rollback;
