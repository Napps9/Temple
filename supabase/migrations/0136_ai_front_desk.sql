-- AI front desk — an agent that answers and sells memberships to inbound
-- leads over SMS and phone calls.
--
-- Each gym gets a platform-provisioned phone number. Inbound texts hit the
-- lead-agent-sms edge function (Claude tool loop); inbound calls are
-- fronted by a managed voice provider whose tools hit lead-agent-voice.
-- Both channels answer from real plan/schedule data, capture the prospect
-- into the existing leads pipeline (0056/0114), and hand off to the
-- assigned coach when unsure. This migration is the data side:
--
--   - gym_agent_settings: per-gym config. enabled/voice_enabled/context
--     are owner-set; phone_number and vapi_assistant_id are written only
--     by the platform operator with the service key (provisioning is a
--     manual, billed act — an owner can't self-assign a number).
--   - agent_conversations / agent_messages: the durable thread per
--     (gym, phone, channel). The agent reconstructs its context from
--     these rows on every inbound message; staff read them through RLS
--     on the same predicate as leads and take over via the edge function.
--   - Internal RPCs (service-role only): capture a lead from a
--     conversation without depending on public_lead_capture_enabled
--     (that flag gates the public web form, a different surface), hand
--     off to the assigned coach through the existing notification queue,
--     and close a conversation on STOP with consent withdrawal (the
--     existing lead_withdraw_marketing_consent is keyed by an automation
--     run id, so it cannot serve the SMS opt-out path).
--
-- No client write policies anywhere here: every mutation goes through an
-- owner-gated RPC or the service role, per the RLS conventions.

begin;

-- ============================================================================
-- 1. gym_agent_settings
-- ============================================================================

create table public.gym_agent_settings (
  gym_id            uuid primary key references public.gyms(id) on delete cascade,
  enabled           boolean not null default false,
  phone_number      text unique
                      check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  voice_enabled     boolean not null default false,
  vapi_assistant_id text,
  context           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.gym_agent_settings enable row level security;

create policy gym_agent_settings_tenant_select on public.gym_agent_settings
  for select using (public.user_can_assign_plan(gym_id));

-- ============================================================================
-- 2. agent_conversations + agent_messages
-- ============================================================================

create table public.agent_conversations (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  phone           text not null,
  lead_id         uuid references public.leads(id) on delete set null,
  channel         text not null check (channel in ('sms', 'voice')),
  status          text not null default 'active'
                    check (status in ('active', 'handed_off', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (gym_id, phone, channel)
);

create index agent_conversations_gym_recent_idx
  on public.agent_conversations(gym_id, last_message_at desc);
create index agent_conversations_lead_idx
  on public.agent_conversations(lead_id)
  where lead_id is not null;

alter table public.agent_conversations enable row level security;

create policy agent_conversations_tenant_select on public.agent_conversations
  for select using (public.user_can_assign_plan(gym_id));

create table public.agent_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  role            text not null check (role in ('lead', 'agent', 'staff', 'system')),
  body            text not null,
  provider_sid    text,
  created_at      timestamptz not null default now()
);

-- Twilio retries webhook deliveries; the MessageSid makes a redelivery a
-- visible no-op instead of a duplicated turn.
create unique index agent_messages_provider_sid_unique
  on public.agent_messages(provider_sid)
  where provider_sid is not null;
create index agent_messages_conversation_idx
  on public.agent_messages(conversation_id, created_at);

alter table public.agent_messages enable row level security;

create policy agent_messages_tenant_select on public.agent_messages
  for select using (public.user_can_assign_plan(gym_id));

-- ============================================================================
-- 3. Owner setters
-- ============================================================================

create or replace function public.set_gym_agent_enabled(
  p_gym_id uuid, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the AI front desk';
  end if;
  insert into public.gym_agent_settings (gym_id, enabled, updated_at)
  values (p_gym_id, p_enabled, now())
  on conflict (gym_id) do update
    set enabled = excluded.enabled, updated_at = now();
end;
$$;
grant execute on function public.set_gym_agent_enabled(uuid, boolean) to authenticated;

create or replace function public.set_gym_agent_context(
  p_gym_id uuid, p_context text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the AI front desk';
  end if;
  if length(coalesce(p_context, '')) > 4000 then
    raise exception 'Keep the agent notes under 4000 characters';
  end if;
  insert into public.gym_agent_settings (gym_id, context, updated_at)
  values (p_gym_id, nullif(btrim(coalesce(p_context, '')), ''), now())
  on conflict (gym_id) do update
    set context = excluded.context, updated_at = now();
end;
$$;
grant execute on function public.set_gym_agent_context(uuid, text) to authenticated;

create or replace function public.set_gym_agent_voice(
  p_gym_id uuid, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change the AI front desk';
  end if;
  insert into public.gym_agent_settings (gym_id, voice_enabled, updated_at)
  values (p_gym_id, p_enabled, now())
  on conflict (gym_id) do update
    set voice_enabled = excluded.voice_enabled, updated_at = now();
end;
$$;
grant execute on function public.set_gym_agent_voice(uuid, boolean) to authenticated;

-- ============================================================================
-- 4. agent_capture_lead — internal (service role)
-- ============================================================================
--
-- Gym and phone come from the conversation row, not from parameters, so a
-- compromised prompt can never write a lead into another tenant. Dedup is
-- by phone (digits-only compare) rather than email — over SMS the phone
-- number is the identity we actually have.

create function public.agent_capture_lead(
  p_conversation_id uuid,
  p_full_name       text,
  p_email           text default null,
  p_notes           text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_gym      uuid;
  v_phone    text;
  v_linked   uuid;
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_email    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_notes    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_source   uuid;
  v_id       uuid;
begin
  select gym_id, phone, lead_id into v_gym, v_phone, v_linked
    from public.agent_conversations where id = p_conversation_id;
  if v_gym is null then
    raise exception 'Conversation not found';
  end if;
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if v_email is not null
     and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    v_email := null;
  end if;

  insert into public.lead_sources (gym_id, label, color)
  values (v_gym, 'AI front desk', '#0EA5E9')
  on conflict (gym_id, lower(label)) where archived_at is null do nothing;
  select id into v_source
    from public.lead_sources
    where gym_id = v_gym and lower(label) = 'ai front desk'
      and archived_at is null
    limit 1;

  if v_linked is null then
    select id into v_linked
      from public.leads
      where gym_id = v_gym
        and phone is not null
        and regexp_replace(phone, '[^0-9+]', '', 'g')
              = regexp_replace(v_phone, '[^0-9+]', '', 'g')
        and status not in ('converted'::public.lead_status, 'lost'::public.lead_status)
        and captured_at >= now() - interval '30 days'
      order by captured_at desc
      limit 1;
  end if;

  if v_linked is not null then
    update public.leads
      set email = coalesce(email, v_email),
          source_id = coalesce(source_id, v_source),
          notes = case
            when v_notes is null then notes
            when notes is null then v_notes
            else notes || E'\n— ' || v_notes
          end,
          updated_at = now()
      where id = v_linked;
    v_id := v_linked;
  else
    insert into public.leads
      (gym_id, full_name, email, phone, source_id, notes, status, captured_by,
       marketing_consent, lawful_basis)
    values
      (v_gym, v_name, v_email, v_phone, v_source, v_notes,
       'cold'::public.lead_status, null, false, 'legitimate_interest')
    returning id into v_id;
  end if;

  perform public.assign_lead(v_id);

  update public.agent_conversations
    set lead_id = v_id where id = p_conversation_id;

  return v_id;
end;
$$;
revoke execute on function public.agent_capture_lead(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.agent_capture_lead(uuid, text, text, text)
  to service_role;

-- ============================================================================
-- 5. agent_request_handoff — internal (service role)
-- ============================================================================

create function public.agent_request_handoff(
  p_conversation_id uuid,
  p_reason          text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lead   uuid;
  v_coach  uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  update public.agent_conversations
    set status = 'handed_off', last_message_at = now()
    where id = p_conversation_id
    returning lead_id into v_lead;
  if not found then
    raise exception 'Conversation not found';
  end if;

  if v_lead is not null then
    if v_reason is not null then
      update public.leads
        set notes = case
              when notes is null then 'AI handoff: ' || v_reason
              else notes || E'\n— AI handoff: ' || v_reason
            end,
            updated_at = now()
        where id = v_lead;
    end if;
    select assigned_coach_id into v_coach from public.leads where id = v_lead;
    if v_coach is not null then
      -- Date-stamped key: one handoff notification per day, like nudge_lead.
      perform public.enqueue_lead_notifications(
        v_lead, v_coach, 'agent-handoff:' || to_char(now(), 'YYYY-MM-DD'));
    end if;
  end if;
end;
$$;
revoke execute on function public.agent_request_handoff(uuid, text)
  from public, anon, authenticated;
grant execute on function public.agent_request_handoff(uuid, text)
  to service_role;

-- ============================================================================
-- 6. agent_stop_conversation — STOP keyword (service role)
-- ============================================================================

create function public.agent_stop_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lead uuid;
begin
  update public.agent_conversations
    set status = 'closed', last_message_at = now()
    where id = p_conversation_id
    returning lead_id into v_lead;
  if not found then
    raise exception 'Conversation not found';
  end if;

  if v_lead is not null then
    update public.leads
      set marketing_consent = false, consent_at = null, updated_at = now()
      where id = v_lead;
  end if;
end;
$$;
revoke execute on function public.agent_stop_conversation(uuid)
  from public, anon, authenticated;
grant execute on function public.agent_stop_conversation(uuid)
  to service_role;

commit;
