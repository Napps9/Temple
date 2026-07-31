-- The invite that let nobody back in (0239).
--
-- The first four assertions are the bug: leave_gym keeps the row and
-- stamps left_at, accept_invite upserts and only set the role, so being
-- invited back consumed the code and changed nothing. Then the half of
-- 0033 accept_invite was left out of, and the two places that authorise on
-- a role without asking whether the membership is still open.

begin;
select plan(11);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@invite.test');
  v_back   uuid := _test_mk_user('back@invite.test');
  v_new    uuid := _test_mk_user('new@invite.test');
  v_other  uuid := _test_mk_user('other@invite.test');
  v_admin  uuid := _test_mk_user('goneadmin@invite.test');
  v_here_a uuid := _test_mk_user('hereadmin@invite.test');
  v_member uuid := _test_mk_user('member@invite.test');
  v_gym    uuid := _test_mk_gym('Invite Gym', 'invite-gym');
  v_far    uuid := _test_mk_gym('Other Gym', 'other-invite-gym');
  v_m      uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_far,  v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  -- Left in March, invited back in July.
  v_m := _test_mk_membership(v_gym, v_back, 'member');
  update public.gym_memberships set left_at = now() - interval '120 days'
    where id = v_m;

  -- An admin who left, and is about to try to change somebody's booking
  -- rules anyway.
  v_m := _test_mk_membership(v_gym, v_admin, 'admin');
  update public.gym_memberships set left_at = now() - interval '30 days'
    where id = v_m;

  perform _test_mk_membership(v_gym, v_here_a, 'admin');

  -- Already somewhere else, and invited here.
  perform _test_mk_membership(v_far, v_other, 'member');

  -- The matrix only holds rows where an owner overrode a default, so it is
  -- empty unless the fixture puts something in it — a count of zero would
  -- otherwise pass whether or not the policy is guarded.
  insert into public.gym_role_capabilities (gym_id, role, capability, enabled)
    values (v_gym, 'admin', 'can_work_leads', false);

  insert into public.invite_codes (gym_id, code, role, created_by) values
    (v_gym, 'BACKAGAIN', 'coach',  v_owner),
    (v_gym, 'FIRSTTIME', 'member', v_owner),
    (v_gym, 'TAKENALREADY', 'member', v_owner);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.far',    v_far::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.back',   v_back::text,   true);
  perform set_config('test.new',    v_new::text,    true);
  perform set_config('test.other',  v_other::text,  true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.herea',  v_here_a::text, true);
  perform set_config('test.member', v_member::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- The member who was invited back
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.back')::uuid);
select lives_ok(
  $$ select public.accept_invite('BACKAGAIN') $$,
  'a member who left can accept an invite back'
);

select is(
  (select left_at from public.gym_memberships
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.back')::uuid),
  null,
  'and the membership reopens rather than staying closed'
);

select ok(
  public.user_belongs_to(current_setting('test.gym')::uuid),
  'so they are in the gym, which is what the invite told them'
);

-- The invite carries the role, and coming back is how somebody returns as
-- staff — the upsert has to move the role as well as reopen the row.
select is(
  (select role::text from public.gym_memberships
     where gym_id = current_setting('test.gym')::uuid
       and profile_id = current_setting('test.back')::uuid),
  'coach',
  'at the role the invite was written for'
);

-- ---------------------------------------------------------------------------
-- Nothing about the ordinary path moves
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.new')::uuid);
select lives_ok(
  $$ select public.accept_invite('FIRSTTIME') $$,
  'somebody with no membership at all still joins by invite'
);

-- ---------------------------------------------------------------------------
-- One gym per account, on this path too
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.other')::uuid);
select throws_ok(
  $$ select public.accept_invite('TAKENALREADY') $$,
  'You already belong to a gym — one gym per account for now',
  'an invite cannot mint a second active membership'
);

-- The refusal has to roll back before the code is consumed, or the gym has
-- to issue a new one after the member leaves the gym they were in.
select is(
  (select used_at from public.invite_codes where code = 'TAKENALREADY'),
  null,
  'and the refused invite is still unused'
);

-- ---------------------------------------------------------------------------
-- The admin who left
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.admin')::uuid);
select throws_ok(
  format(
    $$ select public.set_member_booking_requirement(%L::uuid, %L::uuid, true) $$,
    current_setting('test.gym'), current_setting('test.member')
  ),
  'Only an owner or admin can change this',
  'an admin who left cannot change who needs a membership to book'
);

select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format(
    $$ select public.set_member_booking_requirement(%L::uuid, %L::uuid, true) $$,
    current_setting('test.gym'), current_setting('test.member')
  ),
  'the owner who is still here can'
);

-- ---------------------------------------------------------------------------
-- The capability matrix
-- ---------------------------------------------------------------------------
--
-- What every role in that gym is allowed to do. No member data, but it is
-- gym configuration and the app stops asking for it the moment the
-- membership closes.

select _test_act_as(current_setting('test.admin')::uuid);
select is(
  (select count(*) from public.gym_role_capabilities
     where gym_id = current_setting('test.gym')::uuid),
  0::bigint,
  'an admin who left no longer reads the gym capability matrix'
);

select _test_act_as(current_setting('test.herea')::uuid);
select is(
  (select count(*) from public.gym_role_capabilities
     where gym_id = current_setting('test.gym')::uuid),
  1::bigint,
  'while the admin who is still here reads it unchanged'
);

select finish();
rollback;
