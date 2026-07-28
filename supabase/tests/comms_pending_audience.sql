-- The "Imported members" audience has to actually reach them.
--
-- 0046 implemented the pending_members branch in the two-arg resolver;
-- 0058 replaced that with a shim delegating to a three-arg version that
-- never had the branch. The audience stayed in the picker and quietly
-- resolved to nobody — which surfaces as "this audience has no members
-- with a usable email address", i.e. as the gym's fault rather than ours.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@pendaud.test');
  v_member uuid := _test_mk_user('member@pendaud.test');
  v_gym    uuid := _test_mk_gym('Pending Audience', 'pendaud');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.pending_members (gym_id, email, full_name, status)
  values
    (v_gym, 'imported1@pendaud.test', 'Ada Imported',  'pending'),
    (v_gym, 'imported2@pendaud.test', 'Bea Invited',   'invited'),
    (v_gym, 'joined@pendaud.test',    'Cid Joined',    'linked'),
    (v_gym, 'gone@pendaud.test',      'Dee Optedout',  'pending');

  insert into public.email_unsubscribes (gym_id, email)
  values (v_gym, 'gone@pendaud.test');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

-- comms_audience_rows is definer-internal plumbing again (0188) — granting
-- it to `authenticated` handed every user a member directory for any gym.
-- These assertions are about what the resolver RESOLVES TO, not about who
-- may call it, so they run as the table owner. Who may call it is covered
-- by comms_audience_not_public.sql.
select set_config('role', 'postgres', true);

select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     '{"kind":"pending_members"}'::jsonb, null)),
  2,
  'the imported-members audience reaches the imported members'
);

select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     '{"kind":"pending_members"}'::jsonb, null)
    where email = 'joined@pendaud.test'),
  0,
  'and not one who has already signed up'
);

select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     '{"kind":"pending_members"}'::jsonb, null)
    where email = 'gone@pendaud.test'),
  0,
  'nor one who unsubscribed before they ever joined'
);

-- They have no profile yet, which is the whole reason they cannot come out
-- of the membership-based branch.
select ok(
  (select bool_and(profile_id is null) from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     '{"kind":"pending_members"}'::jsonb, null)),
  'they arrive without a profile id, because they do not have one'
);

-- The default audience must not accidentally sweep them in.
select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     '{"kind":"all_members"}'::jsonb, null)),
  1,
  'and all_members still means members who actually joined'
);

select * from finish();
rollback;
