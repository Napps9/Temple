-- accept_invite: a signed-in invitee can accept a valid code and gets an
-- active membership — guards the OUT-param / column ambiguity regression.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@acc.test');
  v_new   uuid := _test_mk_user('newmember@acc.test');
  v_gym   uuid := _test_mk_gym('Accept Gym', 'accept-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.invite_codes (gym_id, code, role, created_by)
    values (v_gym, 'JOINME', 'member', v_owner);
  perform set_config('test.new', v_new::text, true);
  perform set_config('test.gym', v_gym::text, true);
end;
$$;

-- Accept as the invitee.
do $$ begin perform _test_act_as(current_setting('test.new')::uuid); end; $$;

select lives_ok(
  $$ select public.accept_invite('JOINME') $$,
  'a signed-in invitee accepts a valid invite (no ambiguous-column error)'
);

select is(
  (select count(*) from public.gym_memberships
     where profile_id = current_setting('test.new')::uuid
       and gym_id = current_setting('test.gym')::uuid
       and left_at is null)::int,
  1,
  'accepting the invite creates the active membership'
);

select * from finish();
rollback;
