-- Stopping a send that is already going out (0228)
--
-- The window is real: eight at a time through a queue a thousand long
-- means an owner who spots a wrong price thirty seconds in has time to
-- act, and until now had no way to use it. What the test pins is the
-- shape of what stopping can do — the queued are skipped, the sent stay
-- sent, and the campaign ends 'cancelled' rather than claiming everyone
-- or nobody got it.

begin;
select plan(10);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@stopsend.test');
  v_coach uuid := _test_mk_user('coach@stopsend.test');
  v_gym   uuid := _test_mk_gym('Stop Gym', 'stopsend');
  v_going uuid;
  v_sched uuid;
  v_done  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');

  insert into public.email_campaigns (gym_id, created_by, title, subject, status)
  values (v_gym, v_owner, 'Christmas hours', 'Christmas hours', 'sending')
  returning id into v_going;

  insert into public.email_campaigns (gym_id, created_by, title, subject, status,
                                      scheduled_for)
  values (v_gym, v_owner, 'New year', 'New year', 'scheduled',
          now() + interval '2 days')
  returning id into v_sched;

  insert into public.email_campaigns (gym_id, created_by, title, subject, status)
  values (v_gym, v_owner, 'Old one', 'Old one', 'sent')
  returning id into v_done;

  -- Two already gone, three still waiting.
  insert into public.email_campaign_recipients
    (campaign_id, gym_id, email, status)
  values
    (v_going, v_gym, 'a@stopsend.test', 'sent'),
    (v_going, v_gym, 'b@stopsend.test', 'delivered'),
    (v_going, v_gym, 'c@stopsend.test', 'queued'),
    (v_going, v_gym, 'd@stopsend.test', 'queued'),
    (v_going, v_gym, 'e@stopsend.test', 'queued');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.going', v_going::text, true);
  perform set_config('test.sched', v_sched::text, true);
  perform set_config('test.done',  v_done::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- Who may
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.coach')::uuid);

select throws_ok(
  format('select public.comms_stop_campaign(%L::uuid)', current_setting('test.going')),
  null, 'Not authorised',
  'a coach without can_manage_comms cannot stop a send'
);

-- ---------------------------------------------------------------------------
-- Only a send that is actually going out
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

select throws_ok(
  format('select public.comms_stop_campaign(%L::uuid)', current_setting('test.sched')),
  null, 'That campaign is not going out right now',
  'a scheduled send is called off, not stopped — it has its own verb and a better outcome'
);

select throws_ok(
  format('select public.comms_stop_campaign(%L::uuid)', current_setting('test.done')),
  null, 'That campaign is not going out right now',
  'and one that has finished cannot be stopped at all'
);

-- ---------------------------------------------------------------------------
-- Stopping one
-- ---------------------------------------------------------------------------

select is(
  public.comms_stop_campaign(current_setting('test.going')::uuid),
  3,
  'stopping it reports the three who will not get it'
);

select is(
  (select status from public.email_campaigns
     where id = current_setting('test.going')::uuid),
  'cancelled',
  'the campaign ends cancelled — it did send, partly, on purpose'
);

select is(
  (select count(*)::int from public.email_campaign_recipients
     where campaign_id = current_setting('test.going')::uuid
       and status = 'skipped'),
  3,
  'everyone still queued is skipped'
);

select ok(
  (select bool_and(error like '%stopped before this one went out%')
     from public.email_campaign_recipients
     where campaign_id = current_setting('test.going')::uuid
       and status = 'skipped'),
  'and the row says why, rather than looking like a delivery failure'
);

select is(
  (select count(*)::int from public.email_campaign_recipients
     where campaign_id = current_setting('test.going')::uuid
       and status in ('sent', 'delivered')),
  2,
  'the two who already had it keep it — there is no recall'
);

select is(
  (select count(*)::int from public.email_campaign_recipients
     where campaign_id = current_setting('test.going')::uuid
       and status = 'queued'),
  0,
  'and nothing is left queued to be picked up by a later run'
);

-- ---------------------------------------------------------------------------
-- Twice
-- ---------------------------------------------------------------------------

select throws_ok(
  format('select public.comms_stop_campaign(%L::uuid)', current_setting('test.going')),
  null, 'That campaign is not going out right now',
  'stopping an already-stopped send says so rather than pretending'
);

select * from finish();
rollback;
