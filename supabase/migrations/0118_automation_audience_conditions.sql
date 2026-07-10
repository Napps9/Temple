-- Email automations — audience conditions (feature 1 of 3).
--
-- Until now every automation fires for its whole trigger population: every
-- new member, every first class, every cold lead. Owners want to target a
-- segment instead — "welcome only members on the Unlimited plan", "follow up
-- only after a first Barbell class", "nurture only leads from the website".
--
-- We add a single `conditions` jsonb to email_automations and thread it into
-- enqueue_due_automation_runs. Shape (any key absent or empty array = no
-- filter, so existing automations are unchanged):
--
--   { "plan_ids":        ["<membership_plans.plan_id>", ...],   -- member triggers
--     "class_type_ids":  ["<class_types.id>", ...],             -- member_first_class
--     "lead_source_ids": ["<lead_sources.id>", ...] }           -- lead_cold
--
-- Recipient resolution + suppression still go through comms_audience_rows;
-- conditions are extra predicates layered on top. Cross-tenant ids are inert:
-- every join is scoped to the automation's gym, so a foreign id simply never
-- matches (no leak, no error).

begin;

alter table public.email_automations
  add column conditions jsonb not null default '{}'::jsonb;

-- Member-plan gate, shared by the three member triggers. "On a plan" means an
-- entitled subscription — the same paid-state set v_member_cohort treats as
-- current. No plan_ids configured → everyone passes.
create or replace function public._automation_member_ok(
  p_gym uuid, p_profile uuid, p_conditions jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when jsonb_array_length(coalesce(p_conditions->'plan_ids', '[]'::jsonb)) = 0 then true
    else exists (
      select 1 from public.plan_subscriptions ps
      where ps.gym_id = p_gym
        and ps.profile_id = p_profile
        and ps.status in ('active', 'cancelled_at_period_end', 'refunded_retained')
        and ps.plan_id::text in (
          select jsonb_array_elements_text(p_conditions->'plan_ids'))
    )
  end;
$$;
revoke execute on function public._automation_member_ok(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- Rewrite the sweep to apply conditions. Structurally identical to 0116 apart
-- from the added predicates: member triggers gain the plan gate; first-class
-- gains a class-type gate (anchored to the first attended class OF THAT TYPE,
-- so both the outer row and the "no earlier class" guard are type-scoped);
-- lead_cold gains a source gate.
create or replace function public.enqueue_due_automation_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a       public.email_automations%rowtype;
  v_total integer := 0;
  v_rows  integer;
  v_days  integer;
  v_hours integer;
  v_types boolean;
begin
  for a in select * from public.email_automations
             where enabled and compiled_html is not null loop
    if a.trigger_type = 'member_joined' then
      insert into public.email_automation_runs
        (gym_id, automation_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id || ':member:' || s.profile_id,
             gm.created_at + make_interval(mins => a.delay_minutes)
      from public.gym_memberships gm
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = gm.profile_id
      where gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
        and gm.created_at >= a.created_at
        and gm.created_at + make_interval(mins => a.delay_minutes) <= now()
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_first_class' then
      v_types := jsonb_array_length(coalesce(a.conditions->'class_type_ids', '[]'::jsonb)) > 0;
      insert into public.email_automation_runs
        (gym_id, automation_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id || ':booking:' || b.id,
             b.attended_at + make_interval(mins => a.delay_minutes)
      from public.class_bookings b
      join public.class_sessions cs on cs.id = b.class_session_id
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = b.profile_id
      where b.gym_id = a.gym_id and b.attended_at is not null
        and b.attended_at >= a.created_at
        and b.attended_at + make_interval(mins => a.delay_minutes) <= now()
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
        and (not v_types or cs.class_type_id::text in (
              select jsonb_array_elements_text(a.conditions->'class_type_ids')))
        and not exists (
          select 1 from public.class_bookings b2
          join public.class_sessions cs2 on cs2.id = b2.class_session_id
          where b2.gym_id = a.gym_id and b2.profile_id = b.profile_id
            and b2.attended_at is not null and b2.attended_at < b.attended_at
            and (not v_types or cs2.class_type_id::text in (
                  select jsonb_array_elements_text(a.conditions->'class_type_ids'))))
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_inactive' then
      v_days := coalesce((a.params->>'inactive_days')::int, 21);
      insert into public.email_automation_runs
        (gym_id, automation_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id || ':member:' || s.profile_id || ':' || to_char(la.last_at, 'YYYY-MM-DD'),
             la.last_at + make_interval(days => v_days)
      from (
        select b.profile_id, max(b.attended_at) as last_at
        from public.class_bookings b
        where b.gym_id = a.gym_id and b.attended_at is not null
        group by b.profile_id
      ) la
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.profile_id = la.profile_id
       and gm.role = 'member' and gm.left_at is null
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = la.profile_id
      where la.last_at >= a.created_at
        and la.last_at < now() - make_interval(days => v_days)
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'lead_cold' then
      v_hours := coalesce((a.params->>'cold_hours')::int, 24);
      insert into public.email_automation_runs
        (gym_id, automation_id, lead_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, l.id, l.email, l.full_name, 'queued',
             'auto:' || a.id || ':lead:' || l.id,
             l.captured_at + make_interval(hours => v_hours)
      from public.leads l
      where l.gym_id = a.gym_id and l.status = 'cold'
        and l.archived_at is null and l.converted_profile_id is null
        and l.marketing_consent = true
        and l.email is not null and length(trim(l.email)) > 0
        and l.captured_at >= a.created_at
        and l.captured_at + make_interval(hours => v_hours) <= now()
        and (jsonb_array_length(coalesce(a.conditions->'lead_source_ids', '[]'::jsonb)) = 0
             or l.source_id::text in (
                  select jsonb_array_elements_text(a.conditions->'lead_source_ids')))
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    end if;
  end loop;

  return v_total;
end;
$$;
revoke execute on function public.enqueue_due_automation_runs()
  from public, anon, authenticated;

commit;
