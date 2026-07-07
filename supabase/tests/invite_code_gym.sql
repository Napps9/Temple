-- invite_code_gym: an anonymous invitee can resolve the inviting gym's
-- display info from a valid code, but not from a used or expired one.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@invgym.test');
  v_gym   uuid := _test_mk_gym('Invite Gym', 'invite-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.invite_codes (gym_id, code, role, created_by)
    values (v_gym, 'GOODCODE', 'member', v_owner);
  insert into public.invite_codes (gym_id, code, role, created_by, used_by, used_at)
    values (v_gym, 'USEDCODE', 'member', v_owner, v_owner, now());
  insert into public.invite_codes (gym_id, code, role, created_by, expires_at)
    values (v_gym, 'OLDCODE', 'member', v_owner, now() - interval '1 day');
end;
$$;

-- Resolve as an anonymous visitor (no session) — the invitee has no account yet.
do $$ begin perform set_config('role', 'anon', true); end; $$;

select is(
  (select name from public.invite_code_gym('GOODCODE')),
  'Invite Gym',
  'anon resolves the gym name from a valid invite code'
);

select is(
  (select role::text from public.invite_code_gym('GOODCODE')),
  'member',
  'the invited role comes back with the gym'
);

select is(
  (select count(*) from public.invite_code_gym('USEDCODE'))::int,
  0,
  'a used code resolves to nothing'
);

select is(
  (select count(*) from public.invite_code_gym('OLDCODE'))::int,
  0,
  'an expired code resolves to nothing'
);

select * from finish();
rollback;
