-- create_gym: caller becomes the owner of the new gym, slug is
-- lowercased + cleaned, and a second call with the same slug fails.

begin;
select plan(4);

\ir _helpers.psql

do $$
declare
  v_user uuid := _test_mk_user('founder@cg.test');
  v_gym  uuid;
begin
  perform _test_act_as(v_user);
  v_gym := public.create_gym('Iron Temple', 'Iron-Temple-2026');
  perform set_config('test.user', v_user::text, true);
  perform set_config('test.gym',  v_gym::text,  true);
end;
$$;

select is(
  (select role::text from public.gym_memberships
    where gym_id = current_setting('test.gym')::uuid
      and profile_id = current_setting('test.user')::uuid),
  'owner',
  'caller is recorded as the owner of the new gym'
);

select is(
  (select slug from public.gyms
    where id = current_setting('test.gym')::uuid),
  'iron-temple-2026',
  'slug is lowercased and stripped'
);

-- A second call with the same slug fails.
select throws_like(
  $$ select public.create_gym('Other', 'iron-temple-2026') $$,
  '%Slug already taken%',
  'duplicate slug is rejected'
);

-- Empty slug fails.
select throws_like(
  $$ select public.create_gym('No slug gym', '') $$,
  '%Slug must contain%',
  'empty slug is rejected'
);

select * from finish();
rollback;
