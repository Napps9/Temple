-- The avatars storage policy enforces that a member can only write
-- under their OWN <profile_id>/ folder. A write to <other_uid>/...
-- raises new row violates row-level security policy.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_a uuid := _test_mk_user('a@avstore.test');
  v_b uuid := _test_mk_user('b@avstore.test');
  v_gym uuid := _test_mk_gym('Avstore', 'avstore');
begin
  perform _test_mk_membership(v_gym, v_a, 'member');
  perform _test_mk_membership(v_gym, v_b, 'member');

  perform set_config('test.a', v_a::text, true);
  perform set_config('test.b', v_b::text, true);

  perform _test_act_as(v_a);
end;
$$;

-- Writing to own folder succeeds.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner, metadata)
     values ('avatars',
             current_setting('test.a')::text || '/me.jpg',
             current_setting('test.a')::uuid,
             '{}'::jsonb)
  $$,
  'member can write to their own avatar folder'
);

-- Writing to another member's folder is rejected by RLS.
select throws_like(
  $$ insert into storage.objects (bucket_id, name, owner, metadata)
     values ('avatars',
             current_setting('test.b')::text || '/me.jpg',
             current_setting('test.a')::uuid,
             '{}'::jsonb)
  $$,
  '%row-level security%',
  'member cannot write to another member''s avatar folder'
);

select * from finish();
rollback;
