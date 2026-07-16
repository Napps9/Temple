-- member_capabilities (0127) — per-person capability overrides sit above the
-- per-role overrides in effective_can, and only owners can set them.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@memcap.test');
  v_coach uuid := _test_mk_user('coach@memcap.test');
  v_gym   uuid := _test_mk_gym('MemCap Gym', 'memcap');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.owner', v_owner::text, true);
end $$;

-- 1. can_refund is owner-only by default, so the coach doesn't have it.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_refund'),
  false,
  'coach has no can_refund by default'
);

-- 2. A coach cannot write a member override (owner-only CUD).
select throws_like(
  format(
    'insert into public.gym_member_capabilities (gym_id, profile_id, capability, enabled) values (%L, %L, %L, true)',
    current_setting('test.gym'), current_setting('test.coach'), 'can_refund'
  ),
  '%row-level security%',
  'a coach cannot set a member capability override'
);

-- 3. The owner grants this coach can_refund.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select lives_ok(
  format(
    'insert into public.gym_member_capabilities (gym_id, profile_id, capability, enabled) values (%L, %L, %L, true)',
    current_setting('test.gym'), current_setting('test.coach'), 'can_refund'
  ),
  'owner can set a per-member override'
);

-- 4. The coach now has can_refund — the member override grants it.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_refund'),
  true,
  'a member override grants the coach can_refund'
);

-- 5. A member override (deny) beats a role override (allow).
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
    values (current_setting('test.gym')::uuid, 'coach', 'can_see_money', true);
  insert into public.gym_member_capabilities (gym_id, profile_id, capability, enabled)
    values (current_setting('test.gym')::uuid,
            current_setting('test.coach')::uuid, 'can_see_money', false);
end $$;
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  public.effective_can(current_setting('test.gym')::uuid, 'can_see_money'),
  false,
  'a per-member deny overrides a per-role allow'
);

select * from finish();
rollback;
