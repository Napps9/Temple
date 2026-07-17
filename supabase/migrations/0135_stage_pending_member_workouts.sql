-- Deferred workout history for pending (imported, not-yet-signed-up)
-- members.
--
-- The workout importers (0072 weighted, 0132 sections, 0133 hyrox) write
-- into a member's real training log, which needs a real profile. During a
-- migration the members are imported as `pending_members` and don't have a
-- profile until they sign up — so their history was skipped as
-- "email not in this gym yet", and the "populated /track from day one"
-- promise couldn't hold.
--
-- This stages a result whose email matches a pending member (rather than
-- skipping it) and flushes the staged rows into the member's real log on
-- signup, reusing the same apply_pending_member_data trigger that already
-- applies their imported plan + tags. Rows whose email matches no member
-- and no pending member are still skipped.

begin;

-- ============================================================================
-- 1. Staging table
-- ============================================================================
-- One row per staged result. `payload` carries the already-coerced fields
-- the flush needs (kind decides the target table). `dedup_key` makes a
-- re-run of the same import idempotent (email is stored lowercased).

create table public.pending_member_workouts (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  email        text not null,
  performed_on date not null,
  kind         text not null check (kind in ('movement', 'section', 'hyrox')),
  dedup_key    text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

create unique index pending_member_workouts_dedup_idx
  on public.pending_member_workouts (gym_id, email, performed_on, kind, dedup_key);
create index pending_member_workouts_gym_email_idx
  on public.pending_member_workouts (gym_id, email);

alter table public.pending_member_workouts enable row level security;

-- Staff who can see workout logs may read the staging queue; writes only
-- ever happen through the SECURITY DEFINER import RPCs + the flush trigger.
create policy pending_member_workouts_staff_select
  on public.pending_member_workouts
  for select using (public.effective_can(gym_id, 'can_see_workout_logs'));

-- ============================================================================
-- 2. Flush staged workouts on signup (extend apply_pending_member_data)
-- ============================================================================
-- Same trigger that applies imported plan/tags. Runs before the pending
-- lookup so staged history flushes for any signup with a matching email,
-- independent of whether a pending_members row still exists.

create or replace function public.apply_pending_member_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text;
  v_pending    public.pending_members%rowtype;
  v_plan       public.membership_plans%rowtype;
  v_tag        text;
  v_staged     public.pending_member_workouts%rowtype;
  v_workout_id uuid;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select u.email into v_email from auth.users u where u.id = new.profile_id;
  if v_email is null then
    return new;
  end if;

  -- Flush any workout history staged for this email into the new member's
  -- log. Rows on the same date collapse into one tracked_workouts parent.
  for v_staged in
    select * from public.pending_member_workouts
    where gym_id = new.gym_id and email = lower(v_email)
    order by performed_on
  loop
    select id into v_workout_id
      from public.tracked_workouts
      where gym_id = new.gym_id
        and profile_id = new.profile_id
        and performed_at::date = v_staged.performed_on
      order by performed_at
      limit 1;
    if v_workout_id is null then
      insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
        values (new.gym_id, new.profile_id, v_staged.performed_on::timestamptz, 'Imported')
        returning id into v_workout_id;
    end if;

    if v_staged.kind = 'movement' then
      insert into public.tracked_movement_results
        (gym_id, profile_id, workout_id, movement_key, track_key,
         value_numeric, value_unit, notes)
      values
        (new.gym_id, new.profile_id, v_workout_id,
         v_staged.payload->>'movement_key', v_staged.payload->>'track_key',
         nullif(v_staged.payload->>'value_numeric', '')::numeric,
         nullif(v_staged.payload->>'value_unit', ''),
         nullif(v_staged.payload->>'notes', ''));
    elsif v_staged.kind = 'hyrox' then
      insert into public.tracked_movement_results
        (gym_id, profile_id, workout_id, movement_key, track_key,
         value_seconds, notes)
      values
        (new.gym_id, new.profile_id, v_workout_id,
         v_staged.payload->>'movement_key', v_staged.payload->>'track_key',
         nullif(v_staged.payload->>'value_seconds', '')::int,
         nullif(v_staged.payload->>'notes', ''));
    elsif v_staged.kind = 'section' then
      insert into public.tracked_workout_sections
        (gym_id, profile_id, workout_id, section_category, section_format,
         title, notes, sort_order, total_time_seconds, total_rounds,
         total_extra_reps)
      values
        (new.gym_id, new.profile_id, v_workout_id,
         coalesce(nullif(v_staged.payload->>'section_category', ''), 'wod'),
         v_staged.payload->>'section_format',
         nullif(v_staged.payload->>'title', ''),
         nullif(v_staged.payload->>'notes', ''),
         coalesce((select max(sort_order) + 1 from public.tracked_workout_sections
                   where workout_id = v_workout_id), 0),
         nullif(v_staged.payload->>'total_time_seconds', '')::int,
         nullif(v_staged.payload->>'total_rounds', '')::int,
         nullif(v_staged.payload->>'total_extra_reps', '')::int);
    end if;
  end loop;

  delete from public.pending_member_workouts
    where gym_id = new.gym_id and email = lower(v_email);

  -- Imported plan / tags / suppression / subscription — the 0124 logic,
  -- carried forward verbatim (this recreation must not regress it).
  select * into v_pending
    from public.pending_members
    where gym_id = new.gym_id and lower(email) = lower(v_email)
    limit 1;
  if v_pending.id is null then
    return new;
  end if;

  update public.gym_memberships
    set imported_plan_name         = v_pending.plan_name,
        imported_plan_start        = v_pending.plan_start,
        imported_plan_end          = v_pending.plan_end,
        imported_credits_remaining = v_pending.credits_remaining,
        imported_at                = now(),
        emergency_contact           = coalesce(v_pending.emergency_contact, emergency_contact)
    where id = new.id;

  if v_pending.phone is not null then
    update public.profiles
      set phone = coalesce(phone, v_pending.phone)
      where id = new.profile_id;
  end if;

  foreach v_tag in array coalesce(v_pending.tags, '{}'::text[]) loop
    if length(trim(v_tag)) > 0 then
      insert into public.member_tags (gym_id, profile_id, label, color, source, created_by)
        select new.gym_id, new.profile_id, trim(v_tag), '#6B7280', 'manual', new.profile_id
        where not exists (
          select 1 from public.member_tags mt
          where mt.gym_id = new.gym_id
            and mt.profile_id = new.profile_id
            and lower(mt.label) = lower(trim(v_tag))
        );
    end if;
  end loop;

  if v_pending.unsubscribed then
    insert into public.email_unsubscribes
      (gym_id, email, profile_id, reason)
      values (v_pending.gym_id, v_pending.email, new.profile_id, 'imported')
      on conflict (gym_id, lower(email)) where topic_id is null do nothing;
  end if;

  if v_pending.linked_membership_plan_id is not null then
    select * into v_plan
      from public.membership_plans
      where plan_id = v_pending.linked_membership_plan_id;

    if v_plan.plan_id is not null and v_plan.archived_at is null then
      insert into public.plan_subscriptions (
        gym_membership_id, profile_id, gym_id, plan_id,
        status, credit_balance, paid_period_end,
        stripe_subscription_id, stripe_customer_id, priority,
        imported_legacy
      ) values (
        new.id, new.profile_id, new.gym_id, v_plan.plan_id,
        'active'::public.plan_sub_state,
        case
          when v_plan.kind in ('credit_pack', 'credit_period')
            then coalesce(v_pending.credits_remaining, v_plan.credit_count)
          else null
        end,
        case
          when coalesce(v_pending.plan_end, v_pending.next_bill_date) is not null
            then coalesce(v_pending.plan_end, v_pending.next_bill_date)::timestamptz
          else null
        end,
        nullif(v_pending.imported_stripe_subscription_id, ''),
        nullif(v_pending.imported_stripe_customer_id, ''),
        0,
        nullif(v_pending.imported_stripe_subscription_id, '') is null
      );

      if nullif(v_pending.imported_stripe_customer_id, '') is not null then
        insert into public.gym_stripe_customers (gym_id, profile_id, stripe_customer_id)
          values (new.gym_id, new.profile_id, v_pending.imported_stripe_customer_id)
          on conflict (gym_id, profile_id) do nothing;
      end if;
    end if;
  end if;

  update public.pending_members
    set status = 'linked',
        linked_at = now(),
        linked_profile_id = new.profile_id
    where id = v_pending.id;

  return new;
end;
$$;

-- ============================================================================
-- 3. Import RPCs: stage a pending member's row instead of skipping it
-- ============================================================================
-- Each returns an extra `staged` count. RETURNS shape changes, so DROP first.

drop function if exists public.import_member_workouts(uuid, jsonb);

create function public.import_member_workouts(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted_workouts    integer,
  inserted_results     integer,
  skipped_no_member    integer,
  skipped_no_movement  integer,
  staged               integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row               jsonb;
  v_email             text;
  v_date              date;
  v_movement_key      text;
  v_reps              integer;
  v_weight            numeric;
  v_unit              text;
  v_notes             text;
  v_track_key         text;
  v_profile_id        uuid;
  v_workout_id        uuid;
  v_inserted_workouts   integer := 0;
  v_inserted_results    integer := 0;
  v_skipped_no_member   integer := 0;
  v_skipped_no_movement integer := 0;
  v_staged              integer := 0;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised to import workouts for this gym';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email        := lower(nullif(trim(v_row->>'email'),     ''));
    v_movement_key :=         nullif(trim(v_row->>'movement_key'), '');
    v_unit         :=         coalesce(nullif(v_row->>'unit', ''), 'kg');
    v_notes        :=         nullif(v_row->>'notes', '');

    begin
      v_date := (v_row->>'date')::date;
    exception when others then
      continue;
    end;

    if v_email is null or v_date is null then
      continue;
    end if;
    if v_movement_key is null then
      v_skipped_no_movement := v_skipped_no_movement + 1;
      continue;
    end if;

    v_reps := nullif(v_row->>'reps', '')::int;
    if v_reps is null or v_reps < 1 then v_reps := 1; end if;
    if v_reps > 30 then v_reps := 30; end if;
    v_weight := nullif(v_row->>'weight', '')::numeric;
    v_track_key := v_reps || 'rm';

    select gm.profile_id into v_profile_id
      from public.gym_memberships gm
      join auth.users u on u.id = gm.profile_id
      where gm.gym_id = p_gym_id
        and gm.left_at is null
        and lower(u.email) = v_email
      limit 1;

    if v_profile_id is null then
      -- Stage against a pending member; otherwise it's a genuinely unknown
      -- email and we skip it.
      if exists (select 1 from public.pending_members
                 where gym_id = p_gym_id and lower(email) = v_email) then
        insert into public.pending_member_workouts
          (gym_id, email, performed_on, kind, dedup_key, payload)
        values (p_gym_id, v_email, v_date, 'movement',
          v_movement_key || '|' || v_track_key,
          jsonb_build_object(
            'movement_key', v_movement_key, 'track_key', v_track_key,
            'value_numeric', v_weight, 'value_unit', v_unit, 'notes', v_notes))
        on conflict (gym_id, email, performed_on, kind, dedup_key) do nothing;
        v_staged := v_staged + 1;
      else
        v_skipped_no_member := v_skipped_no_member + 1;
      end if;
      continue;
    end if;

    select id into v_workout_id
      from public.tracked_workouts
      where gym_id = p_gym_id
        and profile_id = v_profile_id
        and performed_at::date = v_date
      order by performed_at
      limit 1;
    if v_workout_id is null then
      insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
        values (p_gym_id, v_profile_id, v_date::timestamptz, 'Imported')
        returning id into v_workout_id;
      v_inserted_workouts := v_inserted_workouts + 1;
    end if;

    insert into public.tracked_movement_results
      (gym_id, profile_id, workout_id, movement_key, track_key,
       value_numeric, value_unit, notes)
    values
      (p_gym_id, v_profile_id, v_workout_id, v_movement_key, v_track_key,
       v_weight, v_unit, v_notes);
    v_inserted_results := v_inserted_results + 1;
  end loop;

  return query
    select v_inserted_workouts, v_inserted_results,
           v_skipped_no_member, v_skipped_no_movement, v_staged;
end;
$$;

grant execute on function public.import_member_workouts(uuid, jsonb)
  to authenticated;

drop function if exists public.import_member_results(uuid, jsonb);

create function public.import_member_results(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted_workouts  integer,
  inserted_sections  integer,
  skipped_no_member  integer,
  skipped_duplicate  integer,
  staged             integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row               jsonb;
  v_email             text;
  v_date              date;
  v_category          text;
  v_format            text;
  v_title             text;
  v_time_seconds      int;
  v_rounds            int;
  v_extra_reps        int;
  v_notes             text;
  v_profile_id        uuid;
  v_workout_id        uuid;
  v_sort_order        int;
  v_inserted_workouts int := 0;
  v_inserted_sections int := 0;
  v_skipped_no_member int := 0;
  v_skipped_duplicate int := 0;
  v_staged            int := 0;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised to import results for this gym';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email    := lower(nullif(trim(v_row->>'email'), ''));
    v_category := coalesce(nullif(trim(v_row->>'section_category'), ''), 'wod');
    v_format   := nullif(trim(v_row->>'section_format'), '');
    v_title    := nullif(trim(v_row->>'title'), '');
    v_notes    := nullif(v_row->>'notes', '');

    begin
      v_date := (v_row->>'date')::date;
    exception when others then
      continue;
    end;

    if v_email is null or v_date is null or v_format is null then
      continue;
    end if;

    v_time_seconds := nullif(v_row->>'total_time_seconds', '')::int;
    v_rounds       := nullif(v_row->>'total_rounds', '')::int;
    v_extra_reps   := nullif(v_row->>'total_extra_reps', '')::int;

    select gm.profile_id into v_profile_id
      from public.gym_memberships gm
      join auth.users u on u.id = gm.profile_id
      where gm.gym_id = p_gym_id
        and gm.left_at is null
        and lower(u.email) = v_email
      limit 1;

    if v_profile_id is null then
      if exists (select 1 from public.pending_members
                 where gym_id = p_gym_id and lower(email) = v_email) then
        insert into public.pending_member_workouts
          (gym_id, email, performed_on, kind, dedup_key, payload)
        values (p_gym_id, v_email, v_date, 'section',
          v_format || '|' || coalesce(v_title, ''),
          jsonb_build_object(
            'section_category', v_category, 'section_format', v_format,
            'title', v_title, 'notes', v_notes,
            'total_time_seconds', v_time_seconds, 'total_rounds', v_rounds,
            'total_extra_reps', v_extra_reps))
        on conflict (gym_id, email, performed_on, kind, dedup_key) do nothing;
        v_staged := v_staged + 1;
      else
        v_skipped_no_member := v_skipped_no_member + 1;
      end if;
      continue;
    end if;

    select id into v_workout_id
      from public.tracked_workouts
      where gym_id = p_gym_id
        and profile_id = v_profile_id
        and performed_at::date = v_date
      order by performed_at
      limit 1;
    if v_workout_id is null then
      insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
        values (p_gym_id, v_profile_id, v_date::timestamptz, 'Imported')
        returning id into v_workout_id;
      v_inserted_workouts := v_inserted_workouts + 1;
    end if;

    if exists (
      select 1 from public.tracked_workout_sections
      where workout_id = v_workout_id
        and section_format = v_format
        and coalesce(title, '') = coalesce(v_title, '')
    ) then
      v_skipped_duplicate := v_skipped_duplicate + 1;
      continue;
    end if;

    select coalesce(max(sort_order), -1) + 1 into v_sort_order
      from public.tracked_workout_sections
      where workout_id = v_workout_id;

    insert into public.tracked_workout_sections
      (gym_id, profile_id, workout_id, section_category, section_format,
       title, notes, sort_order, total_time_seconds, total_rounds,
       total_extra_reps)
    values
      (p_gym_id, v_profile_id, v_workout_id, v_category, v_format,
       v_title, v_notes, v_sort_order, v_time_seconds, v_rounds,
       v_extra_reps);
    v_inserted_sections := v_inserted_sections + 1;
  end loop;

  return query
    select v_inserted_workouts, v_inserted_sections,
           v_skipped_no_member, v_skipped_duplicate, v_staged;
end;
$$;

grant execute on function public.import_member_results(uuid, jsonb)
  to authenticated;

drop function if exists public.import_member_hyrox_results(uuid, jsonb);

create function public.import_member_hyrox_results(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted_workouts  integer,
  inserted_results   integer,
  skipped_no_member  integer,
  skipped_duplicate  integer,
  staged             integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row               jsonb;
  v_email             text;
  v_date              date;
  v_movement_key      text;
  v_track_key         text;
  v_value_seconds     int;
  v_notes             text;
  v_profile_id        uuid;
  v_workout_id        uuid;
  v_inserted_workouts int := 0;
  v_inserted_results  int := 0;
  v_skipped_no_member int := 0;
  v_skipped_duplicate int := 0;
  v_staged            int := 0;
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Not authorised to import results for this gym';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email        := lower(nullif(trim(v_row->>'email'), ''));
    v_movement_key := nullif(trim(v_row->>'movement_key'), '');
    v_track_key    := nullif(trim(v_row->>'track_key'), '');
    v_notes        := nullif(v_row->>'notes', '');

    begin
      v_date := (v_row->>'date')::date;
    exception when others then
      continue;
    end;

    v_value_seconds := nullif(v_row->>'value_seconds', '')::int;

    if v_email is null or v_date is null or v_movement_key is null
       or v_track_key is null or v_value_seconds is null then
      continue;
    end if;

    select gm.profile_id into v_profile_id
      from public.gym_memberships gm
      join auth.users u on u.id = gm.profile_id
      where gm.gym_id = p_gym_id
        and gm.left_at is null
        and lower(u.email) = v_email
      limit 1;

    if v_profile_id is null then
      if exists (select 1 from public.pending_members
                 where gym_id = p_gym_id and lower(email) = v_email) then
        insert into public.pending_member_workouts
          (gym_id, email, performed_on, kind, dedup_key, payload)
        values (p_gym_id, v_email, v_date, 'hyrox',
          v_movement_key || '|' || v_track_key,
          jsonb_build_object(
            'movement_key', v_movement_key, 'track_key', v_track_key,
            'value_seconds', v_value_seconds, 'notes', v_notes))
        on conflict (gym_id, email, performed_on, kind, dedup_key) do nothing;
        v_staged := v_staged + 1;
      else
        v_skipped_no_member := v_skipped_no_member + 1;
      end if;
      continue;
    end if;

    select id into v_workout_id
      from public.tracked_workouts
      where gym_id = p_gym_id
        and profile_id = v_profile_id
        and performed_at::date = v_date
      order by performed_at
      limit 1;
    if v_workout_id is null then
      insert into public.tracked_workouts (gym_id, profile_id, performed_at, title)
        values (p_gym_id, v_profile_id, v_date::timestamptz, 'Imported')
        returning id into v_workout_id;
      v_inserted_workouts := v_inserted_workouts + 1;
    end if;

    if exists (
      select 1 from public.tracked_movement_results
      where workout_id = v_workout_id
        and movement_key = v_movement_key
        and track_key = v_track_key
    ) then
      v_skipped_duplicate := v_skipped_duplicate + 1;
      continue;
    end if;

    insert into public.tracked_movement_results
      (gym_id, profile_id, workout_id, movement_key, track_key,
       value_seconds, notes)
    values
      (p_gym_id, v_profile_id, v_workout_id, v_movement_key, v_track_key,
       v_value_seconds, v_notes);
    v_inserted_results := v_inserted_results + 1;
  end loop;

  return query
    select v_inserted_workouts, v_inserted_results,
           v_skipped_no_member, v_skipped_duplicate, v_staged;
end;
$$;

grant execute on function public.import_member_hyrox_results(uuid, jsonb)
  to authenticated;

commit;
