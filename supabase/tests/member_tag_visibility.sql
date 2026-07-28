-- member_visible tags (0202): rule-applied tags inherit and follow the
-- rule's flag without re-anchoring created_at, and the tightened SELECT
-- policy means a member reads exactly their own visible tags — never
-- their hidden ones, never anyone else's — while tag staff still see all.
--
-- Fixture: m1 carries a visible manual 'VIP' and a hidden manual
-- 'Ghosting'; m2 carries a visible manual 'VIP' and gains 'Intro star'
-- from a member_visible rule via the recompute, whose flag is then
-- flipped off and recomputed again.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@tagvis.test');
  v_m1 uuid := _test_mk_user('m1@tagvis.test');
  v_m2 uuid := _test_mk_user('m2@tagvis.test');
  v_gym uuid := _test_mk_gym('Tag Vis Gym', 'tag-vis-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m1, 'member');
  perform _test_mk_membership(v_gym, v_m2, 'member');

  insert into public.member_tags (gym_id, profile_id, label, color, source, created_by, member_visible)
    values (v_gym, v_m1, 'VIP', '#F59E0B', 'manual', v_owner, true),
           (v_gym, v_m1, 'Ghosting', '#EF4444', 'manual', v_owner, false),
           (v_gym, v_m2, 'VIP', '#F59E0B', 'manual', v_owner, true);

  -- m2 becomes an intro (live comp) and gains the rule's visible tag.
  insert into public.comp_grants (gym_id, profile_id, starts_at, ends_at, granted_by, reason)
    values (v_gym, v_m2, now() - interval '1 day', now() + interval '30 days', v_owner, 'trial');
  insert into public.tag_rules (gym_id, label, color, predicate_kind, created_by, member_visible)
    values (v_gym, 'Intro star', '#10B981', 'intro', v_owner, true);

  perform public.recompute_auto_tags();

  perform set_config('test.vis_after_first',
    (select member_visible from public.member_tags
      where gym_id = v_gym and profile_id = v_m2 and label = 'Intro star')::text, true);

  -- Backdate so a delete-and-reinsert (same-transaction now() would hide
  -- it) cannot fake created_at stability.
  update public.member_tags set created_at = created_at - interval '1 hour'
    where gym_id = v_gym and profile_id = v_m2 and label = 'Intro star';
  perform set_config('test.anchor_before_flip',
    (select created_at from public.member_tags
      where gym_id = v_gym and profile_id = v_m2 and label = 'Intro star')::text, true);

  update public.tag_rules set member_visible = false
    where gym_id = v_gym and label = 'Intro star';
  perform public.recompute_auto_tags();

  perform set_config('test.gym', v_gym::text, true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.m1', v_m1::text, true);
  perform set_config('test.m2', v_m2::text, true);
end $$;

-- 1. The rule-applied tag inherited member_visible = true.
select is(
  current_setting('test.vis_after_first'), 'true',
  'a rule-applied tag inherits the rule''s member_visible');

-- 2. Flipping the rule's flag updates the tag in place.
select is(
  (select member_visible from public.member_tags
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.m2')::uuid
      and label = 'Intro star'),
  false,
  'a rule visibility flip reaches the existing tag');

-- 3. ...without touching created_at, the member_tagged anchor.
select is(
  (select created_at from public.member_tags
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.m2')::uuid
      and label = 'Intro star')::text,
  current_setting('test.anchor_before_flip'),
  'the visibility flip does not re-anchor created_at');

-- 4-5. A member reads exactly their own visible tags.
do $$
begin
  perform _test_act_as(current_setting('test.m1')::uuid);
end $$;

select is(
  (select coalesce(string_agg(label, ',' order by label), '')
    from public.member_tags
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.m1')::uuid),
  'VIP',
  'a member sees their own visible tag and not their hidden one');

select is(
  (select count(*)::int from public.member_tags
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.m2')::uuid),
  0,
  'a member sees nobody else''s tags, visible or not');

-- A member cannot flip their own hidden tag visible: the update policy is
-- capability-gated, so this matches zero rows (checked as owner in 6).
do $$
begin
  update public.member_tags set member_visible = true
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.m1')::uuid
      and label = 'Ghosting';
end $$;

-- 6-7. Tag staff still see and control everything.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
end $$;

select is(
  (select member_visible from public.member_tags
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.m1')::uuid
      and label = 'Ghosting'),
  false,
  'the member''s attempted self-reveal changed nothing');

select is(
  (select count(*)::int from public.member_tags
    where gym_id = current_setting('test.gym')::uuid),
  4,
  'tag staff still see every tag in the gym');

select * from finish();
rollback;
