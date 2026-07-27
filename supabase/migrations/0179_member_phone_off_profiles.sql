-- Take the member's phone number off the row every gym-mate can read.
--
-- profiles_gym_member_select (0006:107) is same_gym_as_caller(id) with no
-- capability term, and Postgres has no column-level RLS, so profiles.phone
-- is readable by every member of the gym — not just staff, every member.
-- 0178 gated phone behind can_see_full_pii on ITS surface and said in its
-- own header that this was the real hole and its own piece of work. This
-- is that work.
--
-- WHY A SIDE TABLE AND NOT A NARROWER POLICY. 35 client call sites read
-- profiles. Narrowing the row policy breaks 34 of them — every screen that
-- renders a name or an avatar. Moving phone to its own table breaks
-- exactly one (the members CSV export). That is the whole argument, and it
-- is the same shape 0174 used for the invoice link and 0176 for the
-- dunning state.
--
-- date_of_birth deliberately stays. It is read cross-profile by
-- useDependents (a guardian reading their child's DOB) and moving it is a
-- different change with a different blast radius.
--
-- The CSV export is the one reader that breaks, and it was the sharper
-- half of the problem anyway: it emitted phone under can_export_members
-- alone, so the DB never checked a PII capability at all. It now goes
-- through gym_member_contacts, gated on can_see_full_pii like the
-- singular gym_member_contact (0178).

begin;

create table public.member_contact_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  phone      text,
  updated_at timestamptz not null default now()
);

alter table public.member_contact_details enable row level security;

-- Self only. Staff reach it through gym_member_contact(s), which apply the
-- capability gate — the same split 0174 used for membership_invoice_links.
create policy member_contact_details_self_select
  on public.member_contact_details
  for select using (profile_id = auth.uid());

create policy member_contact_details_self_upsert
  on public.member_contact_details
  for insert with check (profile_id = auth.uid());

create policy member_contact_details_self_update
  on public.member_contact_details
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

insert into public.member_contact_details (profile_id, phone)
  select id, phone from public.profiles where phone is not null;

alter table public.profiles drop column phone;

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

  -- Phone lives on member_contact_details now (0179), not on profiles,
  -- which every gym-mate can read. coalesce still means an imported number
  -- never overwrites one the member typed themselves.
  if v_pending.phone is not null then
    insert into public.member_contact_details (profile_id, phone)
    values (new.profile_id, v_pending.phone)
    on conflict (profile_id) do update
      set phone = coalesce(public.member_contact_details.phone, excluded.phone),
          updated_at = now();
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
-- Staff reads
-- ============================================================================

create or replace function public.gym_member_contact(
  p_gym_id     uuid,
  p_profile_id uuid
) returns table (
  email text,
  phone text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_email boolean := public.effective_can(p_gym_id, 'can_see_email');
  v_pii   boolean := public.effective_can(p_gym_id, 'can_see_full_pii');
begin
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    raise exception 'Not authorised';
  end if;
  if not (v_email or v_pii) then
    raise exception 'Not authorised';
  end if;

  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_profile_id
      and gm.left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  return query
  select
    case when v_email then u.email::text end,
    case when v_pii   then c.phone end
  from public.profiles p
  left join auth.users u                       on u.id = p.id
  left join public.member_contact_details c     on c.profile_id = p.id
  where p.id = p_profile_id;
end;
$$;

grant execute on function public.gym_member_contact(uuid, uuid) to authenticated;

-- The bulk form, for the members CSV export. Same gate as the singular
-- one: the export used to emit phone off an embedded profiles join under
-- can_export_members alone, which is a permission about exporting, not a
-- permission about seeing someone's number.
create or replace function public.gym_member_contacts(p_gym_id uuid)
returns table (
  profile_id uuid,
  email      text,
  phone      text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_email boolean := public.effective_can(p_gym_id, 'can_see_email');
  v_pii   boolean := public.effective_can(p_gym_id, 'can_see_full_pii');
begin
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    raise exception 'Not authorised';
  end if;
  if not (v_email or v_pii) then
    raise exception 'Not authorised';
  end if;

  return query
  select
    gm.profile_id,
    case when v_email then u.email::text end,
    case when v_pii   then c.phone end
  from public.gym_memberships gm
  left join auth.users u                    on u.id = gm.profile_id
  left join public.member_contact_details c on c.profile_id = gm.profile_id
  where gm.gym_id = p_gym_id
    and gm.left_at is null;
end;
$$;

grant execute on function public.gym_member_contacts(uuid) to authenticated;

-- ============================================================================
-- A member who left two years ago is not still "in the gym"
-- ============================================================================
--
-- Found while measuring the blast radius above. The original
-- same_gym_as_caller (0006:87) required both sides to be status 'active';
-- the live redefinition (0008:250) dropped that predicate and never gained
-- a left_at filter, so someone who left still reads every current member's
-- profile row.
--
-- Only the CALLER side is tightened. The target side stays open on purpose:
-- staff legitimately view removed members — the member profile screen has a
-- "Removed" banner and a Restore button — and a departed member reading
-- their own row is covered by profiles_self_select.

create or replace function public.same_gym_as_caller(target_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.gym_memberships gm1
    join public.gym_memberships gm2 on gm1.gym_id = gm2.gym_id
    where gm1.profile_id = auth.uid()
      and gm1.left_at is null
      and gm2.profile_id = target_profile
  );
$$;

commit;
