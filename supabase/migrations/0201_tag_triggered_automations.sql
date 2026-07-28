-- Tag-gained email automations, on a tag anchor that can be trusted.
--
-- New trigger for the automations engine: member_tagged — "when a member
-- gains tag X, send this email (and its follow-up sequence)". Params carry
-- the one knob the trigger needs: {"tag": "<member_tags.label>"}. It fires
-- for manual tags and rule-applied tags alike, so "manually tag a member
-- VIP" and "the Ghosting rule matched them overnight" both start the same
-- sequence. Fired once per (automation, member) — the idempotency key has
-- no date segment, so losing and regaining the tag never re-sends.
--
-- The anchor is member_tags.created_at, which until now was a lie for auto
-- tags: _apply_tag_rules (0014, rewritten 0200) deleted every auto tag and
-- reinserted the lot, so each recompute stamped long-standing tags with a
-- fresh created_at. Any "only tags gained after the automation was created"
-- gate would see the entire back-catalogue as newly gained on the first
-- nightly recompute and blast everyone. So part 1 makes the recompute
-- incremental: matching members' existing rows survive untouched (keeping
-- created_at and created_by), only members entering the rule are inserted
-- and only members leaving it are deleted. created_at now genuinely means
-- "when the member gained this tag".

begin;

-- ============================================================================
-- 1. Incremental _apply_tag_rules — created_at survives recomputes
-- ============================================================================

create or replace function public._apply_tag_rules(p_gym_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule  public.tag_rules%rowtype;
  v_total integer := 0;
begin
  -- Tags of paused rules go away (deleted rules already cascade via rule_id).
  delete from public.member_tags mt
    using public.tag_rules r
    where mt.rule_id = r.id
      and mt.gym_id = p_gym_id
      and not r.active;

  for v_rule in
    select * from public.tag_rules
    where gym_id = p_gym_id and active = true
  loop
    -- A rule edit that changed label or colour re-creates its tags: the
    -- label is the row's conflict identity, so it can't be moved in place.
    -- The re-created tags get a fresh created_at — a renamed rule is a new
    -- anchor, which is also what saves member_tagged automations pointed at
    -- the old label from matching the new one's history.
    delete from public.member_tags mt
      where mt.rule_id = v_rule.id
        and (mt.label <> v_rule.label or mt.color <> v_rule.color);

    with matches as (
      select c.profile_id
      from public.v_member_cohort c
      where c.gym_id = p_gym_id
        and case v_rule.predicate_kind
          when 'intro'         then c.is_intro
          when 'expiring_soon' then c.days_until_expiry is not null
                                    and c.days_until_expiry <= coalesce(v_rule.threshold_days, 7)
          when 'expired'       then c.is_expired
          when 'paying'        then c.is_paying
          when 'inactive'      then not c.is_active
          when 'never_paid'    then not c.is_paying
          when 'booked_class_type' then exists (
            select 1
            from public.class_bookings cb
            join public.class_sessions cs on cs.id = cb.class_session_id
            where cb.gym_id = p_gym_id
              and cb.profile_id = c.profile_id
              and cs.class_type_id = v_rule.class_type_id
              and (v_rule.threshold_days is null
                   or cs.starts_at >= now() - make_interval(days => v_rule.threshold_days))
          )
          when 'attended_class_type' then exists (
            select 1
            from public.class_bookings cb
            join public.class_sessions cs on cs.id = cb.class_session_id
            where cb.gym_id = p_gym_id
              and cb.profile_id = c.profile_id
              and cs.class_type_id = v_rule.class_type_id
              and cb.attended_at is not null
              and (v_rule.threshold_days is null
                   or cb.attended_at >= now() - make_interval(days => v_rule.threshold_days))
          )
          when 'no_recent_attendance' then not exists (
            select 1
            from public.class_bookings cb
            where cb.gym_id = p_gym_id
              and cb.profile_id = c.profile_id
              and cb.attended_at is not null
              and cb.attended_at >= now() - make_interval(days => v_rule.threshold_days)
          )
          when 'on_plan' then exists (
            select 1
            from public.plan_subscriptions ps
            where ps.gym_id = p_gym_id
              and ps.profile_id = c.profile_id
              and ps.plan_id = v_rule.plan_id
              and ps.status in ('active', 'cancelled_at_period_end', 'refunded_retained')
          )
          when 'cancelling' then exists (
            select 1
            from public.plan_subscriptions ps
            where ps.gym_id = p_gym_id
              and ps.profile_id = c.profile_id
              and ps.status = 'cancelled_at_period_end'
          )
          when 'joined_within' then
            c.joined_at >= now() - make_interval(days => v_rule.threshold_days)
          else false
        end
    ),
    pruned as (
      delete from public.member_tags mt
      where mt.rule_id = v_rule.id
        and mt.profile_id not in (select profile_id from matches)
    )
    insert into public.member_tags
      (gym_id, profile_id, label, color, source, rule_id, created_by)
    select
      p_gym_id, m.profile_id, v_rule.label, v_rule.color, 'auto',
      v_rule.id, coalesce(p_actor, v_rule.created_by)
    from matches m
    on conflict (gym_id, profile_id, label) do nothing;
  end loop;

  -- "Auto tags now in place", not "rows inserted this run" — surviving tags
  -- are no longer reinserted, and the Recompute-now UI reports this count.
  select count(*) into v_total
    from public.member_tags
    where gym_id = p_gym_id and source = 'auto';

  return v_total;
end;
$$;

-- ============================================================================
-- 2. member_tagged trigger type
-- ============================================================================

alter table public.email_automations
  drop constraint email_automations_trigger_type_check;

alter table public.email_automations
  add constraint email_automations_trigger_type_check check (trigger_type in (
    'member_joined', 'member_first_class', 'member_inactive', 'lead_cold',
    'member_tagged'
  ));

-- ============================================================================
-- 3. Enqueue sweep — 0119's body plus the member_tagged branch
-- ============================================================================
--
-- The new branch anchors on member_tags.created_at: only tags gained at or
-- after the automation's created_at are eligible (enabling never blasts
-- members already carrying the tag), and the primary idempotency key is the
-- date-less 'auto:<automation>:member:<profile>' — once per member, ever.
-- The plan-conditions gate applies like every other member trigger. A blank
-- or missing params.tag matches nothing rather than everything.

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
  v_tz    text;
  v_tag   text;
begin
  for a in select * from public.email_automations where enabled loop
    select coalesce(nullif(timezone, ''), 'UTC') into v_tz
      from public.gyms where id = a.gym_id;

    if a.trigger_type = 'member_joined' then
      insert into public.email_automation_runs
        (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':member:' || s.profile_id,
             public._automation_send_slot(gm.created_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
      from public.gym_memberships gm
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = gm.profile_id
      cross join lateral public._automation_emails(a) stp
      where gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
        and gm.created_at >= a.created_at
        and public._automation_send_slot(gm.created_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_first_class' then
      v_types := jsonb_array_length(coalesce(a.conditions->'class_type_ids', '[]'::jsonb)) > 0;
      insert into public.email_automation_runs
        (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':booking:' || b.id,
             public._automation_send_slot(b.attended_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
      from public.class_bookings b
      join public.class_sessions cs on cs.id = b.class_session_id
      join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
        on s.profile_id = b.profile_id
      cross join lateral public._automation_emails(a) stp
      where b.gym_id = a.gym_id and b.attended_at is not null
        and b.attended_at >= a.created_at
        and public._automation_send_slot(b.attended_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
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
        (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, s.profile_id, s.email, s.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':member:' || s.profile_id || ':' || to_char(la.last_at, 'YYYY-MM-DD'),
             public._automation_send_slot(la.last_at + make_interval(days => v_days) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
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
      cross join lateral public._automation_emails(a) stp
      where la.last_at >= a.created_at
        and public._automation_send_slot(la.last_at + make_interval(days => v_days) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
        and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;

    elsif a.trigger_type = 'member_tagged' then
      v_tag := nullif(trim(coalesce(a.params->>'tag', '')), '');
      if v_tag is not null then
        insert into public.email_automation_runs
          (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
           status, idempotency_key, scheduled_at)
        select a.gym_id, a.id, stp.step_id, s.profile_id, s.email, s.full_name, 'queued',
               'auto:' || a.id
                 || case when stp.step_id is null then '' else ':step:' || stp.step_id end
                 || ':member:' || s.profile_id,
               public._automation_send_slot(mt.created_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
        from public.member_tags mt
        join public.comms_audience_rows(a.gym_id, '{"kind":"all_members"}'::jsonb, a.topic_id) s
          on s.profile_id = mt.profile_id
        cross join lateral public._automation_emails(a) stp
        where mt.gym_id = a.gym_id
          and mt.label = v_tag
          and mt.created_at >= a.created_at
          and public._automation_send_slot(mt.created_at + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
          and public._automation_member_ok(a.gym_id, s.profile_id, a.conditions)
        on conflict (idempotency_key) do nothing;
        get diagnostics v_rows = row_count;
        v_total := v_total + v_rows;
      end if;

    elsif a.trigger_type = 'lead_cold' then
      v_hours := coalesce((a.params->>'cold_hours')::int, 24);
      insert into public.email_automation_runs
        (gym_id, automation_id, step_id, lead_id, recipient_email, recipient_name,
         status, idempotency_key, scheduled_at)
      select a.gym_id, a.id, stp.step_id, l.id, l.email, l.full_name, 'queued',
             'auto:' || a.id
               || case when stp.step_id is null then '' else ':step:' || stp.step_id end
               || ':lead:' || l.id,
             public._automation_send_slot(l.captured_at + make_interval(hours => v_hours) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz)
      from public.leads l
      cross join lateral public._automation_emails(a) stp
      where l.gym_id = a.gym_id and l.status = 'cold'
        and l.archived_at is null and l.converted_profile_id is null
        and l.marketing_consent = true
        and l.email is not null and length(trim(l.email)) > 0
        and l.captured_at >= a.created_at
        and public._automation_send_slot(l.captured_at + make_interval(hours => v_hours) + make_interval(mins => stp.dmin), stp.sh, stp.sd, v_tz) <= now()
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
