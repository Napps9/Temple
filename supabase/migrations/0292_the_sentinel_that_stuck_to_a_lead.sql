-- The sentinel that stuck to a lead
--
-- 0289 stopped writing 'web-test' into leads.phone. It did not remove the
-- rows that already had it, and it left a coalesce that cannot correct
-- one, so a gym that had ever taken a browser call before that deploy was
-- permanently unable to text anybody from one.
--
-- The path, from a call this morning. agent_conversations is keyed
-- (gym_id, phone, channel), and a browser call has no caller ID, so every
-- browser call at a gym shares one voice row whose phone is the literal
-- 'web-test'. That row's lead_id points at whichever lead was captured on
-- it first — here, one written at 08:19 with phone = 'web-test'. Every
-- later call takes agent_capture_lead's dedup branch, and the branch says
--
--     phone = coalesce(phone, v_phone)
--
-- which keeps 'web-test' forever, because it is not null. The caller reads
-- their mobile out, the agent says it has been saved, and the number goes
-- nowhere. textDestination then finds nothing dialable and the agent
-- reports, correctly and uselessly, that it has no number to text.
--
-- So: clear the sentinel where it already landed, and make the branch able
-- to correct a stored value that cannot be dialled. A phone somebody typed
-- by hand is left exactly as they typed it — 0270's argument, and still
-- right — because it is only replaced when it does not parse at all.

begin;

-- Written by lead-agent-voice's synthetic caller id before 0289. It is not
-- a phone number and no sender can use it.
update public.leads
   set phone = null, updated_at = now()
 where phone = 'web-test';

create or replace function public.agent_capture_lead(
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
          -- A stored value that cannot be dialled is not a number we are
          -- keeping: it is the reason this lead could not be texted. What
          -- somebody typed by hand parses, so it survives untouched.
          phone = case
                    when public._normalise_uk_phone(phone) is null
                      then coalesce(v_phone, phone)
                    else phone
                  end,
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

commit;
