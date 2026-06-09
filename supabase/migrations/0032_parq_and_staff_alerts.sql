-- PAR-Q / health screening.
--
-- Per-gym questionnaire that members fill in at signup and re-fill
-- annually. Each completed response can carry a flag (one or more
-- "yes" answers on flagged questions) which surfaces to staff as
-- (a) a badge on the Members tab + class booking lists, and (b) a
-- new staff-alert in the inbox.
--
-- Schema rationale:
--   parq_questionnaires - one row per (gym, version). Owners edit
--     by publishing a NEW version, never editing a published one,
--     so historical responses stay tied to the exact wording the
--     member saw. is_active flags which version new respondents
--     should fill in.
--   parq_questions - ordered list of prompts. flag_on_yes marks the
--     ones where a "yes" answer raises a health flag (the classic
--     "do you experience chest pain" set).
--   parq_responses - one row per (member, questionnaire) completion.
--     has_flag is denormalised from the answers so the Members tab
--     can query at a glance without joining + aggregating.
--   parq_answers - one row per question, with optional explanation.
--   staff_alerts - generic gym-scoped alert table so we can grow
--     beyond PAR-Q later (e.g. failed payments, missed check-ins).
--     RLS gated on can_see_health_flag for now; other alert kinds
--     can use their own predicate when they ship.
--
-- Annual gate: current_parq_state(p_gym_id, p_profile_id) returns
-- a single row with `needs_parq` true when there's no response or
-- the latest one is > 365 days old. The redirect on /index.tsx
-- uses this to bounce members into the PAR-Q form before they
-- reach /book.
--
-- RLS:
--   parq_questionnaires + parq_questions - any gym member can read
--     the currently-active version; can_manage_parq writes.
--   parq_responses + parq_answers - self read/write, plus
--     can_see_health_flag read for staff. No staff writes.
--   staff_alerts - can_see_health_flag read; writes via the
--     submit_parq_response RPC (security-definer).
--
-- The submit_parq_response RPC is the single write path for member
-- submissions. It inserts the response + answers + a staff_alert
-- when has_flag is true, all in one transaction.

begin;

-- ============================================================================
-- 1. Register can_manage_parq + can_acknowledge_alerts
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
    else false
  end;
$$;

-- ============================================================================
-- 2. parq_questionnaires + parq_questions
-- ============================================================================

create table if not exists public.parq_questionnaires (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  version       integer not null,
  is_active     boolean not null default true,
  published_by  uuid references public.profiles(id),
  published_at  timestamptz not null default now(),
  unique (gym_id, version)
);

-- Only one active questionnaire per gym at a time. New publish flips
-- the prior active row to is_active=false.
create unique index parq_questionnaires_one_active_per_gym
  on public.parq_questionnaires (gym_id)
  where is_active;

create table if not exists public.parq_questions (
  id              uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null
    references public.parq_questionnaires(id) on delete cascade,
  sort_order      integer not null,
  prompt          text not null,
  flag_on_yes     boolean not null default true,
  unique (questionnaire_id, sort_order)
);

-- ============================================================================
-- 3. parq_responses + parq_answers
-- ============================================================================

create table if not exists public.parq_responses (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  questionnaire_id uuid not null
    references public.parq_questionnaires(id) on delete cascade,
  completed_at    timestamptz not null default now(),
  has_flag        boolean not null default false,
  -- Composite FK so a response can't outlive the membership.
  foreign key (gym_id, profile_id)
    references public.gym_memberships(gym_id, profile_id) on delete cascade
);

create index parq_responses_member_recent_idx
  on public.parq_responses (gym_id, profile_id, completed_at desc);

create table if not exists public.parq_answers (
  response_id  uuid not null
    references public.parq_responses(id) on delete cascade,
  question_id  uuid not null
    references public.parq_questions(id) on delete cascade,
  answered_yes boolean not null,
  explanation  text,
  primary key (response_id, question_id)
);

-- ============================================================================
-- 4. staff_alerts
-- ============================================================================

create table if not exists public.staff_alerts (
  id               uuid primary key default gen_random_uuid(),
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  kind             text not null
    check (kind in ('parq_flag')),
  subject_profile_id uuid references public.profiles(id) on delete set null,
  related_id       uuid,
  created_at       timestamptz not null default now(),
  acknowledged_by  uuid references public.profiles(id),
  acknowledged_at  timestamptz
);

create index staff_alerts_open_idx
  on public.staff_alerts (gym_id, created_at desc)
  where acknowledged_at is null;

-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table public.parq_questionnaires enable row level security;
alter table public.parq_questions enable row level security;
alter table public.parq_responses enable row level security;
alter table public.parq_answers enable row level security;
alter table public.staff_alerts enable row level security;

-- Questionnaires + questions: any gym member can SELECT, can_manage_parq writes.

create policy parq_questionnaires_member_select on public.parq_questionnaires
  for select using (
    exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id = parq_questionnaires.gym_id
        and gm.profile_id = auth.uid()
        and gm.left_at is null
    )
  );

create policy parq_questionnaires_manage_write on public.parq_questionnaires
  for all using (public.effective_can(gym_id, 'can_manage_parq'))
  with check (public.effective_can(gym_id, 'can_manage_parq'));

create policy parq_questions_member_select on public.parq_questions
  for select using (
    exists (
      select 1 from public.parq_questionnaires q
      join public.gym_memberships gm on gm.gym_id = q.gym_id
      where q.id = parq_questions.questionnaire_id
        and gm.profile_id = auth.uid()
        and gm.left_at is null
    )
  );

create policy parq_questions_manage_write on public.parq_questions
  for all using (
    exists (
      select 1 from public.parq_questionnaires q
      where q.id = parq_questions.questionnaire_id
        and public.effective_can(q.gym_id, 'can_manage_parq')
    )
  )
  with check (
    exists (
      select 1 from public.parq_questionnaires q
      where q.id = parq_questions.questionnaire_id
        and public.effective_can(q.gym_id, 'can_manage_parq')
    )
  );

-- Responses + answers: self read/write, can_see_health_flag staff read.

create policy parq_responses_self_or_staff_select on public.parq_responses
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_see_health_flag')
  );

create policy parq_responses_self_insert on public.parq_responses
  for insert with check (profile_id = auth.uid());

create policy parq_answers_self_or_staff_select on public.parq_answers
  for select using (
    exists (
      select 1 from public.parq_responses r
      where r.id = parq_answers.response_id
        and (
          r.profile_id = auth.uid()
          or public.effective_can(r.gym_id, 'can_see_health_flag')
        )
    )
  );

create policy parq_answers_self_insert on public.parq_answers
  for insert with check (
    exists (
      select 1 from public.parq_responses r
      where r.id = parq_answers.response_id
        and r.profile_id = auth.uid()
    )
  );

-- Staff alerts: can_see_health_flag read; can_acknowledge_alerts update.
-- No insert via RLS — only the security-definer RPC creates rows.

create policy staff_alerts_staff_select on public.staff_alerts
  for select using (public.effective_can(gym_id, 'can_see_health_flag'));

create policy staff_alerts_ack_update on public.staff_alerts
  for update
  using (public.effective_can(gym_id, 'can_acknowledge_alerts'))
  with check (public.effective_can(gym_id, 'can_acknowledge_alerts'));

-- ============================================================================
-- 6. RPCs
-- ============================================================================

-- submit_parq_response — single write path for member submissions.
-- Accepts answers as a jsonb array of {question_id, answered_yes, explanation}.
-- Inserts response + answers + a staff_alert when any flag_on_yes question
-- was answered yes.
create or replace function public.submit_parq_response(
  p_gym_id           uuid,
  p_questionnaire_id uuid,
  p_answers          jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller        uuid := auth.uid();
  v_response_id   uuid;
  v_has_flag      boolean;
  v_membership_ok boolean;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = v_caller
      and gm.left_at is null
  ) into v_membership_ok;

  if not v_membership_ok then
    raise exception 'Not a member of this gym';
  end if;

  -- The submitted questionnaire must belong to the gym (cross-gym mixups
  -- shouldn't pass RLS but a defensive check costs nothing).
  if not exists (
    select 1 from public.parq_questionnaires q
    where q.id = p_questionnaire_id and q.gym_id = p_gym_id
  ) then
    raise exception 'Questionnaire does not belong to this gym';
  end if;

  -- Compute has_flag from answers + question.flag_on_yes
  select coalesce(bool_or(
    coalesce((a->>'answered_yes')::boolean, false)
    and coalesce(qq.flag_on_yes, false)
  ), false)
  into v_has_flag
  from jsonb_array_elements(p_answers) a
  join public.parq_questions qq
    on qq.id = (a->>'question_id')::uuid
  where qq.questionnaire_id = p_questionnaire_id;

  insert into public.parq_responses
    (gym_id, profile_id, questionnaire_id, has_flag)
    values (p_gym_id, v_caller, p_questionnaire_id, v_has_flag)
    returning id into v_response_id;

  insert into public.parq_answers
    (response_id, question_id, answered_yes, explanation)
  select
    v_response_id,
    (a->>'question_id')::uuid,
    coalesce((a->>'answered_yes')::boolean, false),
    nullif(a->>'explanation', '')
  from jsonb_array_elements(p_answers) a;

  -- Mirror the flag onto gym_memberships so legacy code that reads
  -- gym_memberships.health_flag (set at signup) stays accurate.
  update public.gym_memberships gm
    set health_flag = v_has_flag,
        par_q_id    = v_response_id
    where gm.gym_id = p_gym_id and gm.profile_id = v_caller;

  if v_has_flag then
    insert into public.staff_alerts
      (gym_id, kind, subject_profile_id, related_id)
      values (p_gym_id, 'parq_flag', v_caller, v_response_id);
  end if;

  return v_response_id;
end;
$$;

grant execute on function public.submit_parq_response(uuid, uuid, jsonb)
  to authenticated;

-- current_parq_state — annual gate the client uses to decide whether
-- to bounce the user to the PAR-Q form. Returns one row.
create or replace function public.current_parq_state(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  active_questionnaire_id uuid,
  last_response_id        uuid,
  last_completed_at       timestamptz,
  last_had_flag           boolean,
  needs_parq              boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active   uuid;
  v_response public.parq_responses%rowtype;
  v_expired_after interval := interval '365 days';
begin
  -- Authorise: caller must be the subject OR have can_see_health_flag.
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if auth.uid() <> p_profile_id
     and not public.effective_can(p_gym_id, 'can_see_health_flag') then
    raise exception 'Not authorised';
  end if;

  select id into v_active
    from public.parq_questionnaires
    where gym_id = p_gym_id and is_active
    limit 1;

  select * into v_response
    from public.parq_responses r
    where r.gym_id = p_gym_id and r.profile_id = p_profile_id
    order by completed_at desc
    limit 1;

  active_questionnaire_id := v_active;
  last_response_id        := v_response.id;
  last_completed_at       := v_response.completed_at;
  last_had_flag           := v_response.has_flag;

  -- Needs PAR-Q when:
  --   - the gym has an active questionnaire AND
  --   - the member has no response OR their last response is on an
  --     older questionnaire version OR is > 365 days old
  if v_active is null then
    needs_parq := false;
  elsif v_response.id is null then
    needs_parq := true;
  elsif v_response.questionnaire_id <> v_active then
    needs_parq := true;
  elsif v_response.completed_at < (now() - v_expired_after) then
    needs_parq := true;
  else
    needs_parq := false;
  end if;

  return next;
end;
$$;

grant execute on function public.current_parq_state(uuid, uuid)
  to authenticated;

-- acknowledge_staff_alert — staff marks an alert handled.
create or replace function public.acknowledge_staff_alert(
  p_alert_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym_id
    from public.staff_alerts where id = p_alert_id;
  if v_gym_id is null then
    raise exception 'Alert not found';
  end if;
  if not public.effective_can(v_gym_id, 'can_acknowledge_alerts') then
    raise exception 'Not authorised';
  end if;
  update public.staff_alerts
    set acknowledged_by = auth.uid(),
        acknowledged_at = now()
    where id = p_alert_id;
end;
$$;

grant execute on function public.acknowledge_staff_alert(uuid)
  to authenticated;

commit;
