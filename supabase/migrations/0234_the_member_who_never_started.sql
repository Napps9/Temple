-- 0234: The gym notices a member who never started
--
-- A fourth job, stamped from the 0206 framework the way 0208 stamped the
-- second and third. Nothing here invents a mechanism: same authority dial,
-- same proposal card, same owner-approved template, same hard rules in SQL
-- rather than in a prompt.
--
-- IT FILLS A GAP THE OTHER JOBS CANNOT SEE. agent_retention_tick joins
-- class_bookings on attended_at is not null, so by construction it only
-- ever notices somebody who has trained and stopped. A member who signed
-- up and never came is invisible to every job in the product — and that is
-- the moment a gym loses people. gym_quiet_members (0231) already treats
-- never-attended as a different fact from lapsed, with weeks_absent null
-- rather than a made-up number; this acts on the half of that answer
-- nothing was acting on.
--
-- FOUR HARD RULES, ALL HERE RATHER THAN IN COPY:
--
--   1. Never somebody who came across from another platform. A member
--      whose pending_members row links to them is a migration, not a new
--      joiner: they may have trained at that gym for five years, and
--      Temple has no idea when, because a class-booking history is not
--      what the importers carry. Telling that person the gym noticed they
--      have not been in yet is the worst message in the product.
--   2. Once per member, ever. Retention uses a rolling 45 days because
--      somebody can go quiet more than once; a first week happens once.
--      The existence check carries no time bound, which also makes a
--      rejection final for that member — as it should be.
--   3. Seven days at the earliest, thirty at the latest. Before a week
--      they simply have not got round to it. After a month this is a
--      different and sadder conversation, and a gym noticing at six weeks
--      is not noticing.
--   4. Three a day per gym, matching retention, so a gym that has just
--      opened its join link does not wake up to a queue.
--
-- One warm note from the owner-approved template. No offer, no plan
-- change, nothing about health, and writing anybody off stays human.

begin;

-- ============================================================================
-- 1. Widen the framework's kind vocabularies
-- ============================================================================

alter table public.agent_actions
  drop constraint agent_actions_action_kind_check;
alter table public.agent_actions
  add constraint agent_actions_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message'));

alter table public.agent_authority
  drop constraint agent_authority_action_kind_check;
alter table public.agent_authority
  add constraint agent_authority_action_kind_check
  check (action_kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'cover_ask', 'first_week_message'));

-- Three constraints, not two. cover_ask never needed a template because it
-- re-asks through the cover plumbing rather than mailing a member, so 0208
-- widened this one to three kinds while widening the others to four — and
-- a job whose template cannot be stored is a job that raises "No approved
-- template" the first time somebody approves it.
alter table public.agent_message_templates
  drop constraint agent_message_templates_kind_check;
alter table public.agent_message_templates
  add constraint agent_message_templates_kind_check
  check (kind in
    ('chase_message', 'plan_adjustment_offer', 'retention_message',
     'first_week_message'));

-- ============================================================================
-- 2. Switching the job on and off
-- ============================================================================
--
-- The authority row IS the flag: no row, no proposals. Switching off drops
-- the row and expires whatever was still waiting on an answer, so a job
-- that has been turned off cannot leave questions behind it.

create or replace function public.set_first_week_job(
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
    values (p_gym_id, 'first_week_message', 'approval', auth.uid())
    on conflict (gym_id, action_kind) do nothing;
    insert into public.agent_message_templates (gym_id, kind, body, approved_by)
    values
      (p_gym_id, 'first_week_message',
       'Hi {first_name} — it''s {gym_name}. You joined a little while back '
       || 'and we haven''t got you in yet. No pressure and no hard sell: if '
       || 'you''re not sure where to start, just reply and we''ll pick a '
       || 'class that suits you. The first one is the only hard one.',
       auth.uid())
    on conflict (gym_id, kind) do nothing;
  else
    delete from public.agent_authority
      where gym_id = p_gym_id and action_kind = 'first_week_message';
    update public.agent_actions
      set status = 'expired'
      where gym_id = p_gym_id and action_kind = 'first_week_message'
        and status = 'proposed';
  end if;
end;
$$;

revoke all on function public.set_first_week_job(uuid, boolean) from public, anon;
grant execute on function public.set_first_week_job(uuid, boolean) to authenticated;

-- ============================================================================
-- 3. The executor learns one more subject line
-- ============================================================================
--
-- Restated from 0208 with a single branch added. Extracted verbatim and
-- diffed rather than rewritten from memory — this function is the one path
-- by which any job's approved action actually reaches a member, and a
-- branch lost here is a job that silently sends nothing.

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
    when 'first_week_message'
      then 'Getting you started at ' || coalesce(v_gym.name, 'the gym')
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
-- 4. The tick — daily
-- ============================================================================

create or replace function public.agent_first_week_tick()
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
  v_action   uuid;
  v_days     integer;
  v_booked   integer;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name, gm.created_at as joined_at,
           a.level
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      where a.action_kind = 'first_week_message' and a.level <> 'reserved'
        and gm.created_at
              between now() - interval '30 days' and now() - interval '7 days'
        and exists (select 1 from public.plan_subscriptions ps
                     where ps.gym_id = gm.gym_id
                       and ps.profile_id = gm.profile_id
                       and ps.status = 'active')
        -- Rule 1. A migration is not a new joiner.
        and not exists (select 1 from public.pending_members pm
                         where pm.gym_id = gm.gym_id
                           and pm.linked_profile_id = gm.profile_id)
        -- Has never trained. Booking and not turning up still counts as
        -- never started — the evidence below says which it was.
        and not exists (select 1 from public.class_bookings cb
                         where cb.gym_id = gm.gym_id
                           and cb.profile_id = gm.profile_id
                           and cb.attended_at is not null)
        -- Rule 2. Once, ever — so a "no" is final for that member.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'first_week_message')
      order by gm.created_at
  loop
    -- Rule 4.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'first_week_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_days := greatest(1, floor(extract(epoch from now() - m.joined_at)
      / 86400)::integer);

    -- Booked and not come is a different thing from never booked, and the
    -- owner decides differently on each, so the card says which.
    select count(*)::int into v_booked
      from public.class_bookings cb
      where cb.gym_id = m.gym_id and cb.profile_id = m.profile_id;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'retention', 'first_week_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'days_since_join', v_days
       ),
       jsonb_build_array(
         'Joined on ' || to_char(m.joined_at, 'DD Mon') || ' — '
           || v_days || ' day' || case when v_days = 1 then '' else 's' end
           || ' ago.',
         case when v_booked = 0
              then 'Has not booked anything yet.'
              else 'Booked ' || v_booked || ' class'
                   || case when v_booked = 1 then '' else 'es' end
                   || ' and has not been to one.'
         end,
         'Paying for an active membership.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if m.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-first-week-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$$;

revoke all on function public.agent_first_week_tick()
  from public, anon, authenticated;

-- ============================================================================
-- 5. Schedule
-- ============================================================================
--
-- 09:15, after the 08:45 retention tick. The two never contend — they have
-- separate kinds and separate caps — but a member who has never trained
-- cannot also be a regular gone quiet, so running them in this order keeps
-- the day's proposals reading in the order a person would notice them.

select cron.schedule(
  'agent-first-week-tick',
  '15 9 * * *',
  $$select public.agent_first_week_tick();$$
);

commit;
