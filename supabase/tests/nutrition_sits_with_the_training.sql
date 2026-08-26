-- 0268: a coach's macro prescription. Who may write it, who may read it,
-- and the fact that it is numbers about a member in one gym only.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@macro.test');
  v_coach uuid := _test_mk_user('coach@macro.test');
  v_desk  uuid := _test_mk_user('desk@macro.test');
  v_mem   uuid := _test_mk_user('mem@macro.test');
  v_other uuid := _test_mk_user('other@macro.test');
  v_gym   uuid := _test_mk_gym('Macro Gym', 'macro-gym');
  v_gym_b uuid := _test_mk_gym('Other Macro', 'other-macro-gym');
  v_outsider uuid := _test_mk_user('outsider@macro.test');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_desk, 'staff');
  perform _test_mk_membership(v_gym, v_mem, 'member');
  perform _test_mk_membership(v_gym, v_other, 'member');
  perform _test_mk_membership(v_gym_b, v_outsider, 'coach');

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.gymb', v_gym_b::text, false);
  perform set_config('test.coach', v_coach::text, false);
  perform set_config('test.desk', v_desk::text, false);
  perform set_config('test.mem', v_mem::text, false);
  perform set_config('test.other', v_other::text, false);
  perform set_config('test.outsider', v_outsider::text, false);
end $$;

-- 1-2. The capability sits where can_program_members does.
select ok(
  public.default_capability('coach', 'can_set_macro_targets'),
  'a coach can set macros by default'
);
select ok(
  not public.default_capability('staff', 'can_set_macro_targets'),
  'front desk cannot'
);

-- 3. A coach writes them.
select _test_act_as(current_setting('test.coach')::uuid);
select lives_ok(
  format('select public.set_member_macro_targets(%L, %L, 180, 220, 70)',
         current_setting('test.gym'), current_setting('test.mem')),
  'a coach sets a member''s macros'
);

-- 4. Writing again replaces rather than duplicates.
select lives_ok(
  format('select public.set_member_macro_targets(%L, %L, 190, 210, 65)',
         current_setting('test.gym'), current_setting('test.mem')),
  'setting them again is an update'
);
select is(
  (select protein_g from public.member_macro_targets
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.mem')::uuid),
  190,
  'the newest prescription is the one that stands'
);

-- 6. Front desk cannot write them.
select _test_act_as(current_setting('test.desk')::uuid);
select throws_ok(
  format('select public.set_member_macro_targets(%L, %L, 100, 100, 100)',
         current_setting('test.gym'), current_setting('test.mem')),
  'Not authorised',
  'a capability the role does not hold refuses'
);

-- 7. A coach in another gym cannot reach this member.
select _test_act_as(current_setting('test.outsider')::uuid);
select throws_ok(
  format('select public.set_member_macro_targets(%L, %L, 100, 100, 100)',
         current_setting('test.gym'), current_setting('test.mem')),
  'Not authorised',
  'macros do not cross a gym boundary'
);

-- 8. The member reads their own.
select _test_act_as(current_setting('test.mem')::uuid);
select is(
  (select count(*)::int from public.member_macro_targets),
  1,
  'a member reads their own targets'
);

-- 9. Another member reads nothing.
select _test_act_as(current_setting('test.other')::uuid);
select is(
  (select count(*)::int from public.member_macro_targets),
  0,
  'a member cannot read somebody else''s'
);

select * from finish();
rollback;
