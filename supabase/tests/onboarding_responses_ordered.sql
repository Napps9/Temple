-- Responses inserted in arbitrary order render in display_order on
-- read. The staff-side member detail page relies on this ORDER BY.

begin;
select plan(2);

\ir _helpers.sql

do $$
declare
  v_owner uuid := _test_mk_user('owner@onbord.test');
  v_gym   uuid := _test_mk_gym('Onbord', 'onbord');
  v_member uuid := _test_mk_user('m@onbord.test');
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');

  insert into public.onboarding_responses
    (gym_id, profile_id, question_key, question_text, answer, display_order)
  values
    (v_gym, v_member, 'goals', 'What are your goals?', 'Get strong', 3),
    (v_gym, v_member, 'kit',   'Kit size?',           'M',          1),
    (v_gym, v_member, 'hear',  'How did you hear?',   'Friend',     2);

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.member', v_member::text, true);
end;
$$;

select results_eq(
  $$
    select question_key from public.onboarding_responses
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid
    order by display_order
  $$,
  $$ values ('kit'::text), ('hear'::text), ('goals'::text) $$,
  'responses returned in display_order, not insertion order'
);

select is(
  (select count(*)::int from public.onboarding_responses
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.member')::uuid),
  3,
  'three responses stored'
);

select * from finish();
rollback;
