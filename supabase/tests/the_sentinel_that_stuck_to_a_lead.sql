-- 0292: a lead whose stored phone cannot be dialled can be corrected.
--
-- Every browser call at a gym shares one agent_conversations row, because
-- there is no caller id to key it by. That row's lead_id points at the
-- first lead ever captured on it, so every later call takes the dedup
-- branch — and before this migration that branch could not replace a
-- phone, only fill an empty one. A row carrying the pre-0289 'web-test'
-- sentinel was therefore untextable forever, which is exactly what it was.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@sentinel.test');
  v_coach uuid := _test_mk_user('coach@sentinel.test');
  v_gym   uuid := _test_mk_gym('Sentinel Gym', 'sentinel-gym');
  v_conv  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  -- The browser-call thread: one row per gym, no caller id.
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, 'web-test', 'voice') returning id into v_conv;
  perform set_config('test.gym',  v_gym::text,  true);
  perform set_config('test.conv', v_conv::text, true);
end $$;

-- 1-2. First call: a name, no number yet. The sentinel must not reach the
--      lead — that is 0289 — and there is nothing to text.
do $$
declare v_id uuid;
begin
  v_id := public.agent_capture_lead(current_setting('test.conv')::uuid, 'Nick');
  perform set_config('test.lead', v_id::text, true);
end $$;
select is(
  (select phone from public.leads where id = current_setting('test.lead')::uuid),
  null,
  'a browser call with no number leaves the lead phone null'
);
select is(
  (select lead_id from public.agent_conversations
    where id = current_setting('test.conv')::uuid),
  current_setting('test.lead')::uuid,
  'the shared thread is linked to that lead'
);

-- 3. Later in the same call they read their mobile out. The dedup branch
--    fills the empty phone — the case 0289 already handled.
do $$ begin
  perform public.agent_capture_lead(
    current_setting('test.conv')::uuid, 'Nick', null, null, '07717 503791');
end $$;
select is(
  (select phone from public.leads where id = current_setting('test.lead')::uuid),
  '+447717503791',
  'a number given later fills the empty phone'
);

-- 4-5. THE ONE THIS MIGRATION IS FOR. A lead carrying the old sentinel is
--      corrected by the next number somebody gives, rather than keeping a
--      value no sender can use.
do $$ begin
  update public.leads set phone = 'web-test'
   where id = current_setting('test.lead')::uuid;
  perform public.agent_capture_lead(
    current_setting('test.conv')::uuid, 'Nick', null, null, '07900 111222');
end $$;
select is(
  (select phone from public.leads where id = current_setting('test.lead')::uuid),
  '+447900111222',
  'a stored value that cannot be dialled is replaced'
);
select is(
  (select count(*)::int from public.leads
    where gym_id = current_setting('test.gym')::uuid),
  1,
  'and it corrects the lead rather than starting another'
);

-- 6. A number somebody typed by hand parses, so it is left exactly as they
--    typed it. 0270's argument: staff should keep seeing what they wrote.
do $$ begin
  update public.leads set phone = '07717 503791'
   where id = current_setting('test.lead')::uuid;
  perform public.agent_capture_lead(
    current_setting('test.conv')::uuid, 'Nick', null, null, '07900 111222');
end $$;
select is(
  (select phone from public.leads where id = current_setting('test.lead')::uuid),
  '07717 503791',
  'a dialable phone is not rewritten by a later capture'
);

select * from finish();
rollback;
