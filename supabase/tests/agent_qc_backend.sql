-- AI front desk QC backend (0137): capability gate, owner-only voice +
-- recording setters, capability-gated coaching corrections with tenancy
-- guard, recording RLS, and the playback audit log.

begin;
select plan(14);

\ir _helpers.psql

do $$
declare
  v_owner  uuid := _test_mk_user('owner@qc.test');
  v_admin  uuid := _test_mk_user('admin@qc.test');
  v_coach  uuid := _test_mk_user('coach@qc.test');
  v_member uuid := _test_mk_user('member@qc.test');
  v_gym    uuid := _test_mk_gym('QC Gym', 'qc-gym');
  v_gym_b  uuid := _test_mk_gym('QC Gym B', 'qc-gym-b');
  v_owner_b uuid := _test_mk_user('owner-b@qc.test');
  v_conv   uuid;
  v_conv_b uuid;
  v_rec    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym_b, v_owner_b, 'owner');

  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym, '+447700900500', 'voice') returning id into v_conv;
  insert into public.agent_conversations (gym_id, phone, channel)
  values (v_gym_b, '+447700900501', 'voice') returning id into v_conv_b;
  insert into public.call_recordings (gym_id, conversation_id, recording_path, duration_seconds)
  values (v_gym, v_conv, v_gym || '/' || v_conv || '/rec.mp3', 141) returning id into v_rec;

  perform set_config('test.gym',    v_gym::text,    true);
  perform set_config('test.gym_b',  v_gym_b::text,  true);
  perform set_config('test.conv',   v_conv::text,   true);
  perform set_config('test.conv_b', v_conv_b::text, true);
  perform set_config('test.rec',    v_rec::text,    true);
  perform set_config('test.owner',  v_owner::text,  true);
  perform set_config('test.admin',  v_admin::text,  true);
  perform set_config('test.coach',  v_coach::text,  true);
end $$;

-- 1-3. Capability defaults for can_review_ai_calls.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select ok(
  public.effective_can(current_setting('test.gym')::uuid, 'can_review_ai_calls'),
  'owner can review AI calls'
);
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select ok(
  public.effective_can(current_setting('test.gym')::uuid, 'can_review_ai_calls'),
  'admin can review AI calls'
);
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select ok(
  not public.effective_can(current_setting('test.gym')::uuid, 'can_review_ai_calls'),
  'a coach cannot review AI calls'
);

-- 4. Voice selection is owner-only.
select throws_like(
  $$ select set_gym_agent_voice_selection(current_setting('test.gym')::uuid, '11labs', 'JBFqnCBsd6RMkjVDRZzb', 'UK, RP') $$,
  '%owner%',
  'a coach cannot change the voice selection'
);

-- 5. Owner sets a voice.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
do $$ begin
  perform set_gym_agent_voice_selection(current_setting('test.gym')::uuid, '11labs', 'JBFqnCBsd6RMkjVDRZzb', 'UK, RP');
end $$;
reset role;
select is(
  (select voice_id from public.gym_agent_settings where gym_id = current_setting('test.gym')::uuid),
  'JBFqnCBsd6RMkjVDRZzb',
  'owner voice selection persists'
);

-- 6. Recording retention floor.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;
select throws_like(
  $$ select set_gym_call_recording(current_setting('test.gym')::uuid, true, 10) $$,
  '%at least 30 days%',
  'recording retention below 30 days is rejected'
);

-- 7. Owner sets recording controls.
do $$ begin
  perform set_gym_call_recording(current_setting('test.gym')::uuid, true, 60);
end $$;
reset role;
select is(
  (select call_recording_retention_days from public.gym_agent_settings
   where gym_id = current_setting('test.gym')::uuid),
  60,
  'owner recording retention persists'
);

-- 8. Corrections require the reviewing capability.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  format($$ select record_agent_corrections(%L::uuid, %L::jsonb) $$,
         current_setting('test.gym'),
         '[{"correction":"Always quote the annual plan","scope":"standing_rule","field_kind":"rule"}]'),
  '%authorised%',
  'a coach cannot record coaching corrections'
);

-- 9. Admin records a correction.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
do $$ begin
  perform record_agent_corrections(
    current_setting('test.gym')::uuid,
    format('[{"correction":"Offer the intro before ending","scope":"standing_rule","field_kind":"rule","conversation_id":"%s"}]',
           current_setting('test.conv'))::jsonb);
end $$;
reset role;
select is(
  (select count(*)::int from public.agent_coaching_corrections
   where gym_id = current_setting('test.gym')::uuid),
  1,
  'admin coaching correction is stored'
);

-- 10. Cross-tenant guard: a correction can't cite another gym's conversation.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select throws_like(
  format($$ select record_agent_corrections(%L::uuid, %L::jsonb) $$,
         current_setting('test.gym'),
         format('[{"correction":"x","conversation_id":"%s"}]', current_setting('test.conv_b'))),
  '%does not belong%',
  'a correction citing another gym''s conversation is rejected'
);

-- 11-12. Recording RLS.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
select is(
  (select count(*)::int from public.call_recordings where gym_id = current_setting('test.gym')::uuid),
  1,
  'a reviewer sees the gym recording'
);
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select is(
  (select count(*)::int from public.call_recordings where gym_id = current_setting('test.gym')::uuid),
  0,
  'a coach without the capability sees no recordings'
);

-- 13. Playback is audited by a reviewer.
do $$ begin perform _test_act_as(current_setting('test.admin')::uuid); end $$;
do $$ begin
  perform log_recording_access(
    current_setting('test.gym')::uuid, current_setting('test.rec')::uuid, 'call-review');
end $$;
reset role;
select is(
  (select count(*)::int from public.agent_recording_access_log
   where recording_id = current_setting('test.rec')::uuid),
  1,
  'playback writes an access-log row'
);

-- 14. A coach cannot log (or fake) playback access.
do $$ begin perform _test_act_as(current_setting('test.coach')::uuid); end $$;
select throws_like(
  format($$ select log_recording_access(%L::uuid, %L::uuid, 'x') $$,
         current_setting('test.gym'), current_setting('test.rec')),
  '%authorised%',
  'a coach cannot write to the recording access log'
);

select * from finish();
rollback;
