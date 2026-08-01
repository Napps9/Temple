-- A cover offer you can take from the Timeline (0243).
--
-- The feed has carried `cover_requested` since 0204 and gated it on
-- can_claim_cover — exactly the coaches who could take it. What it
-- carried was a count, which is a thing to read. It now carries the
-- offers, which is a thing to do.
--
-- The two filters are what the assertions are mostly about: a claimed
-- offer belongs to somebody else and a past class cannot be covered, so
-- either one riding along would be a button whose only outcome is an
-- error message.

begin;
select plan(7);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@offer.test');
  v_asker uuid := _test_mk_user('asker@offer.test');
  v_taker uuid := _test_mk_user('taker@offer.test');
  v_gym   uuid := _test_mk_gym('Offer Gym', 'offer-gym');
  v_soon  uuid;
  v_later uuid;
  v_gone  uuid;
  v_taken uuid;
  v_req   uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_asker, 'coach');
  perform _test_mk_membership(v_gym, v_taker, 'coach');

  v_soon  := _test_mk_session(v_gym, v_asker, now() + interval '2 days');
  v_later := _test_mk_session(v_gym, v_asker, now() + interval '5 days');
  -- Already ran. Covering it is not a thing that can happen.
  v_gone  := _test_mk_session(v_gym, v_asker, now() - interval '2 days');
  -- Somebody already picked this one up.
  v_taken := _test_mk_session(v_gym, v_asker, now() + interval '3 days');

  insert into public.cover_requests
    (gym_id, requested_by, status, range_start, range_end)
    values (v_gym, v_asker, 'open',
            current_date - 3, current_date + 6)
    returning id into v_req;
  insert into public.cover_request_sessions
    (request_id, gym_id, class_session_id, original_coach_id, claimed_by)
  values
    (v_req, v_gym, v_soon,  v_asker, null),
    (v_req, v_gym, v_later, v_asker, null),
    (v_req, v_gym, v_gone,  v_asker, null),
    (v_req, v_gym, v_taken, v_asker, v_taker);

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.asker', v_asker::text, true);
  perform set_config('test.taker', v_taker::text, true);
  perform set_config('test.soon',  v_soon::text,  true);
end $$;

-- ---------------------------------------------------------------------------
-- What rides along
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.taker')::uuid);

select is(
  (select jsonb_array_length(detail->'open_sessions')
     from timeline_feed(current_setting('test.gym')::uuid,
                        now() + interval '1 day', 100)
    where kind = 'cover_requested'),
  2,
  'the offers ride along, so the card has something to claim'
);

select is(
  (select count(*)::int
     from timeline_feed(current_setting('test.gym')::uuid,
                        now() + interval '1 day', 100) t,
          jsonb_array_elements(t.detail->'open_sessions') o
    where t.kind = 'cover_requested'
      and (o->>'starts_at')::timestamptz < now()),
  0,
  'a class that already ran is never offered — that button can only fail'
);

select is(
  (select count(*)::int
     from timeline_feed(current_setting('test.gym')::uuid,
                        now() + interval '1 day', 100) t,
          jsonb_array_elements(t.detail->'open_sessions') o
    where t.kind = 'cover_requested'
      and o->>'offer_id' in (
        select id::text from public.cover_request_sessions
         where claimed_by is not null)),
  0,
  'nor one somebody else has already taken'
);

-- The count is unchanged: it counts the whole request, which is what the
-- sentence about it says, and is a different number from what is open.
select is(
  (select (detail->>'class_count')::int
     from timeline_feed(current_setting('test.gym')::uuid,
                        now() + interval '1 day', 100)
    where kind = 'cover_requested'),
  4,
  'the count still counts the request, not what is left of it'
);

select is(
  (select detail->>'requested_by'
     from timeline_feed(current_setting('test.gym')::uuid,
                        now() + interval '1 day', 100)
    where kind = 'cover_requested'),
  current_setting('test.asker'),
  'and who asked, so the card can leave the buttons off their own request'
);

-- ---------------------------------------------------------------------------
-- Claiming from it is the same claim
-- ---------------------------------------------------------------------------
--
-- This migration moved where an offer is seen. It did not make claiming
-- safer, fairer or different, and these two prove the rules still bite
-- from the new surface.

select lives_ok(
  format(
    $$ select claim_cover(
         (select id from public.cover_request_sessions
           where class_session_id = %L::uuid)) $$,
    current_setting('test.soon')
  ),
  'a coach can take an offer straight from the feed'
);

select _test_act_as(current_setting('test.asker')::uuid);
select throws_ok(
  $$ select claim_cover(
       (select id from public.cover_request_sessions
         where claimed_by is null limit 1)) $$,
  'You cannot cover your own class',
  'and still cannot take their own class, which is why the card hides it'
);

select finish();
rollback;
