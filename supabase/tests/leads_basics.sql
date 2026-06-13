-- Lead tracking basics (0056): record_lead writes captured_by,
-- set_lead_status enforces converted-needs-profile, and tenant RLS
-- keeps gyms apart.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@leads.test');
  v_coach   uuid := _test_mk_user('coach@leads.test');
  v_member  uuid := _test_mk_user('m@leads.test');
  v_outsider uuid := _test_mk_user('out@leads.test');
  v_gym     uuid := _test_mk_gym('Lead Gym', 'lead-gym');
  v_other_gym uuid := _test_mk_gym('Other Lead Gym', 'other-lead');
  v_src_id  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_coach,  'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_other_gym, v_outsider, 'owner');

  insert into public.lead_sources (gym_id, label, color)
    values (v_gym, 'Instagram', '#FF6B6B')
    returning id into v_src_id;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.other_gym', v_other_gym::text, true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
  perform set_config('test.member', v_member::text, true);
  perform set_config('test.outsider', v_outsider::text, true);
  perform set_config('test.src',    v_src_id::text, true);
end $$;

-- 1. A bare member can't record a lead.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;

select throws_like(
  format(
    'select record_lead(%L::uuid, %L, %L, null, null, null)',
    current_setting('test.gym'),
    'Alex Test',
    'alex@test.com'
  ),
  '%Not authorised%',
  'a bare member cannot record a lead'
);

-- 2. A coach records a lead; captured_by is the coach.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;

do $$
declare v_lead uuid;
begin
  v_lead := record_lead(
    current_setting('test.gym')::uuid,
    'Alex Test',
    'alex@test.com',
    null,
    current_setting('test.src')::uuid,
    'Walked in asking about morning classes'
  );
  perform set_config('test.lead', v_lead::text, true);
end $$;

select is(
  (select captured_by::text from public.leads
   where id = current_setting('test.lead')::uuid),
  current_setting('test.coach'),
  'captured_by records the coach who created the lead'
);

select is(
  (select status::text from public.leads
   where id = current_setting('test.lead')::uuid),
  'cold',
  'leads default to cold'
);

-- 3. Moving to 'converted' requires a profile.
select throws_like(
  format(
    'select set_lead_status(%L::uuid, %L, null)',
    current_setting('test.lead'),
    'converted'
  ),
  '%member profile is required%',
  'converted status without a profile is refused'
);

-- 4. Set status to 'converted' with a profile.
do $$ begin
  perform set_lead_status(
    current_setting('test.lead')::uuid,
    'converted'::public.lead_status,
    current_setting('test.member')::uuid);
end $$;

select is(
  (select converted_profile_id::text from public.leads
   where id = current_setting('test.lead')::uuid),
  current_setting('test.member'),
  'converted_profile_id records the eventual member'
);

-- 5. Moving back from 'converted' clears the conversion pointers.
do $$ begin
  perform set_lead_status(
    current_setting('test.lead')::uuid,
    'lost'::public.lead_status,
    null);
end $$;

select is(
  (select converted_at from public.leads
   where id = current_setting('test.lead')::uuid),
  null,
  'going back to a non-converted status clears converted_at'
);

-- 6. RLS keeps gyms apart: the outsider owner can't see this lead.
do $$ begin perform _test_act_as(current_setting('test.outsider')::uuid); end $$;

select is(
  (select count(*)::int from public.leads
   where id = current_setting('test.lead')::uuid),
  0,
  'a different gym''s owner cannot see this gym''s leads via RLS'
);

select * from finish();
rollback;
