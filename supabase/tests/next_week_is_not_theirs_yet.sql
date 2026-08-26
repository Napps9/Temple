-- 0273: a draft is a draft. What a member may read, what staff may read,
-- and the backfill that stops a deploy emptying every gym's calendar.

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@embargo.test');
  v_coach uuid := _test_mk_user('coach@embargo.test');
  v_mem   uuid := _test_mk_user('mem@embargo.test');
  v_gym   uuid := _test_mk_gym('Embargo Gym', 'embargo-gym');
  v_ct    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_mem, 'member');

  insert into public.class_types (gym_id, name, color)
  values (v_gym, 'CrossFit', '#2563EB') returning id into v_ct;

  perform set_config('test.gym', v_gym::text, false);
  perform set_config('test.ct', v_ct::text, false);
  perform set_config('test.coach', v_coach::text, false);
  perform set_config('test.mem', v_mem::text, false);
end $$;

-- 1-2. A coach writes today live and next week as a draft.
select _test_act_as(current_setting('test.coach')::uuid);
select isnt(
  (select public.save_class_programming(
     current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
     current_date, '[{"title":"Today"}]'::jsonb)),
  null,
  'a coach writes today'
);
select isnt(
  (select public.save_class_programming(
     current_setting('test.gym')::uuid, current_setting('test.ct')::uuid,
     current_date + 7, '[{"title":"Next Thursday"}]'::jsonb, null)),
  null,
  'and writes next week as a draft'
);

-- 3. Staff see both — they are the ones writing them.
select is(
  (select count(*)::int from public.class_programming
    where gym_id = current_setting('test.gym')::uuid),
  2,
  'staff read drafts as well as what is live'
);

-- 4-5. The member sees today and not next week. This is the whole ask.
select _test_act_as(current_setting('test.mem')::uuid);
select is(
  (select count(*)::int from public.class_programming),
  1,
  'a member reads only what has been released'
);
select is(
  (select date from public.class_programming),
  current_date,
  'and it is today, not next Thursday'
);

-- 6. A future published_at is scheduled, not live: still hidden.
select _test_act_as(current_setting('test.coach')::uuid);
select lives_ok(
  format($q$select public.save_class_programming(%L, %L, %L, '[{"title":"Friday"}]'::jsonb,
           now() + interval '2 days')$q$,
    current_setting('test.gym'), current_setting('test.ct'), current_date + 8),
  'a coach schedules a release for two days out'
);
select _test_act_as(current_setting('test.mem')::uuid);
select is(
  (select count(*)::int from public.class_programming),
  1,
  'a scheduled release is not visible before its moment'
);

-- 8. Releasing the day makes it readable without reopening the editor.
select _test_act_as(current_setting('test.coach')::uuid);
select is(
  (select public.publish_class_programming(
     current_setting('test.gym')::uuid, current_date + 7)),
  1,
  'publishing a day releases what was written ahead'
);

select * from finish();
rollback;
