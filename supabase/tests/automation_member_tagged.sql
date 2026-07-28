-- member_tagged automations (0201): the trigger fires once per member for
-- manual and rule-applied tags alike, only for tags gained after the
-- automation existed — which depends on the incremental recompute keeping
-- member_tags.created_at stable across runs.
--
-- Fixture: automation 'VIP welcome' (tag "VIP", no delay, created a year
-- ago). m1 gains VIP manually today; m3 gains it from an intro rule via the
-- recompute; m2 is untagged; m4 has carried VIP since before the automation
-- existed (backdated created_at).

begin;
select plan(8);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@tagauto.test');
  v_m1 uuid := _test_mk_user('m1@tagauto.test');
  v_m2 uuid := _test_mk_user('m2@tagauto.test');
  v_m3 uuid := _test_mk_user('m3@tagauto.test');
  v_m4 uuid := _test_mk_user('m4@tagauto.test');
  v_gym uuid := _test_mk_gym('Tag Auto Gym', 'tag-auto-gym');
  v_a uuid;
  v_a_blank uuid;
  v_old timestamptz := now() - interval '365 days';
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m1, 'member');
  perform _test_mk_membership(v_gym, v_m2, 'member');
  perform _test_mk_membership(v_gym, v_m3, 'member');
  perform _test_mk_membership(v_gym, v_m4, 'member');

  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, delay_minutes, params, compiled_html, created_by, created_at)
    values (v_gym, 'VIP welcome', true, 'member_tagged', 0, '{"tag":"VIP"}',
            '<html>hi</html>', v_owner, v_old)
    returning id into v_a;

  -- Enabled but with no tag configured: must match nobody, not everybody.
  insert into public.email_automations
    (gym_id, name, enabled, trigger_type, delay_minutes, params, compiled_html, created_by, created_at)
    values (v_gym, 'Blank tag', true, 'member_tagged', 0, '{}',
            '<html>hi</html>', v_owner, v_old)
    returning id into v_a_blank;

  -- m1: manual VIP, gained today.
  insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
    values (v_gym, v_m1, 'VIP', '#F59E0B', 'manual', v_owner);

  -- m4: carried VIP since before the automation existed.
  insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
    values (v_gym, v_m4, 'VIP', '#F59E0B', 'manual', v_owner);
  update public.member_tags set created_at = v_old - interval '30 days'
    where gym_id = v_gym and profile_id = v_m4 and label = 'VIP';

  -- m3: gains VIP from a rule. A live comp makes them an intro.
  insert into public.comp_grants (gym_id, profile_id, starts_at, ends_at, granted_by, reason)
    values (v_gym, v_m3, now() - interval '1 day', now() + interval '30 days', v_owner, 'trial');
  insert into public.tag_rules (gym_id, label, color, predicate_kind, created_by)
    values (v_gym, 'VIP', '#F59E0B', 'intro', v_owner);

  perform public.recompute_auto_tags();

  -- Shift m3's rule-applied tag an hour into the past. now() is frozen per
  -- transaction, so without this a delete-and-reinsert recompute would
  -- coincidentally reproduce the same created_at and test 6 couldn't tell
  -- the difference.
  update public.member_tags set created_at = created_at - interval '1 hour'
    where gym_id = v_gym and profile_id = v_m3 and label = 'VIP';

  perform public.enqueue_due_automation_runs();

  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.a', v_a::text, true);
  perform set_config('test.a_blank', v_a_blank::text, true);
  perform set_config('test.m1', v_m1::text, true);
  perform set_config('test.m2', v_m2::text, true);
  perform set_config('test.m3', v_m3::text, true);
  perform set_config('test.m4', v_m4::text, true);
  perform set_config('test.m3_tagged_at',
    (select created_at from public.member_tags
      where gym_id = v_gym and profile_id = v_m3 and label = 'VIP')::text, true);
end $$;

-- 1. A manually applied tag fires the automation.
select is(
  (select count(*)::int from public.email_automation_runs
    where automation_id = current_setting('test.a')::uuid
      and subject_profile_id = current_setting('test.m1')::uuid),
  1, 'manual tag enqueues a run');

-- 2. A rule-applied tag fires it too.
select is(
  (select count(*)::int from public.email_automation_runs
    where automation_id = current_setting('test.a')::uuid
      and subject_profile_id = current_setting('test.m3')::uuid),
  1, 'rule-applied tag enqueues a run');

-- 3. A tag gained before the automation existed does not fire.
select is(
  (select count(*)::int from public.email_automation_runs
    where automation_id = current_setting('test.a')::uuid
      and subject_profile_id = current_setting('test.m4')::uuid),
  0, 'a pre-existing tag is not back-filled');

-- 4. Exactly the two eligible members were enqueued.
select is(
  (select count(*)::int from public.email_automation_runs
    where automation_id = current_setting('test.a')::uuid),
  2, 'only the two members who gained the tag are enqueued');

-- 5. A blank params.tag matches nobody rather than everybody.
select is(
  (select count(*)::int from public.email_automation_runs
    where automation_id = current_setting('test.a_blank')::uuid),
  0, 'an automation with no tag configured enqueues nothing');

-- 6. The incremental recompute leaves a surviving auto tag's created_at
--    untouched — the anchor member_tagged depends on.
do $$
begin
  perform public.recompute_auto_tags();
end $$;
select is(
  (select created_at from public.member_tags
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.m3')::uuid
      and label = 'VIP')::text,
  current_setting('test.m3_tagged_at'),
  'recompute preserves created_at for a tag the member still holds');

-- 7. Re-running the sweep after the recompute adds nothing.
do $$
begin
  perform public.enqueue_due_automation_runs();
end $$;
select is(
  (select count(*)::int from public.email_automation_runs
    where automation_id = current_setting('test.a')::uuid),
  2, 'recompute plus re-sweep does not duplicate runs');

-- 8. Losing and regaining the tag does not re-send: the idempotency key has
--    no date segment, so one send per member per automation, ever.
do $$
declare
  v_gym uuid := current_setting('test.gym')::uuid;
  v_m1  uuid := current_setting('test.m1')::uuid;
begin
  delete from public.member_tags
    where gym_id = v_gym and profile_id = v_m1 and label = 'VIP';
  insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
    select v_gym, v_m1, 'VIP', '#F59E0B', 'manual', profile_id
    from public.gym_memberships where gym_id = v_gym and role = 'owner' limit 1;
  perform public.enqueue_due_automation_runs();
end $$;
select is(
  (select count(*)::int from public.email_automation_runs
    where automation_id = current_setting('test.a')::uuid
      and subject_profile_id = current_setting('test.m1')::uuid),
  1, 'a regained tag never re-sends');

select * from finish();
rollback;
