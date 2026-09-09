-- The number they read out
--
-- From a QA call this morning. The agent asked for "the best number to
-- text you at", the caller read one out, and a minute later the agent
-- told him it could not text him — apparently because of "a restriction
-- on texting links". Two things were wrong underneath that one sentence.
--
-- THE NUMBER WENT NOWHERE. capture_lead takes a name, an email and notes.
-- There has never been anywhere to put a phone number, because the phone
-- number was always the conversation's own: over SMS it is the identity
-- we actually have, which is what 0136 says and is still right. On a
-- voice call it is the caller ID, and on a browser call there is no
-- caller ID at all — lead-agent-voice substitutes the literal string
-- 'web-test'. So the agent asks a question whose answer it discards, and
-- every browser call at a gym folds into one lead whose phone reads
-- 'web-test'.
--
-- Hence p_phone, used only when the conversation's own phone is not
-- dialable. Caller ID wins wherever there is one: the thread somebody is
-- already on is the one they are demonstrably reachable on, and a
-- dictated number is a claim. When neither is dialable the lead now
-- keeps a null phone rather than the sentinel — a column that means
-- "somewhere we can reach them" must not hold a word.
--
-- AND A DICTATED NUMBER IS SOMEBODY ELSE'S NUMBER. This is the argument
-- 0143 made about the dictated email address, and it survives the change
-- of channel: an agent that sends to whatever it is told is a
-- bombardment vector wearing a gym's name. agent_sms_sends is
-- agent_email_sends with a phone in it.
--
-- One cap, not 0143's two. For email the conversation and the recipient
-- are genuinely different keys — one thread can name a hundred
-- addresses. For a text they collapse: the agent only ever texts the
-- thread it is about to write into, so a per-conversation count and a
-- per-number count would be the same count. The number is the one that
-- bounds harm to a person, so that is the one kept; conversation_id is
-- recorded beside it so a gym can see which call each text came out of.

begin;

-- ============================================================================
-- 1. A cap on agent-initiated texts
-- ============================================================================

create table public.agent_sms_sends (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  conversation_id uuid references public.agent_conversations(id) on delete cascade,
  phone           text not null,
  created_at      timestamptz not null default now()
);
create index agent_sms_sends_gym_phone_idx
  on public.agent_sms_sends(gym_id, phone, created_at desc);
alter table public.agent_sms_sends enable row level security;

comment on table public.agent_sms_sends is
  'One row per text the AI front desk sent of its own accord, so the '
  'destination can be rate-limited. Not a message log — the message '
  'itself lands in agent_messages on the thread it was sent to.';

create function public.agent_sms_send_allowed(
  p_conversation_id uuid,
  p_phone           text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_gym   uuid;
  v_phone text := public._normalise_uk_phone(p_phone);
begin
  select gym_id into v_gym
    from public.agent_conversations where id = p_conversation_id;
  if v_gym is null or v_phone is null then
    return false;
  end if;

  if (select count(*) from public.agent_sms_sends
      where gym_id = v_gym and phone = v_phone
        and created_at > now() - interval '1 day') >= 3 then
    return false;
  end if;

  insert into public.agent_sms_sends (gym_id, conversation_id, phone)
  values (v_gym, p_conversation_id, v_phone);
  return true;
end;
$$;
revoke execute on function public.agent_sms_send_allowed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.agent_sms_send_allowed(uuid, text)
  to service_role;

-- ============================================================================
-- 2. capture_lead takes the number they said
-- ============================================================================

-- Arity changes, so this is a drop and not a replace (0043). p_phone is
-- last and defaults, so the deployed edge function's four-argument call
-- keeps resolving across the gap between db-deploy and functions-deploy.
drop function public.agent_capture_lead(uuid, text, text, text);

create function public.agent_capture_lead(
  p_conversation_id uuid,
  p_full_name       text,
  p_email           text default null,
  p_notes           text default null,
  p_phone           text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_gym      uuid;
  v_conv     text;
  v_phone    text;
  v_linked   uuid;
  v_name     text := btrim(coalesce(p_full_name, ''));
  v_email    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_notes    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_source   uuid;
  v_id       uuid;
begin
  select gym_id, phone, lead_id into v_gym, v_conv, v_linked
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
  v_phone := coalesce(public._normalise_uk_phone(v_conv),
                      public._normalise_uk_phone(p_phone));

  insert into public.lead_sources (gym_id, label, color)
  values (v_gym, 'AI front desk', '#0EA5E9')
  on conflict (gym_id, lower(label)) where archived_at is null do nothing;
  select id into v_source
    from public.lead_sources
    where gym_id = v_gym and lower(label) = 'ai front desk'
      and archived_at is null
    limit 1;

  if v_linked is null and v_phone is not null then
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
          -- A lead captured before the number was said keeps waiting for
          -- one; this is the call it arrives on.
          phone = coalesce(phone, v_phone),
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
revoke execute on function public.agent_capture_lead(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.agent_capture_lead(uuid, text, text, text, text)
  to service_role;

commit;
