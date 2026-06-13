-- Phase 4b member-self-service RPCs:
-- list_my_email_preferences, set_my_email_topic_subscription,
-- set_my_email_blanket_unsub.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@mep.test');
  v_m      uuid := _test_mk_user('m@mep.test');
  v_other  uuid := _test_mk_user('o@mep.test');
  v_gym    uuid := _test_mk_gym('MEP Gym', 'mep-gym');
  v_t_news uuid;
  v_t_prom uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_m,     'member');
  -- v_other has no membership: every RPC should refuse.

  insert into public.gym_email_topics (gym_id, label) values
    (v_gym, 'Newsletter'),
    (v_gym, 'Promos');
  select id into v_t_news from public.gym_email_topics
    where gym_id = v_gym and label = 'Newsletter';
  select id into v_t_prom from public.gym_email_topics
    where gym_id = v_gym and label = 'Promos';

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.m',      v_m::text,      true);
  perform set_config('test.other',  v_other::text,  true);
  perform set_config('test.t_news', v_t_news::text, true);
  perform set_config('test.t_prom', v_t_prom::text, true);
end $$;

-- 1. New member: both topics subscribed, blanket off.
do $$ begin perform _test_act_as(current_setting('test.m')::uuid); end $$;

select is(
  (select count(*)::int from public.list_my_email_preferences(
     current_setting('test.gym')::uuid)
   where subscribed and not blanket_unsub),
  2,
  'a fresh member is subscribed to every topic by default'
);

-- 2. Unsubscribe from Promos.
do $$ begin
  perform set_my_email_topic_subscription(
    current_setting('test.gym')::uuid,
    current_setting('test.t_prom')::uuid,
    false);
end $$;

select is(
  (select subscribed from public.list_my_email_preferences(
     current_setting('test.gym')::uuid)
   where topic_id = current_setting('test.t_prom')::uuid),
  false,
  'set_my_email_topic_subscription(false) flips the Promos row to unsubscribed'
);

-- 3. Blanket unsub: every topic shows subscribed = false.
do $$ begin
  perform set_my_email_blanket_unsub(
    current_setting('test.gym')::uuid, true);
end $$;

select is(
  (select count(*)::int from public.list_my_email_preferences(
     current_setting('test.gym')::uuid)
   where subscribed),
  0,
  'blanket unsub: every topic reports subscribed = false'
);

-- 4. Re-subscribe to Newsletter: clears blanket and the per-topic row.
do $$ begin
  perform set_my_email_topic_subscription(
    current_setting('test.gym')::uuid,
    current_setting('test.t_news')::uuid,
    true);
end $$;

select is(
  (select blanket_unsub from public.list_my_email_preferences(
     current_setting('test.gym')::uuid)
   where topic_id = current_setting('test.t_news')::uuid),
  false,
  'subscribing to any topic clears the blanket row'
);

select is(
  (select subscribed from public.list_my_email_preferences(
     current_setting('test.gym')::uuid)
   where topic_id = current_setting('test.t_news')::uuid),
  true,
  'Newsletter is subscribed again after the targeted re-subscribe'
);

-- 5. A non-member is refused.
do $$ begin perform _test_act_as(current_setting('test.other')::uuid); end $$;

select throws_like(
  format(
    'select set_my_email_topic_subscription(%L::uuid, %L::uuid, true)',
    current_setting('test.gym'),
    current_setting('test.t_news')
  ),
  '%Not a member%',
  'a non-member cannot set their own topic preferences for a gym they don''t belong to'
);

select * from finish();
rollback;
