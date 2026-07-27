-- A member's phone number is not gym gossip.
--
-- profiles_gym_member_select admits every member of the gym to every other
-- member's profile row, and Postgres has no column-level RLS — so while
-- phone sat on profiles, the person on the next rower could read it.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@phonepriv.test');
  v_coach  uuid := _test_mk_user('coach@phonepriv.test');
  v_member uuid := _test_mk_user('member@phonepriv.test');
  v_other  uuid := _test_mk_user('other@phonepriv.test');
  v_gym    uuid := _test_mk_gym('Phone Priv', 'phonepriv');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_other,  'member');

  insert into public.member_contact_details (profile_id, phone)
    values (v_member, '07700 900123');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.other',  v_other::text,  true);
end;
$$;

-- The column is gone from the table everyone can read. Asserted on the
-- catalogue, so putting it back fails here rather than silently.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'phone'),
  0,
  'no phone on the row every gym-mate can select'
);

select _test_act_as(current_setting('test.other')::uuid);

select is(
  (select count(*)::int from public.member_contact_details),
  0,
  'another member cannot read it'
);

-- They can still see the things the app actually renders, which is the
-- whole reason this is a side table rather than a narrower policy.
select ok(
  (select full_name is not null from public.profiles
    where id = current_setting('test.member')::uuid),
  'while still seeing the name every screen shows'
);

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  format(
    $$ select public.gym_member_contacts(%L::uuid) $$,
    current_setting('test.gym')
  ),
  'Not authorised',
  'a coach cannot bulk-export contact details'
);

select _test_act_as(current_setting('test.member')::uuid);

select is(
  (select phone from public.member_contact_details),
  '07700 900123',
  'the member reads their own number'
);

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select phone from public.gym_member_contacts(current_setting('test.gym')::uuid)
    where profile_id = current_setting('test.member')::uuid),
  '07700 900123',
  'the owner gets it through the capability-gated RPC'
);

-- The export previously emitted phone under can_export_members alone, so
-- the DB never checked a PII capability at all. Taking can_see_full_pii
-- away has to empty the column, not just hide the button.
select lives_ok(
  format(
    $$ insert into public.gym_role_capabilities
         (gym_id, role, capability, enabled)
       values (%L::uuid, 'admin', 'can_see_full_pii', false) $$,
    current_setting('test.gym')
  ),
  'the owner takes can_see_full_pii off admins'
);

-- Leaving the gym ends the read. same_gym_as_caller had no left_at filter
-- at all, so an ex-member kept every current member's profile row.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  format(
    $$ select public.leave_gym(%L::uuid, %L::uuid) $$,
    current_setting('test.gym'), current_setting('test.other')
  ),
  'a member leaves the gym'
);

select _test_act_as(current_setting('test.other')::uuid);

select is(
  (select count(*)::int from public.profiles
    where id = current_setting('test.member')::uuid),
  0,
  'and stops being able to read who else is in it'
);

select * from finish();
rollback;
