-- Past sessions are history, not future commitments. cancel_session refuses
-- when starts_at <= now(). The UI hides the affordance, but the RPC enforces
-- the invariant server-side.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@cancelpast.test');
  v_gym   uuid := _test_mk_gym('Cancel Past', 'cancelpast');
  v_past  uuid;
  v_future uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  v_past   := _test_mk_session(v_gym, v_owner, now() - interval '2 days');
  v_future := _test_mk_session(v_gym, v_owner, now() + interval '2 days');

  perform set_config('test.past',   v_past::text,   true);
  perform set_config('test.future', v_future::text, true);

  perform _test_act_as(v_owner);
end;
$$;

select throws_ok(
  $$ select public.cancel_session(current_setting('test.past')::uuid) $$,
  'P0001',
  'Cannot cancel a session that has already started',
  'cancel_session refuses a past session'
);

select lives_ok(
  $$ select public.cancel_session(current_setting('test.future')::uuid) $$,
  'cancel_session succeeds for a future session'
);

select * from finish();
rollback;
