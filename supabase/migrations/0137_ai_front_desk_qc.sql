-- AI front desk — call QC, coaching, and voice selection (the data side).
--
-- Builds on 0136. Three new capabilities for owners:
--
--   1. Call review (QC): voice calls are recorded (via the Vapi artifact) and
--      the recording is captured into a private Storage bucket at call-end.
--      call_recordings holds the pointer; per-turn timing lands on
--      agent_messages so the app can highlight the transcript in sync with
--      playback. Recordings are special-category-adjacent, so they get a
--      health-data-grade surround: an owner recording toggle + retention
--      window, an admin-only access audit log, a nightly purge that also
--      drops the Storage object, and a dedicated can_review_ai_calls
--      capability (owner/admin) gating every read.
--
--   2. Coaching that shapes the agent: agent_coaching_corrections stores the
--      owner's per-turn corrections and standing rules. The agent loop reads
--      them back and injects them into its system prompt on every future
--      call — the same look-aside pattern infer-import uses with
--      import_inference_corrections (0076), but PER-GYM, because these carry
--      gym-specific tone/policy and prospect PII rather than generic strings.
--
--   3. Voice selection: the owner's chosen {provider, voiceId, region} lives
--      on gym_agent_settings, applied to the gym's Vapi assistant.
--
-- Convention notes: new capability key added to default_capability's CASE
-- (owner/admin); every read gated through effective_can so per-gym overrides
-- still apply; writes only via owner-gated / capability-gated RPCs or the
-- service role; retention floor + purge sweep mirror lead_retention_days /
-- purge_expired_health_data.

begin;

-- ============================================================================
-- 1. gym_agent_settings — voice selection + recording controls
-- ============================================================================

alter table public.gym_agent_settings
  add column if not exists voice_provider text,
  add column if not exists voice_id text,
  add column if not exists voice_region text,
  add column if not exists call_recording_enabled boolean not null default true,
  add column if not exists call_recording_retention_days integer not null default 90
    check (call_recording_retention_days >= 30);

-- ============================================================================
-- 2. agent_messages — per-turn timing for transcript↔audio sync
-- ============================================================================
--
-- Null on SMS turns (no audio); set from the Vapi artifact's per-message
-- secondsFromStart / duration on voice turns.

alter table public.agent_messages
  add column if not exists seconds_from_start numeric,
  add column if not exists duration_ms integer;

-- ============================================================================
-- 3. can_review_ai_calls — new capability (owner/admin)
-- ============================================================================

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    when 'can_configure_leaderboards' then false
    when 'can_post_announcements'     then p_role in ('admin','coach')
    when 'can_broadcast_to_class'     then p_role in ('admin','coach')
    when 'can_manage_parq'            then p_role = 'admin'
    when 'can_acknowledge_alerts'     then p_role in ('admin','coach')
    when 'can_manage_comms'           then p_role = 'admin'
    when 'can_manage_store'           then p_role = 'admin'
    when 'can_see_store_revenue'      then p_role = 'admin'
    when 'can_manage_website'         then p_role = 'admin'
    when 'can_program_members'        then p_role in ('admin','coach')
    when 'can_review_ai_calls'        then p_role = 'admin'
    else false
  end;
$$;
grant execute on function public.default_capability(public.gym_role, text) to authenticated;

-- ============================================================================
-- 4. call_recordings
-- ============================================================================

create table public.call_recordings (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  recording_path  text not null,
  duration_seconds integer,
  consent_state   text,
  created_at      timestamptz not null default now()
);

create index call_recordings_gym_idx on public.call_recordings(gym_id, created_at desc);
create index call_recordings_conversation_idx on public.call_recordings(conversation_id, created_at desc);

alter table public.call_recordings enable row level security;

-- Reads gated on can_review_ai_calls (owner/admin). No client writes — the
-- /end-of-call edge worker inserts under the service role.
create policy call_recordings_review_select on public.call_recordings
  for select using (public.effective_can(gym_id, 'can_review_ai_calls'));

-- ============================================================================
-- 5. agent_coaching_corrections — per-gym feedback that shapes future calls
-- ============================================================================

create table public.agent_coaching_corrections (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete set null,
  message_id      uuid references public.agent_messages(id) on delete set null,
  field_kind      text not null check (field_kind in ('fact','tone','rule','exemplar')),
  scope           text not null check (scope in ('example','standing_rule')),
  input_payload   jsonb,
  ai_suggestion   text,
  correction      text not null,
  was_overridden  boolean not null default true,
  active          boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index agent_coaching_corrections_active_idx
  on public.agent_coaching_corrections(gym_id, active, created_at desc);

alter table public.agent_coaching_corrections enable row level security;

create policy agent_coaching_corrections_review_select on public.agent_coaching_corrections
  for select using (public.effective_can(gym_id, 'can_review_ai_calls'));

-- ============================================================================
-- 6. agent_recording_access_log — who listened to what (admin-only read)
-- ============================================================================
--
-- Mirrors health_data_access_log: writes only via log_recording_access, read
-- only by admins (can_manage_staff) so the trail can't be quietly inspected
-- by the people it records.

create table public.agent_recording_access_log (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  actor_id     uuid references public.profiles(id) on delete set null,
  recording_id uuid references public.call_recordings(id) on delete set null,
  surface      text,
  created_at   timestamptz not null default now()
);

create index agent_recording_access_log_gym_idx
  on public.agent_recording_access_log(gym_id, created_at desc);

alter table public.agent_recording_access_log enable row level security;

create policy agent_recording_access_log_admin_select on public.agent_recording_access_log
  for select using (public.effective_can(gym_id, 'can_manage_staff'));

-- ============================================================================
-- 7. Owner setters — voice selection + recording controls
-- ============================================================================

create or replace function public.set_gym_agent_voice_selection(
  p_gym_id   uuid,
  p_provider text,
  p_voice_id text,
  p_region   text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the AI front desk';
  end if;
  insert into public.gym_agent_settings (gym_id, voice_provider, voice_id, voice_region, updated_at)
  values (p_gym_id, nullif(btrim(coalesce(p_provider, '')), ''),
          nullif(btrim(coalesce(p_voice_id, '')), ''),
          nullif(btrim(coalesce(p_region, '')), ''), now())
  on conflict (gym_id) do update
    set voice_provider = excluded.voice_provider,
        voice_id = excluded.voice_id,
        voice_region = excluded.voice_region,
        updated_at = now();
end;
$$;
grant execute on function public.set_gym_agent_voice_selection(uuid, text, text, text)
  to authenticated;

create or replace function public.set_gym_call_recording(
  p_gym_id        uuid,
  p_enabled       boolean,
  p_retention_days integer
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change call recording';
  end if;
  if p_retention_days is null or p_retention_days < 30 then
    raise exception 'Recording retention must be at least 30 days';
  end if;
  insert into public.gym_agent_settings
    (gym_id, call_recording_enabled, call_recording_retention_days, updated_at)
  values (p_gym_id, coalesce(p_enabled, true), p_retention_days, now())
  on conflict (gym_id) do update
    set call_recording_enabled = excluded.call_recording_enabled,
        call_recording_retention_days = excluded.call_recording_retention_days,
        updated_at = now();
end;
$$;
grant execute on function public.set_gym_call_recording(uuid, boolean, integer)
  to authenticated;

-- ============================================================================
-- 8. record_agent_corrections — capture the owner's coaching (batch)
-- ============================================================================
--
-- Shape mirrors record_import_corrections (0076/0077): a jsonb array of rows,
-- gated on the reviewing capability rather than a role. Cross-tenant guard:
-- any referenced conversation/message must belong to p_gym_id.

create or replace function public.record_agent_corrections(
  p_gym_id uuid,
  p_rows   jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row  jsonb;
  v_conv uuid;
  v_msg  uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_review_ai_calls') then
    raise exception 'Not authorised';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected an array of corrections';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if coalesce(btrim(v_row->>'correction'), '') = '' then
      raise exception 'Each correction needs text';
    end if;
    v_conv := nullif(v_row->>'conversation_id', '')::uuid;
    v_msg  := nullif(v_row->>'message_id', '')::uuid;
    if v_conv is not null and not exists (
      select 1 from public.agent_conversations where id = v_conv and gym_id = p_gym_id
    ) then
      raise exception 'Conversation does not belong to this gym';
    end if;
    if v_msg is not null and not exists (
      select 1 from public.agent_messages where id = v_msg and gym_id = p_gym_id
    ) then
      raise exception 'Message does not belong to this gym';
    end if;

    insert into public.agent_coaching_corrections
      (gym_id, conversation_id, message_id, field_kind, scope, input_payload,
       ai_suggestion, correction, was_overridden, created_by)
    values
      (p_gym_id, v_conv, v_msg,
       coalesce(nullif(v_row->>'field_kind', ''), 'rule'),
       coalesce(nullif(v_row->>'scope', ''), 'standing_rule'),
       case when v_row->'input_payload' is null then null else v_row->'input_payload' end,
       nullif(v_row->>'ai_suggestion', ''),
       btrim(v_row->>'correction'),
       coalesce((v_row->>'was_overridden')::boolean, true),
       auth.uid());
  end loop;
end;
$$;
grant execute on function public.record_agent_corrections(uuid, jsonb) to authenticated;

create or replace function public.set_agent_correction_active(
  p_id uuid, p_active boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym from public.agent_coaching_corrections where id = p_id;
  if v_gym is null then
    raise exception 'Correction not found';
  end if;
  if not public.effective_can(v_gym, 'can_review_ai_calls') then
    raise exception 'Not authorised';
  end if;
  update public.agent_coaching_corrections set active = p_active where id = p_id;
end;
$$;
grant execute on function public.set_agent_correction_active(uuid, boolean) to authenticated;

-- ============================================================================
-- 9. log_recording_access — audit every playback
-- ============================================================================

create or replace function public.log_recording_access(
  p_gym_id    uuid,
  p_recording uuid,
  p_surface   text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_review_ai_calls') then
    raise exception 'Not authorised';
  end if;
  insert into public.agent_recording_access_log (gym_id, actor_id, recording_id, surface)
    values (p_gym_id, auth.uid(), p_recording, p_surface);
end;
$$;
grant execute on function public.log_recording_access(uuid, uuid, text) to authenticated;

-- ============================================================================
-- 10. Private recordings bucket + storage policies
-- ============================================================================
--
-- Path convention: <gym_id>/<conversation_id>/<uuid>.<ext>, so the first
-- folder segment is the tenant. The /end-of-call worker writes under the
-- service role (bypasses RLS); staff read for playback when they hold
-- can_review_ai_calls for that tenant (pattern from member-programming-files).

insert into storage.buckets (id, name, public)
  values ('agent-call-recordings', 'agent-call-recordings', false)
  on conflict (id) do nothing;

drop policy if exists agent_recordings_staff_read on storage.objects;
create policy agent_recordings_staff_read on storage.objects
  for select using (
    bucket_id = 'agent-call-recordings'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_review_ai_calls')
    )
  );

-- ============================================================================
-- 11. purge_expired_agent_recordings — retention sweep (cron only)
-- ============================================================================
--
-- Deletes recordings past the gym's window and the Storage object with them.
-- Unlike the row-only purges elsewhere, this also removes the storage.objects
-- row so the audio itself stops being reachable. conversations/transcripts are
-- kept (they're not the recording); only the audio ages out.

create or replace function public.purge_expired_agent_recordings()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with expired as (
    select r.id, r.recording_path
      from public.call_recordings r
      join public.gym_agent_settings s on s.gym_id = r.gym_id
      where r.created_at < now() - make_interval(days => s.call_recording_retention_days)
  ),
  del_obj as (
    delete from storage.objects o
      using expired e
      where o.bucket_id = 'agent-call-recordings' and o.name = e.recording_path
      returning 1
  ),
  del_rec as (
    delete from public.call_recordings r using expired e where r.id = e.id
      returning 1
  )
  select count(*) into v_count from del_rec;
  return v_count;
end;
$$;
revoke execute on function public.purge_expired_agent_recordings()
  from public, anon, authenticated;

select cron.schedule(
  'purge-expired-agent-recordings',
  '0 4 * * *', -- daily 04:00 UTC, staggered off the 03:00/03:30 sweeps
  $$select public.purge_expired_agent_recordings();$$
);

commit;
