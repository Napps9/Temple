-- The audience resolver is not a member directory.
--
-- comms_audience_rows is security definer and joins auth.users for the
-- address, so a grant to `authenticated` is a grant to read every member's
-- name and email in every gym — the caller just passes a gym id. 0058
-- granted it while carrying 0044's revoke forward two lines above, and
-- every later create-or-replace inherited the ACL.
--
-- These assertions are written from the outsider's seat on purpose: a user
-- who belongs to no gym at all is the sharpest version of the question,
-- and the one that was answerable until 0188.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@audpub.test');
  v_mem   uuid := _test_mk_user('member@audpub.test');
  v_gym   uuid := _test_mk_gym('Audience Public', 'audpub');
  v_out   uuid := _test_mk_user('outsider@audpub.test');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_mem,   'member');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.mem',   v_mem::text,   true);
  perform set_config('test.out',   v_out::text,   true);
end;
$$;

select _test_act_as(current_setting('test.out')::uuid);

select throws_ok(
  format(
    $$ select * from public.comms_audience_rows(%L::uuid,
         '{"kind":"all_members"}'::jsonb, null) $$,
    current_setting('test.gym')
  ),
  '42501',
  null,
  'a user in no gym cannot read another gym''s member list'
);

select throws_ok(
  format(
    $$ select public.comms_audience_count(%L::uuid,
         '{"kind":"all_members"}'::jsonb, null) $$,
    current_setting('test.gym')
  ),
  'Not authorised',
  'nor count it'
);

-- The oracle: manual audiences answer "is this person in that gym".
select throws_ok(
  format(
    $$ select public.comms_audience_count(%L::uuid,
         jsonb_build_object('kind','manual','profile_ids',
           jsonb_build_array(%L)), null) $$,
    current_setting('test.gym'), current_setting('test.mem')
  ),
  'Not authorised',
  'nor ask whether one named person is in it'
);

-- A member of the gym is still not comms staff. can_manage_comms is
-- admin-and-up by default, and this is the surface it governs.
select _test_act_as(current_setting('test.mem')::uuid);

select throws_ok(
  format(
    $$ select public.comms_audience_count(%L::uuid,
         '{"kind":"all_members"}'::jsonb, null) $$,
    current_setting('test.gym')
  ),
  'Not authorised',
  'and neither can a member of the gym itself'
);

-- The people the feature is for still have it.
select _test_act_as(current_setting('test.owner')::uuid);

select is(
  public.comms_audience_count(current_setting('test.gym')::uuid,
    '{"kind":"all_members"}'::jsonb, null),
  1,
  'the owner still counts their own audience'
);

select * from finish();
rollback;
