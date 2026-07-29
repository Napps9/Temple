-- 0208: Keeping members and finding cover (docs/roadmap.md phases 7+8).
--
-- Two more jobs stamped from the loop-1 template — same authority dial,
-- same proposal cards, same owner-approved templates, same hard rules in
-- SQL. Nothing here invents a new mechanism:
--
--   retention  a daily tick finds regulars gone quiet (attended within
--              90 days, nothing for 21+), proposes ONE warm note each —
--              at most three a day per gym, never the same member twice
--              inside 45 days, and a rejection blocks the window too.
--              The note is the owner-approved template; writing a member
--              off stays human (vision: permanently reserved).
--
--   cover      an hourly tick finds classes inside the gym's own
--              cover-warning window whose cover offer nobody has
--              claimed, and proposes re-asking the claimable coaches —
--              executed as targeted cover_notifications through the
--              existing worker, so the ask lands in the same Cover inbox
--              and email as a fresh request. The agent never assigns a
--              coach: the claim stays first-come, the class untouched.

-- ============================================================================
-- 1. Widen the framework's kind vocabularies
-- ============================================================================

alter table public.agent_actions
  drop constraint agent_actions_teammate_check;
alter table public.agent_actions
  add constraint agent_actions_teammate_check
  check (teammate in ('revenue', 'retention', 'ops'));

alter table public.agent_actions
  drop constraint agent_actions_action_kind_check;
alter table public.agent_actions
  add constraint agent_actions_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message', 'cover_ask'));

alter table public.agent_authority
  drop constraint agent_authority_action_kind_check;
alter table public.agent_authority
  add constraint agent_authority_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message', 'cover_ask'));

alter table public.agent_message_templates
  drop constraint agent_message_templates_kind_check;
alter table public.agent_message_templates
  add constraint agent_message_templates_kind_check
  check (kind in ('chase_message', 'plan_adjustment_offer', 'retention_message'));

-- ============================================================================
-- 2. Switch-ons
-- ============================================================================

create or replace function public.set_retention_job(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only the owner can change this';
  end if;

  if p_enabled then
    insert into public.agent_authority (gym_id, action_kind, level, updated_by)
    values (p_gym_id, 'retention_message', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;
    insert into public.agent_message_templates (gym_id, kind, body, approved_by)
    values
      (p_gym_id, 'retention_message',
       'Hi {first_name} — it''s {gym_name}. We''ve missed you the last few '
       || 'weeks. No pressure and no hard sell — the room''s just better '
       || 'with you in it. Book anything that suits and we''ll see you '
       || 'there; if something''s up, reply and tell us.',
       auth.uid())
    on conflict (gym_id, kind) do nothing;
  else
    delete from public.agent_authority
      where gym_id = p_gym_id and action_kind = 'retention_message';
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and action_kind = 'retention_message'
        and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_retention_job(uuid, boolean) from public, anon;
grant execute on function public.set_retention_job(uuid, boolean) to authenticated;

create or replace function public.set_cover_job(
  p_gym_id  uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only the owner can change this';
  end if;

  if p_enabled then
    insert into public.agent_authority (gym_id, action_kind, level, updated_by)
    values (p_gym_id, 'cover_ask', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;
  else
    delete from public.agent_authority
      where gym_id = p_gym_id and action_kind = 'cover_ask';
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and action_kind = 'cover_ask'
        and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_cover_job(uuid, boolean) from public, anon;
grant execute on function public.set_cover_job(uuid, boolean) to authenticated;

-- ============================================================================
-- 3. Execution grows two branches
-- ============================================================================

-- The cover re-ask: the same recipient rule as 0165's fan-out (claimable
-- = owner/coach, present, not the requester, not barred from every class
-- in the request), with a date-stamped idempotency key so one approved
-- ask is one nudge per coach per day, however many times it is retried.
create or replace function public._agent_cover_reask(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.cover_requests;
  v_count   integer := 0;
begin
  select * into v_request from public.cover_requests where id = p_request_id;
  if v_request is null then return 0; end if;

  with recipient as (
    select m.profile_id, u.email
    from public.gym_memberships m
    join auth.users u on u.id = m.profile_id
    where m.gym_id = v_request.gym_id
      and m.role in ('owner', 'coach')
      and m.left_at is null
      and m.profile_id <> v_request.requested_by
      and exists (
        select 1
        from public.cover_request_sessions crs
        join public.class_sessions cs on cs.id = crs.class_session_id
        where crs.request_id = p_request_id
          and crs.claimed_by is null
          and not exists (
            select 1 from public.coach_class_type_qualifications q
            where q.gym_id = v_request.gym_id
              and q.profile_id = m.profile_id
              and q.class_type_id = cs.class_type_id
              and q.qualified = false
          )
      )
  ),
  ins as (
    insert into public.cover_notifications
      (gym_id, request_id, kind, channel, recipient, recipient_profile_id,
       status, sent_at, idempotency_key)
    select
      v_request.gym_id, p_request_id, 'cover_requested', c.channel,
      case when c.channel = 'in_app' then r.profile_id::text else r.email end,
      r.profile_id,
      case when c.channel = 'in_app' then 'sent' else 'queued' end,
      case when c.channel = 'in_app' then now() else null end,
      'agent-cover-ask:' || p_request_id || ':' || r.profile_id || ':'
        || to_char(now(), 'YYYY-MM-DD') || ':' || c.channel
    from recipient r
    cross join (values ('in_app'), ('email')) as c(channel)
    where not (c.channel = 'email'
               and public._email_blanket_unsubscribed(v_request.gym_id, r.email))
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

revoke all on function public._agent_cover_reask(uuid)
  from public, anon, authenticated;

create or replace function public._agent_execute_action(p_action_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a         record;
  t         record;
  v_gym     record;
  v_first   text;
  v_body    text;
  v_subject text;
begin
  select * into a from public.agent_actions where id = p_action_id;
  if a is null or a.status <> 'approved' then
    raise exception 'Action is not approved';
  end if;

  if a.action_kind = 'cover_ask' then
    perform public._agent_cover_reask((a.payload->>'request_id')::uuid);
    update public.agent_actions
      set status = 'executed', executed_at = now()
      where id = a.id;
    return;
  end if;

  select body into t
    from public.agent_message_templates
    where gym_id = a.gym_id and kind = a.action_kind;
  if t is null then
    raise exception 'No approved template';
  end if;

  select name into v_gym from public.gyms where id = a.gym_id;
  v_first := split_part(coalesce(a.payload->>'member_name', 'there'), ' ', 1);

  v_body := replace(t.body, '{first_name}', v_first);
  v_body := replace(v_body, '{gym_name}', coalesce(v_gym.name, 'your gym'));
  v_body := replace(v_body, '{plan_name}',
    coalesce(a.payload->>'plan_name', 'membership'));
  v_body := replace(v_body, '{offer_plan}',
    coalesce(a.payload->>'offer_plan_name', 'a smaller plan'));
  v_body := replace(v_body, '{offer_price}',
    coalesce(a.payload->>'offer_price', ''));

  v_subject := case a.action_kind
    when 'plan_adjustment_offer'
      then 'A thought about your ' || coalesce(v_gym.name, 'gym') || ' membership'
    when 'retention_message'
      then 'We''ve missed you at ' || coalesce(v_gym.name, 'the gym')
    else 'About your ' || coalesce(v_gym.name, 'gym') || ' membership payment'
  end;

  insert into public.agent_outbound_messages
    (gym_id, case_id, action_id, recipient_profile_id, subject, body,
     idempotency_key)
  values
    (a.gym_id, a.case_id, a.id, a.subject_profile, v_subject, v_body,
     'agent-action:' || a.id)
  on conflict (idempotency_key) do nothing;

  update public.agent_actions
    set status = 'executed', executed_at = now()
    where id = a.id;

  update public.agent_cases
    set stage = case when a.action_kind = 'plan_adjustment_offer'
                     then 'offer_pending' else 'touch_2_sent' end
    where id = a.case_id and stage <> 'closed';
end;
$$;

revoke all on function public._agent_execute_action(uuid)
  from public, anon, authenticated;

-- ============================================================================
-- 4. The retention tick — daily
-- ============================================================================

create or replace function public.agent_retention_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_level    text;
  v_action   uuid;
  v_weeks    integer;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name,
           max(cb.attended_at) as last_seen,
           a.level
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      join public.class_bookings cb
        on cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
       and cb.attended_at is not null
      where a.action_kind = 'retention_message' and a.level <> 'reserved'
        and exists (select 1 from public.plan_subscriptions ps
                     where ps.gym_id = gm.gym_id
                       and ps.profile_id = gm.profile_id
                       and ps.status = 'active')
        -- Never the same member twice inside 45 days, and a "No" blocks
        -- the window too.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'retention_message'
                           and aa.proposed_at > now() - interval '45 days')
      group by gm.gym_id, gm.profile_id, p.full_name, a.level
      having max(cb.attended_at) between now() - interval '90 days'
                                     and now() - interval '21 days'
  loop
    -- At most three proposals per gym per day: quiet by design.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'retention_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_weeks := greatest(1, floor(extract(epoch from now() - m.last_seen)
      / 604800)::integer);

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'retention', 'retention_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'weeks_absent', v_weeks
       ),
       jsonb_build_array(
         'Last trained on ' || to_char(m.last_seen, 'DD Mon') || ' — '
           || v_weeks || ' week' || case when v_weeks = 1 then '' else 's' end
           || ' ago.',
         'Still on an active membership.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    v_level := m.level;
    if v_level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-retention-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$$;

revoke all on function public.agent_retention_tick()
  from public, anon, authenticated;

-- ============================================================================
-- 5. The cover tick — hourly
-- ============================================================================

create or replace function public.agent_cover_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_started  timestamptz := clock_timestamp();
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_action   uuid;
begin
  for r in
    select cr.id as request_id, cr.gym_id, a.level,
           p.full_name as requester_name,
           min(cs.starts_at) as first_class_at,
           count(*) as open_count
      from public.agent_authority a
      join public.cover_requests cr
        on cr.gym_id = a.gym_id and cr.status in ('open', 'partial')
      join public.profiles p on p.id = cr.requested_by
      join public.cover_request_sessions crs
        on crs.request_id = cr.id and crs.claimed_by is null
      join public.class_sessions cs on cs.id = crs.class_session_id
      join public.gyms g on g.id = cr.gym_id
      where a.action_kind = 'cover_ask' and a.level <> 'reserved'
        and g.cover_warning_hours > 0
        and cs.starts_at > now()
        and cs.starts_at < now() + (g.cover_warning_hours || ' hours')::interval
        -- One ask per request per day, and a "No" holds for that day too.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = cr.gym_id
                           and aa.action_kind = 'cover_ask'
                           and aa.payload->>'request_id' = cr.id::text
                           and aa.proposed_at > now() - interval '1 day')
      group by cr.id, cr.gym_id, a.level, p.full_name
  loop
    insert into public.agent_actions
      (gym_id, teammate, action_kind, payload, evidence, status)
    values
      (r.gym_id, 'ops', 'cover_ask',
       jsonb_build_object(
         'request_id', r.request_id,
         'requester_name', r.requester_name,
         'open_count', r.open_count,
         'first_class_at', r.first_class_at
       ),
       jsonb_build_array(
         r.open_count || ' class'
           || case when r.open_count = 1 then '' else 'es' end
           || ' still uncovered, the first on '
           || to_char(r.first_class_at, 'Dy DD Mon at HH24:MI') || '.',
         'Asked for by ' || coalesce(r.requester_name, 'a coach') || '.',
         'Every coach who could claim gets the same nudge; the claim stays '
           || 'first-come.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if r.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-cover-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$$;

revoke all on function public.agent_cover_tick()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'agent-retention-tick',
  '45 8 * * *',
  $$select public.agent_retention_tick();$$
);

select cron.schedule(
  'agent-cover-tick',
  '37 * * * *',
  $$select public.agent_cover_tick();$$
);
