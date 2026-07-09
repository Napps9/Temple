-- purge_expired_waiver_signatures() deletes a signature 6 years after the
-- member's membership ended, and spares active members and recent leavers.

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@wpurge.test');
  v_old    uuid := _test_mk_user('old@wpurge.test');    -- left 7 years ago
  v_recent uuid := _test_mk_user('recent@wpurge.test'); -- left 1 month ago
  v_gym    uuid := _test_mk_gym('Purge Gym', 'wpurge');
  v_w1     uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_old,    'member');
  perform _test_mk_membership(v_gym, v_recent, 'member');

  -- Active waiver + a signature per member (direct inserts as the test
  -- superuser, mirroring health_data_erasure.sql — no role switch needed).
  insert into public.waiver_documents (gym_id, version, file_path, file_url, published_by)
    values (v_gym, 1, v_gym || '/w1.pdf', 'https://example.com/w1.pdf', v_owner)
    returning id into v_w1;

  insert into public.waiver_signatures (gym_id, profile_id, waiver_id, signature)
    values
      (v_gym, v_old,    v_w1, '{"paths":["M0 0 L1 1"],"width":10,"height":10}'::jsonb),
      (v_gym, v_recent, v_w1, '{"paths":["M0 0 L1 1"],"width":10,"height":10}'::jsonb);

  -- One member left 7 years ago (past the 6-year window), one last month.
  update public.gym_memberships set left_at = now() - interval '7 years'
    where gym_id = v_gym and profile_id = v_old;
  update public.gym_memberships set left_at = now() - interval '1 month'
    where gym_id = v_gym and profile_id = v_recent;

  perform set_config('test.old',    v_old::text,    true);
  perform set_config('test.recent', v_recent::text, true);
end $$;

-- The purge returns the number of rows it deleted (exactly the old member's).
select is(
  public.purge_expired_waiver_signatures(),
  1,
  'purge deletes exactly the signature whose membership ended over 6 years ago'
);

select is(
  (select count(*) from public.waiver_signatures
     where profile_id = current_setting('test.old')::uuid)::int,
  0,
  'a signature 6+ years past the membership end is purged'
);

select is(
  (select count(*) from public.waiver_signatures
     where profile_id = current_setting('test.recent')::uuid)::int,
  1,
  'a recent leaver''s signature is spared'
);

select * from finish();
rollback;
