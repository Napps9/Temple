-- Contact details for chasing a member, one capability per field.
--
-- can_see_email had no enforcement anywhere before this function, so these
-- are the first assertions that the key means anything.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@contact.test');
  v_admin  uuid := _test_mk_user('admin@contact.test');
  v_coach  uuid := _test_mk_user('coach@contact.test');
  v_member uuid := _test_mk_user('member@contact.test');
  v_gym    uuid := _test_mk_gym('Contact', 'contactgym');
  v_other  uuid := _test_mk_gym('Elsewhere', 'elsewhere');
  v_out    uuid := _test_mk_user('outsider@contact.test');
begin
  perform _test_mk_membership(v_gym,   v_owner,  'owner');
  perform _test_mk_membership(v_gym,   v_admin,  'admin');
  perform _test_mk_membership(v_gym,   v_coach,  'coach');
  perform _test_mk_membership(v_gym,   v_member, 'member');
  perform _test_mk_membership(v_other, v_out,    'owner');

  insert into public.member_contact_details (profile_id, phone)
    values (v_member, '07700 900123');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.other',  v_other::text,  true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.out',    v_out::text,    true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select email from public.gym_member_contact(
     current_setting('test.gym')::uuid, current_setting('test.member')::uuid)),
  'member@contact.test',
  'the owner gets the address to write to'
);

select is(
  (select phone from public.gym_member_contact(
     current_setting('test.gym')::uuid, current_setting('test.member')::uuid)),
  '07700 900123',
  'and the number to ring'
);

-- admin holds can_see_email and can_see_full_pii by default; can_see_money
-- it does NOT hold, which is why this is its own function rather than a
-- column on the chase list.
select _test_act_as(current_setting('test.admin')::uuid);

select is(
  (select email from public.gym_member_contact(
     current_setting('test.gym')::uuid, current_setting('test.member')::uuid)),
  'member@contact.test',
  'an admin does too'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  format(
    $$ select public.gym_member_contact(%L::uuid, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.member')
  ),
  'Not authorised',
  'a coach is refused outright, not handed two empty columns'
);

select _test_act_as(current_setting('test.member')::uuid);

select throws_ok(
  format(
    $$ select public.gym_member_contact(%L::uuid, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.member')
  ),
  'Not authorised',
  'and a member cannot read contact details, not even their own, here'
);

-- Staff at another gym must not be able to walk profile uuids.
select _test_act_as(current_setting('test.out')::uuid);

select throws_ok(
  format(
    $$ select public.gym_member_contact(%L::uuid, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.member')
  ),
  'Not authorised',
  'an owner elsewhere cannot ask this gym for its members'
);

select throws_ok(
  format(
    $$ select public.gym_member_contact(%L::uuid, %L::uuid) $$,
    current_setting('test.other'), current_setting('test.member')
  ),
  'Not a member of this gym',
  'nor point their own gym at a profile that is not in it'
);

-- Turning the capability off for the role has to actually turn the surface
-- off, or the team editor's toggle is decorative.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format(
    $$ insert into public.gym_role_capabilities
         (gym_id, role, capability, enabled)
       values (%L::uuid, 'admin', 'can_see_email', false) $$,
    current_setting('test.gym')
  ),
  'the owner takes can_see_email off admins'
);

select _test_act_as(current_setting('test.admin')::uuid);

select ok(
  (select email is null and phone is not null
     from public.gym_member_contact(
       current_setting('test.gym')::uuid,
       current_setting('test.member')::uuid)),
  'the address goes and the number stays — one field, one capability'
);

select * from finish();
rollback;
