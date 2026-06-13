-- Phase 4a: tiered email preferences. The audience resolver now
-- honours a per-topic suppression alongside the blanket one. NULL-
-- topic campaigns preserve the legacy (blanket-only) behaviour so
-- existing comms keep flowing.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@topics.test');
  v_m1       uuid := _test_mk_user('m1@topics.test');
  v_m2       uuid := _test_mk_user('m2@topics.test');
  v_m3       uuid := _test_mk_user('m3@topics.test');
  v_gym      uuid := _test_mk_gym('Topics Gym', 'topics-gym');
  v_t_news   uuid;
  v_t_promo  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner,  'owner');
  perform _test_mk_membership(v_gym, v_m1,     'member');
  perform _test_mk_membership(v_gym, v_m2,     'member');
  perform _test_mk_membership(v_gym, v_m3,     'member');

  -- Two topics on this gym.
  insert into public.gym_email_topics (gym_id, label) values
    (v_gym, 'Newsletter'),
    (v_gym, 'Promos');
  select id into v_t_news  from public.gym_email_topics where gym_id = v_gym and label = 'Newsletter';
  select id into v_t_promo from public.gym_email_topics where gym_id = v_gym and label = 'Promos';

  -- m1: blanket unsub (legacy semantics — gets nothing).
  insert into public.email_unsubscribes (gym_id, email, profile_id, topic_id)
    values (v_gym, 'm1@topics.test', v_m1, null);

  -- m2: per-topic unsub from Promos only.
  insert into public.email_unsubscribes (gym_id, email, profile_id, topic_id)
    values (v_gym, 'm2@topics.test', v_m2, v_t_promo);

  -- m3: nothing — receives everything.

  perform set_config('test.gym',     v_gym::text,     true);
  perform set_config('test.owner',   v_owner::text,   true);
  perform set_config('test.t_news',  v_t_news::text,  true);
  perform set_config('test.t_promo', v_t_promo::text, true);
end $$;

do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

-- 1. Newsletter audience (manual cohort over all gym members):
--    m1 suppressed (blanket), m2 receives (unsubbed only from Promos),
--    m3 receives, owner receives → 3 recipients.
select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object('kind', 'cohorts',
                        'cohorts', jsonb_build_array('intro', 'active',
                                                     'paying', 'expiring_soon',
                                                     'expired')),
     current_setting('test.t_news')::uuid)),
  0,
  'no audience members today (no plan / cohort fixtures) — sanity check before manual cohort'
);

-- 2. Manual cohort — explicit profile list. comms_audience_rows
--    filters its base CTE to role = 'member', so the owner is
--    excluded even when listed.
select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object(
       'kind', 'manual',
       'profile_ids', jsonb_build_array(
         current_setting('test.owner')::text,
         (select id::text from auth.users where email = 'm1@topics.test'),
         (select id::text from auth.users where email = 'm2@topics.test'),
         (select id::text from auth.users where email = 'm3@topics.test')
       )),
     current_setting('test.t_news')::uuid)),
  2,
  'newsletter audience: owner filtered by role; m1 blanket; m2 + m3 receive'
);

-- 3. Promos audience — m1 blanket, m2 per-topic; only m3 receives.
select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object(
       'kind', 'manual',
       'profile_ids', jsonb_build_array(
         current_setting('test.owner')::text,
         (select id::text from auth.users where email = 'm1@topics.test'),
         (select id::text from auth.users where email = 'm2@topics.test'),
         (select id::text from auth.users where email = 'm3@topics.test')
       )),
     current_setting('test.t_promo')::uuid)),
  1,
  'promos audience: m1 blanket + m2 per-topic suppressed; only m3 receives'
);

-- 4. NULL-topic (legacy / no topic chosen): only blanket suppressions
--    win — m1 is out; m2 receives because per-topic unsub doesn't
--    fire on a NULL-topic campaign.
select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object(
       'kind', 'manual',
       'profile_ids', jsonb_build_array(
         current_setting('test.owner')::text,
         (select id::text from auth.users where email = 'm1@topics.test'),
         (select id::text from auth.users where email = 'm2@topics.test'),
         (select id::text from auth.users where email = 'm3@topics.test')
       )),
     null::uuid)),
  2,
  'NULL-topic campaign: only blanket unsub applies (m2 + m3 receive)'
);

-- 5. The two-arg compat wrapper (no topic arg) matches the NULL-topic
--    behaviour.
select is(
  (select count(*)::int from public.comms_audience_rows(
     current_setting('test.gym')::uuid,
     jsonb_build_object(
       'kind', 'manual',
       'profile_ids', jsonb_build_array(
         current_setting('test.owner')::text,
         (select id::text from auth.users where email = 'm1@topics.test'),
         (select id::text from auth.users where email = 'm2@topics.test'),
         (select id::text from auth.users where email = 'm3@topics.test')
       )))),
  2,
  'two-arg compat wrapper behaves the same as topic = null'
);

select * from finish();
rollback;
