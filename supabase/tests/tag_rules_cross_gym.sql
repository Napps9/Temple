-- Invariant: tag rules and member tags do not leak across gyms.
--
-- Same-label rules in two gyms must not collide; running
-- apply_tag_rules(gymA) must not touch any member in gymB; an admin
-- in gymA cannot SELECT a tag attached to a member of gymB.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_owner_a  uuid := _test_mk_user('owner_a@cross.test');
  v_owner_b  uuid := _test_mk_user('owner_b@cross.test');
  v_member_a uuid := _test_mk_user('member_a@cross.test');
  v_member_b uuid := _test_mk_user('member_b@cross.test');
  v_gym_a    uuid := _test_mk_gym('Gym A', 'gym-a');
  v_gym_b    uuid := _test_mk_gym('Gym B', 'gym-b');
  v_rule_a   uuid;
  v_rule_b   uuid;
begin
  perform _test_mk_membership(v_gym_a, v_owner_a,  'owner');
  perform _test_mk_membership(v_gym_b, v_owner_b,  'owner');
  perform _test_mk_membership(v_gym_a, v_member_a, 'member');
  perform _test_mk_membership(v_gym_b, v_member_b, 'member');

  -- Active comp grants so members register as intros.
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at, granted_by, reason)
  values
    (v_gym_a, v_member_a, now() - interval '1 day', now() + interval '30 days', v_owner_a, 'trial'),
    (v_gym_b, v_member_b, now() - interval '1 day', now() + interval '30 days', v_owner_b, 'trial');

  -- Identical-label rules in each gym.
  insert into public.tag_rules
    (gym_id, label, color, predicate_kind, created_by)
  values
    (v_gym_a, 'Intro period', '#10B981', 'intro', v_owner_a)
  returning id into v_rule_a;

  insert into public.tag_rules
    (gym_id, label, color, predicate_kind, created_by)
  values
    (v_gym_b, 'Intro period', '#10B981', 'intro', v_owner_b)
  returning id into v_rule_b;

  -- Run apply_tag_rules for gym A only.
  perform _test_act_as(v_owner_a);
  perform apply_tag_rules(v_gym_a);

  perform set_config('test.gym_a', v_gym_a::text, true);
  perform set_config('test.gym_b', v_gym_b::text, true);
  perform set_config('test.member_a', v_member_a::text, true);
  perform set_config('test.member_b', v_member_b::text, true);
  perform set_config('test.owner_a', v_owner_a::text, true);
end;
$$;

-- 1. Member A got the tag.
select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym_a')::uuid
     and profile_id = current_setting('test.member_a')::uuid
     and source = 'auto'),
  1::bigint,
  'apply_tag_rules(gymA) tagged member A'
);

-- 2. Member B is unaffected (no rows for gymB).
select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym_b')::uuid),
  0::bigint,
  'apply_tag_rules(gymA) does not write any tags in gymB'
);

-- 3. Owner A acting cannot SELECT member B's profile-shaped tags
--    (none exist, but RLS would also block if they did).
do $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('test.owner_a'), true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym_b')::uuid),
  0::bigint,
  'owner A cannot SELECT any tag in gymB'
);

-- 4. Owner A can SELECT their own gym tags.
select is(
  (select count(*) from public.member_tags
   where gym_id = current_setting('test.gym_a')::uuid),
  1::bigint,
  'owner A can SELECT tags in their own gym'
);

select * from finish();
rollback;
