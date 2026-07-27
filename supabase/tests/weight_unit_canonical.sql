-- Kilograms are what gets stored, whatever the spreadsheet said.
--
-- The importer accepted lb and wrote it through unconverted, and every
-- comparator in the app — bestOf, the PR badge, both leaderboards — ranks
-- raw numerics. So a 315 lb import beat a 200 kg lift and then suppressed
-- that member's own later real PRs.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@wunit.test');
  v_member uuid := _test_mk_user('member@wunit.test');
  v_gym    uuid := _test_mk_gym('Weight Unit', 'wunit');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.member', v_member::text, true);
end;
$$;

select is(
  (select weight_unit from public.gyms
    where id = current_setting('test.gym')::uuid),
  'kg',
  'a new gym displays kilograms until it says otherwise'
);

-- 315 lb is 142.88 kg. Stored raw it outranks 200 kg; converted it does
-- not, which is the entire point.
select is(
  public._to_kg(315, 'lb'),
  142.88::numeric,
  'pounds convert on the way in'
);

select is(
  public._to_kg(100, 'kg'),
  100::numeric,
  'kilograms pass through untouched'
);

-- value_unit is shared across metrics — it carries 'm' and 'cal' too — so
-- the conversion has to name the weight units rather than treat anything
-- that is not kg as poundage.
select is(
  public._to_kg(500, 'm'),
  500::numeric,
  'a distance is not silently reinterpreted as a weight'
);

select _test_act_as(current_setting('test.member')::uuid);

select throws_ok(
  format(
    $$ select public.set_gym_weight_unit(%L::uuid, 'lb') $$,
    current_setting('test.gym')
  ),
  'Only an owner can change the weight unit',
  'a member cannot change how the gym reads weights'
);

select _test_act_as(current_setting('test.owner')::uuid);

select throws_ok(
  format(
    $$ select public.set_gym_weight_unit(%L::uuid, 'stone') $$,
    current_setting('test.gym')
  ),
  'Unknown weight unit: stone',
  'and the owner cannot invent one'
);

select * from finish();
rollback;
