-- Cross-tenant DM isolation. A third party (member C) cannot read
-- the DMs between member A and member B even when they're in the
-- same gym.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@dm.test');
  v_a     uuid := _test_mk_user('a@dm.test');
  v_b     uuid := _test_mk_user('b@dm.test');
  v_c     uuid := _test_mk_user('c@dm.test');
  v_gym   uuid := _test_mk_gym('DM Gym', 'dm-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_a,     'member');
  perform _test_mk_membership(v_gym, v_b,     'member');
  perform _test_mk_membership(v_gym, v_c,     'member');

  -- Two DMs between A and B (default full_gym scope).
  insert into public.direct_messages (gym_id, sender_id, recipient_id, body)
    values
      (v_gym, v_a, v_b, 'hey'),
      (v_gym, v_b, v_a, 'sup');

  perform set_config('test.a', v_a::text, true);
  perform set_config('test.c', v_c::text, true);
end;
$$;

-- Member A sees their own thread (both directions).
do $$
begin
  perform _test_act_as(current_setting('test.a')::uuid);
end;
$$;

select is(
  (select count(*) from public.direct_messages)::int,
  2,
  'member A sees both DMs in their thread with B'
);

-- Member C cannot see any of them.
do $$
begin
  perform _test_act_as(current_setting('test.c')::uuid);
end;
$$;

select is(
  (select count(*) from public.direct_messages)::int,
  0,
  'member C cannot SELECT any of A''s DMs with B'
);

select * from finish();
rollback;
