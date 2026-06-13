-- 0067: record_lead rejects a source from another gym, and
-- set_lead_status rejects converting to a profile that isn't a member
-- of the lead's gym.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@lwg.test');
  v_other_o uuid := _test_mk_user('other@lwg.test');
  v_stranger uuid := _test_mk_user('stranger@lwg.test');
  v_gym     uuid := _test_mk_gym('Guard Gym', 'guard-gym');
  v_other   uuid := _test_mk_gym('Other Gym', 'guard-other');
  v_foreign_src uuid;
  v_lead    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_other, v_other_o, 'owner');
  -- v_stranger belongs to neither gym.

  -- A source that lives on the OTHER gym.
  insert into public.lead_sources (gym_id, label)
    values (v_other, 'Foreign') returning id into v_foreign_src;

  -- A lead on our gym to flip statuses on.
  insert into public.leads (gym_id, full_name, status, captured_by)
    values (v_gym, 'Pat Prospect', 'cold'::public.lead_status, v_owner)
    returning id into v_lead;

  perform set_config('test.gym',         v_gym::text,         true);
  perform set_config('test.owner',       v_owner::text,       true);
  perform set_config('test.foreign_src', v_foreign_src::text, true);
  perform set_config('test.stranger',    v_stranger::text,    true);
  perform set_config('test.lead',        v_lead::text,        true);
end $$;

do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

-- 1. record_lead refuses a source belonging to another gym.
select throws_like(
  format(
    'select record_lead(%L::uuid, %L, null, null, %L::uuid, null)',
    current_setting('test.gym'),
    'Cross Source',
    current_setting('test.foreign_src')
  ),
  '%does not belong to this gym%',
  'record_lead rejects a source from another gym'
);

-- 2. set_lead_status refuses converting to a non-member profile.
select throws_like(
  format(
    'select set_lead_status(%L::uuid, %L, %L::uuid)',
    current_setting('test.lead'),
    'converted',
    current_setting('test.stranger')
  ),
  '%not a member of this gym%',
  'set_lead_status rejects a converted profile that is not a gym member'
);

select * from finish();
rollback;
