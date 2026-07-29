-- The programming roadmap's blocks (0205): coaching material — coaches
-- and owners read and write, members see nothing.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@blocks.test');
  v_coach  uuid := _test_mk_user('coach@blocks.test');
  v_member uuid := _test_mk_user('member@blocks.test');
  v_gym    uuid := _test_mk_gym('Blocks Gym', 'blocks-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
end $$;

-- A coach can create and read a block.
select _test_act_as(current_setting('test.coach')::uuid);

select lives_ok(
  $$ insert into public.programming_blocks
       (gym_id, name, starts_on, ends_on, created_by)
     values (current_setting('test.gym')::uuid, 'Squat strength',
             '2027-01-06', '2027-02-28', current_setting('test.coach')::uuid) $$,
  'coach can create a block'
);

select is(
  (select count(*)::int from public.programming_blocks
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'coach reads the roadmap'
);

select throws_ok(
  $$ insert into public.programming_blocks
       (gym_id, name, starts_on, ends_on, created_by)
     values (current_setting('test.gym')::uuid, 'Backwards',
             '2027-03-01', '2027-02-01', current_setting('test.coach')::uuid) $$,
  23514,
  null,
  'a block cannot end before it starts'
);

-- A member sees nothing and writes nothing.
select _test_act_as(current_setting('test.member')::uuid);

select is(
  (select count(*)::int from public.programming_blocks),
  0,
  'member cannot read the roadmap'
);

select throws_ok(
  $$ insert into public.programming_blocks
       (gym_id, name, starts_on, ends_on, created_by)
     values (current_setting('test.gym')::uuid, 'Sneaky',
             '2027-01-01', '2027-01-31', current_setting('test.member')::uuid) $$,
  42501,
  null,
  'member cannot create a block'
);

select * from finish();
rollback;
