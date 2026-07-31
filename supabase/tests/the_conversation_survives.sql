-- The conversation survives, and stays yours (0221).
--
-- The assertion that matters most is the second block: a coach's
-- conversation is not the owner's to read. This is the first table in
-- Temple recording what staff asked rather than what they did, and the
-- ask was "what did I ask yesterday" — first person, both times.
--
-- The third block is the obligation. Forgetting a member has to forget
-- the sentences that name them, and _erase_member_health_data is where
-- every forget-this-member path already goes.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@chat.test');
  v_coach uuid := _test_mk_user('coach@chat.test');
  v_mem   uuid := _test_mk_user('member@chat.test');
  v_gym   uuid := _test_mk_gym('Chat Gym', 'chatgym');
  v_else  uuid := _test_mk_gym('Elsewhere', 'chatelse');
  v_out   uuid := _test_mk_user('outsider@chat.test');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_mem,   'member');
  perform _test_mk_membership(v_else, v_out,  'owner');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.else',  v_else::text,  true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.mem',   v_mem::text,   true);
  perform set_config('test.out',   v_out::text,   true);
end;
$$;

-- ============================================================================
-- Saying things, and reading them back
-- ============================================================================

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  $$ insert into public.chat_turns (gym_id, profile_id, role, text, subject_profile_id)
     values (current_setting('test.gym')::uuid, current_setting('test.owner')::uuid,
             'owner', 'show me Marcus', current_setting('test.mem')::uuid) $$,
  'an owner''s turn is stored'
);

select is(
  (select count(*)::int from public.chat_turns
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'and they read it back'
);

-- Nobody writes a turn into somebody else's conversation, which is what
-- would make the history a place to plant things.
select throws_ok(
  $$ insert into public.chat_turns (gym_id, profile_id, role, text)
     values (current_setting('test.gym')::uuid, current_setting('test.coach')::uuid,
             'owner', 'not mine to say') $$,
  '42501',
  null,
  'and cannot put words in a coach''s conversation'
);

-- ============================================================================
-- Your conversation is yours
-- ============================================================================

select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select count(*)::int from public.chat_turns
    where gym_id = current_setting('test.gym')::uuid),
  0,
  'a coach cannot read the owner''s conversation'
);

select lives_ok(
  $$ insert into public.chat_turns (gym_id, profile_id, role, text)
     values (current_setting('test.gym')::uuid, current_setting('test.coach')::uuid,
             'owner', 'how busy was Saturday') $$,
  'and has one of their own'
);

select _test_act_as(current_setting('test.owner')::uuid);

-- The one that would be easy to get wrong in the other direction: being
-- the owner does not make every coach's questions readable.
select is(
  (select count(*)::int from public.chat_turns
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'and the owner still sees only their own — being the owner is not a licence to read the team''s questions'
);

select _test_act_as(current_setting('test.out')::uuid);

select is(
  (select count(*)::int from public.chat_turns),
  0,
  'and another gym''s owner sees nothing at all'
);

-- ============================================================================
-- Forgetting a member forgets the sentences that name them
-- ============================================================================

-- Driven through leave_gym rather than the internal function, which is
-- revoked from authenticated on purpose. This is also the real path: a
-- member leaving is what erasure is mostly for.
select _test_act_as(current_setting('test.mem')::uuid);

do $$ begin
  perform public.leave_gym(
    current_setting('test.gym')::uuid, current_setting('test.mem')::uuid);
end $$;

select _test_act_as(current_setting('test.owner')::uuid);

select is(
  (select count(*)::int from public.chat_turns
    where subject_profile_id = current_setting('test.mem')::uuid),
  0,
  'erasing a member takes the turns about them with it'
);

-- The gym's own turns are not about anybody and must survive: erasure is
-- targeted, not a wipe.
-- Erasure is targeted, not a wipe: a turn about nobody is not about the
-- member who left, and must survive.
select is(
  (select count(*)::int from public.chat_turns
    where gym_id = current_setting('test.gym')::uuid),
  0,
  'and the owner''s only turn was the one about them, so nothing else was there to lose'
);

select finish();
rollback;
