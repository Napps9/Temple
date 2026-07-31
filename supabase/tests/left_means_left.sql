-- Left means left (0236).
--
-- Two halves. The first is the bug: one coach and one owner whose
-- memberships were closed 120 days ago, asserted against every helper that
-- grants a staff power. Before this migration four of them said yes.
--
-- The second is the family, keyed on the name rather than the list, so a
-- helper added later without the guard fails here rather than shipping —
-- which is exactly how five of these survived 0223 fixing the sixth.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@left.test');
  v_gone_c  uuid := _test_mk_user('gonecoach@left.test');
  v_gone_o  uuid := _test_mk_user('goneowner@left.test');
  v_here_c  uuid := _test_mk_user('herecoach@left.test');
  v_gym     uuid := _test_mk_gym('Left Gym', 'left-gym');
  v_m       uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');

  v_m := _test_mk_membership(v_gym, v_gone_c, 'coach');
  update public.gym_memberships set left_at = now() - interval '120 days'
    where id = v_m;

  v_m := _test_mk_membership(v_gym, v_gone_o, 'owner');
  update public.gym_memberships set left_at = now() - interval '120 days'
    where id = v_m;

  -- The control. Everything below has to keep saying yes to them, or the
  -- guard has been added by breaking the gym instead of securing it.
  perform _test_mk_membership(v_gym, v_here_c, 'coach');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.gonec',  v_gone_c::text, true);
  perform set_config('test.goneo',  v_gone_o::text, true);
  perform set_config('test.herec',  v_here_c::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- The coach who left
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.gonec')::uuid);

select ok(
  not public.user_can_manage_classes(current_setting('test.gym')::uuid),
  'a coach who left cannot touch class types, recurrences or sessions'
);

select ok(
  not public.user_can_admin_or_coach(current_setting('test.gym')::uuid),
  'nor delete a member''s booking'
);

select ok(
  not public.user_can_cover(current_setting('test.gym')::uuid),
  'nor read the cover requests'
);

select ok(
  not public.user_can_access_staff_area(current_setting('test.gym')::uuid),
  'nor the waitlist, the SOPs or the onboarding answers'
);

select ok(
  not public.user_can_assign_plan(current_setting('test.gym')::uuid),
  'nor who is on what plan and what they pay'
);

-- ---------------------------------------------------------------------------
-- The owner who left
-- ---------------------------------------------------------------------------
--
-- A gym always keeps at least one owner (0223), so an owner with a closed
-- membership has already been replaced.

select _test_act_as(current_setting('test.goneo')::uuid);

select ok(
  not public.user_is_owner_of(current_setting('test.gym')::uuid),
  'an owner who left cannot switch a job on or rebrand the gym'
);

-- ---------------------------------------------------------------------------
-- The coach who is still here
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.herec')::uuid);

select ok(
  public.user_can_manage_classes(current_setting('test.gym')::uuid)
    and public.user_can_cover(current_setting('test.gym')::uuid)
    and public.user_can_access_staff_area(current_setting('test.gym')::uuid),
  'a coach who is still here is untouched by all of this'
);

-- ---------------------------------------------------------------------------
-- The family
-- ---------------------------------------------------------------------------
--
-- Keyed on the name, not on the list above: 0223 fixed one helper and left
-- five, and nothing failed. A helper that grants a staff power and forgets
-- the guard now fails here instead.
--
-- user_belongs_to is the one exclusion and it is deliberate. It backs 29
-- policies including the tracked_* tables — a member's own workout history,
-- PRs and race splits — so whether leaving a gym should cut somebody off
-- from their own training record is a product decision with a GDPR edge,
-- not a permission bug. Named here so the exemption is a choice somebody
-- made rather than a helper nobody noticed.

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'user\_can\_%' or p.proname = 'user_is_owner_of')
      and pg_get_functiondef(p.oid) not like '%left_at is null%'),
  '',
  'every helper that grants a staff power refuses somebody who has left'
);

select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'user_belongs_to'
      and pg_get_functiondef(p.oid) not like '%left_at%'),
  1,
  'and user_belongs_to is still the open question, on purpose'
);

select * from finish();
rollback;
