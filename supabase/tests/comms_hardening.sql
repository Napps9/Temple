-- Hardening assertions for the Communications Suite (migration 0045):
--   1. effective_can returns false for a soft-deleted member, so a
--      previously-admin user who left can't keep sending campaigns.
--   2. email_campaigns RLS denies updates once status leaves
--      draft / scheduled — a stale client can't mutate a sent record.
--   3. comms_finalize_simulation refuses a second invocation on the
--      same campaign (already sent → wrong status).
--   4. compiled_html size cap (CHECK constraint) rejects oversize
--      payloads at the DB layer.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@harden.test');
  v_admin uuid := _test_mk_user('admin@harden.test');
  v_m1    uuid := _test_mk_user('m1@harden.test');
  v_gym   uuid := _test_mk_gym('Harden Gym', 'harden-gym');
  v_cid   uuid := gen_random_uuid();
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_m1,    'member');
  insert into public.email_campaigns (id, gym_id, created_by, title, subject)
    values (v_cid, v_gym, v_owner, 'Harden Blast', 'Hello');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.cid',   v_cid::text,   true);
end $$;

-- 1. effective_can drops to false after the admin leaves the gym.
--    Direct UPDATE bypasses RLS via reset role so we mutate the
--    membership without going through leave_gym (whose semantics we
--    are not testing here).
do $$ begin reset role; end $$;
update public.gym_memberships set left_at = now()
  where gym_id = current_setting('test.gym')::uuid
    and profile_id = current_setting('test.admin')::uuid;
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;

select is(
  public.effective_can(
    current_setting('test.gym')::uuid, 'can_manage_comms'),
  false,
  'a soft-deleted admin loses can_manage_comms (effective_can gates on left_at)'
);

-- 2. Update on a 'sent' campaign is denied by RLS.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
do $$ begin reset role; end $$;
update public.email_campaigns set status = 'sent'
  where id = current_setting('test.cid')::uuid;
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

select is(
  (with u as (
    update public.email_campaigns
      set subject = 'Should not change'
      where id = current_setting('test.cid')::uuid
      returning id
   ) select count(*)::int from u),
  0,
  'an UPDATE on a sent campaign is silently filtered out by RLS (0 rows)'
);

-- 3. Re-running comms_finalize_simulation on an already-sent campaign
--    is refused — the campaign isn't in 'sending' anymore.
do $$ begin reset role; end $$;
update public.email_campaigns set status = 'sending'
  where id = current_setting('test.cid')::uuid;
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
-- First call: legitimate finalise.
do $$
declare v_n int;
begin
  v_n := public.comms_finalize_simulation(current_setting('test.cid')::uuid);
end $$;
-- Second call: must throw because status is now 'sent'.
select throws_like(
  format(
    'select public.comms_finalize_simulation(%L::uuid)',
    current_setting('test.cid')
  ),
  '%not in sending state%',
  'comms_finalize_simulation refuses a second run on a sent campaign'
);

-- 4. compiled_html size cap fires at the DB layer.
do $$ begin reset role; end $$;
select throws_ok(
  format(
    'update public.email_campaigns set compiled_html = repeat(''x'', 3 * 1024 * 1024) where id = %L::uuid',
    current_setting('test.cid')
  ),
  '23514',
  null,
  'compiled_html beyond 2 MB is rejected by the CHECK constraint'
);

select * from finish();
rollback;
