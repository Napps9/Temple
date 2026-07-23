-- Self-serve front-desk provisioning (0152): sane defaults on the new columns,
-- a status CHECK, and an entitlement gate that only the service role can flip.
--
-- Order matters: the authenticated (owner) negative case runs LAST, because
-- _test_act_as sets the role GUC and RESET ROLE doesn't reliably undo it across
-- Postgres minor versions (see CLAUDE.md). Keeping the role switch to the final
-- test means the service-role assertions run cleanly as the default superuser.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare v_gym uuid := _test_mk_gym('Provision Gym', 'provision-gym');
begin
  perform set_config('test.gym', v_gym::text, true);
  insert into public.gym_agent_settings (gym_id)
  values (v_gym) on conflict (gym_id) do nothing;
end $$;

-- 1-2. A fresh settings row is entitled by default (0163 - Temple charges a
-- flat monthly fee, not per-feature, so there's no billing reason to gate
-- this) and not yet provisioned.
select is(
  (select front_desk_entitled from public.gym_agent_settings
   where gym_id = current_setting('test.gym')::uuid),
  true,
  'front_desk_entitled defaults to true — no per-gym billing gate needed'
);
select is(
  (select provision_status from public.gym_agent_settings
   where gym_id = current_setting('test.gym')::uuid),
  'none',
  'provision_status defaults to none'
);

-- 3. The lifecycle CHECK rejects an unknown status.
select throws_ok(
  format($$ update public.gym_agent_settings set provision_status = 'bogus' where gym_id = %L $$,
         current_setting('test.gym')),
  '23514',
  null,
  'provision_status only accepts the known lifecycle values'
);

-- 4-5. The operator (service role) grants, then revokes, entitlement.
do $$ begin perform set_gym_front_desk_entitled(current_setting('test.gym')::uuid, true); end $$;
select is(
  (select front_desk_entitled from public.gym_agent_settings
   where gym_id = current_setting('test.gym')::uuid),
  true,
  'the operator grants entitlement'
);
do $$ begin perform set_gym_front_desk_entitled(current_setting('test.gym')::uuid, false); end $$;
select is(
  (select front_desk_entitled from public.gym_agent_settings
   where gym_id = current_setting('test.gym')::uuid),
  false,
  'entitlement can be revoked (e.g. on churn)'
);

-- 6. An owner cannot self-grant entitlement (service-role only). LAST — see header.
do $$
declare v_owner uuid := _test_mk_user('owner@prov.test');
begin
  perform _test_mk_membership(current_setting('test.gym')::uuid, v_owner, 'owner');
  perform _test_act_as(v_owner);
end $$;
select throws_like(
  format($$ select set_gym_front_desk_entitled(%L::uuid, true) $$, current_setting('test.gym')),
  '%permission denied%',
  'an owner cannot self-grant front-desk entitlement'
);

select * from finish();
rollback;
