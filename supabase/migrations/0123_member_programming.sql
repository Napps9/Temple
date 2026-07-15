-- Per-member individualized programming.
--
-- Gyms sell (or gift) personal programming: a coach authors day-by-day
-- sections for ONE member — same Section jsonb shape as class
-- programming (0007), so the editor, parser and recorder all reuse —
-- plus optional PDF programme documents. Access is configurable per
-- member: free (the default, and the absent-row meaning), or paid —
-- unlocked by purchasing a linked store product (one-off or recurring,
-- 0085/0086) OR by holding a current subscription to a membership plan
-- flagged as including individual programming.
--
-- Plans also gain a 'programming_only' kind (a PT-style membership:
-- recurring price, programming included, NO class booking). No booking
-- SQL changes: _is_booking_eligible_for (0015) and
-- _select_default_entitlement_unchecked (0050) only admit unlimited
-- plans or credit balances, so a programming_only subscription never
-- qualifies as a booking entitlement by construction.
--
-- Authoring is gated by a new capability (can_program_members) rather
-- than can_edit_classes: writing one athlete's programme and writing
-- the gym's whiteboard are different jobs, and per-gym overrides let
-- owners split them. Content rows are written directly under RLS (the
-- class_programming precedent — a section body is not a dangerous
-- write); the access config, which gates money, goes through a
-- security-definer RPC.

begin;

-- ============================================================================
-- 1. Capability — register before any policy references it.
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
    when 'can_manage_comms'           then p_role = 'admin'
    when 'can_manage_store'           then p_role = 'admin'
    when 'can_see_store_revenue'      then p_role = 'admin'
    when 'can_manage_website'         then p_role = 'admin'
    when 'can_program_members'        then p_role in ('admin','coach')
    else false
  end;
$$;

grant execute on function public.default_capability(public.gym_role, text) to authenticated;

-- ============================================================================
-- 2. Plans: includes-flag + programming_only kind.
-- ============================================================================

alter table public.membership_plans
  add column includes_individual_programming boolean not null default false;

-- Both CHECKs from 0008 were unnamed; Postgres auto-named them.
alter table public.membership_plans
  drop constraint membership_plans_kind_check;
alter table public.membership_plans
  drop constraint membership_plans_check;

alter table public.membership_plans
  add constraint membership_plans_kind_check
  check (kind in ('unlimited', 'credit_period', 'credit_pack', 'programming_only'));

alter table public.membership_plans
  add constraint membership_plans_kind_shape
  check (
    (kind = 'unlimited'        and credit_count is null     and period_length is null) or
    (kind = 'credit_period'    and credit_count is not null and period_length is not null) or
    (kind = 'credit_pack'      and credit_count is not null and period_length is null) or
    (kind = 'programming_only' and credit_count is null     and period_length is null)
  );

-- A PT-only plan that didn't include programming would be an empty
-- product; keep the data honest.
alter table public.membership_plans
  add constraint membership_plans_programming_only_includes
  check (kind <> 'programming_only' or includes_individual_programming);

-- ============================================================================
-- 3. member_programming — one row per (gym, member, day).
-- ============================================================================

create table public.member_programming (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  profile_id  uuid not null,
  date        date not null,
  sections    jsonb not null default '[]'::jsonb,
  author_id   uuid not null references public.profiles(id),
  updated_at  timestamptz not null default now(),
  unique (gym_id, profile_id, date),
  foreign key (gym_id, profile_id)
    references public.gym_memberships (gym_id, profile_id) on delete cascade
);

create index member_programming_gym_date_idx
  on public.member_programming (gym_id, date);

-- ============================================================================
-- 4. member_programming_access — per-member free/paid config.
-- ============================================================================

create table public.member_programming_access (
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  profile_id       uuid not null,
  mode             text not null default 'free' check (mode in ('free', 'paid')),
  store_product_id uuid references public.store_products(id) on delete set null,
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (gym_id, profile_id),
  foreign key (gym_id, profile_id)
    references public.gym_memberships (gym_id, profile_id) on delete cascade
);

alter table public.member_programming_access enable row level security;

-- Staff read it; nobody writes it from the client (RPC below). Members
-- learn their own state through my_programming_access.
create policy member_programming_access_staff_select on public.member_programming_access
  for select using (public.effective_can(gym_id, 'can_program_members'));

-- ============================================================================
-- 5. Entitlement predicate.
-- ============================================================================

-- Absent access row = free. The plan-subscription status set matches
-- is_active_relationship (0015) / the client's CURRENT_SUB_STATUSES:
-- a paused or pending PT member keeps reading their programme; a
-- lapsed/cancelled one does not.
create or replace function public.has_individual_programming_access(
  p_gym_id     uuid,
  p_profile_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_profile_id = auth.uid()
      or public.effective_can(p_gym_id, 'can_program_members')
    then coalesce(
      (
        select
          a.mode = 'free'
          or (
            a.store_product_id is not null
            and (
              exists (
                select 1 from public.store_subscriptions ss
                where ss.gym_id = p_gym_id
                  and ss.profile_id = p_profile_id
                  and ss.product_id = a.store_product_id
                  and ss.status in ('active', 'past_due')
              )
              or exists (
                select 1
                from public.store_orders o
                join public.store_order_items i on i.order_id = o.id
                where o.gym_id = p_gym_id
                  and o.profile_id = p_profile_id
                  and o.status in ('paid', 'fulfilled')
                  and i.product_id = a.store_product_id
              )
            )
          )
          or exists (
            select 1
            from public.plan_subscriptions ps
            join public.membership_plans mp on mp.plan_id = ps.plan_id
            where ps.gym_id = p_gym_id
              and ps.profile_id = p_profile_id
              and ps.status in ('active', 'pending', 'paused', 'cancelled_at_period_end')
              and mp.includes_individual_programming
          )
        from public.member_programming_access a
        where a.gym_id = p_gym_id and a.profile_id = p_profile_id
      ),
      true
    )
    else false
  end;
$$;

grant execute on function public.has_individual_programming_access(uuid, uuid) to authenticated;

-- ============================================================================
-- 6. member_programming RLS.
-- ============================================================================

alter table public.member_programming enable row level security;

create policy member_programming_self_select on public.member_programming
  for select using (
    profile_id = auth.uid()
    and exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id = member_programming.gym_id
        and gm.profile_id = auth.uid()
        and gm.left_at is null
    )
    and public.has_individual_programming_access(gym_id, profile_id)
  );

-- USING without the left_at guard keeps a removed member's rows visible
-- (and deletable) to staff; WITH CHECK refuses new writes for them.
create policy member_programming_staff_all on public.member_programming
  for all
  using (public.effective_can(gym_id, 'can_program_members'))
  with check (
    public.effective_can(gym_id, 'can_program_members')
    and exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id = member_programming.gym_id
        and gm.profile_id = member_programming.profile_id
        and gm.left_at is null
    )
  );

-- ============================================================================
-- 7. member_programming_files — uploaded PDF programmes.
-- ============================================================================

create table public.member_programming_files (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  profile_id  uuid not null,
  title       text not null,
  file_path   text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (gym_id, profile_id)
    references public.gym_memberships (gym_id, profile_id) on delete cascade
);

create index member_programming_files_member_idx
  on public.member_programming_files (gym_id, profile_id);

alter table public.member_programming_files enable row level security;

create policy member_programming_files_self_select on public.member_programming_files
  for select using (
    profile_id = auth.uid()
    and exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id = member_programming_files.gym_id
        and gm.profile_id = auth.uid()
        and gm.left_at is null
    )
    and public.has_individual_programming_access(gym_id, profile_id)
  );

create policy member_programming_files_staff_all on public.member_programming_files
  for all
  using (public.effective_can(gym_id, 'can_program_members'))
  with check (
    public.effective_can(gym_id, 'can_program_members')
    and exists (
      select 1 from public.gym_memberships gm
      where gm.gym_id = member_programming_files.gym_id
        and gm.profile_id = member_programming_files.profile_id
        and gm.left_at is null
    )
  );

-- ============================================================================
-- 8. Storage bucket for the PDFs — private.
-- ============================================================================

-- Objects live under <gym_id>/<profile_id>/<uuid>.pdf. Staff act on the
-- gym folder (segment compared as text — never cast to uuid, this runs
-- against every bucket's writes); members read only objects matched by
-- their own file row, which re-checks the paid gate.
insert into storage.buckets (id, name, public)
  values ('member-programming-files', 'member-programming-files', false)
  on conflict (id) do nothing;

drop policy if exists member_prog_files_member_read  on storage.objects;
drop policy if exists member_prog_files_staff_read   on storage.objects;
drop policy if exists member_prog_files_staff_insert on storage.objects;
drop policy if exists member_prog_files_staff_delete on storage.objects;

create policy member_prog_files_member_read on storage.objects
  for select using (
    bucket_id = 'member-programming-files'
    and exists (
      select 1 from public.member_programming_files f
      where f.profile_id = auth.uid()
        and f.file_path = name
        and public.has_individual_programming_access(f.gym_id, auth.uid())
    )
  );

create policy member_prog_files_staff_read on storage.objects
  for select using (
    bucket_id = 'member-programming-files'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_program_members')
    )
  );

create policy member_prog_files_staff_insert on storage.objects
  for insert with check (
    bucket_id = 'member-programming-files'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_program_members')
    )
  );

create policy member_prog_files_staff_delete on storage.objects
  for delete using (
    bucket_id = 'member-programming-files'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_program_members')
    )
  );

-- ============================================================================
-- 9. RPC: set_member_programming_access.
-- ============================================================================

create or replace function public.set_member_programming_access(
  p_gym_id           uuid,
  p_profile_id       uuid,
  p_mode             text,
  p_store_product_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_program_members') then
    raise exception 'Not authorised';
  end if;
  if p_mode not in ('free', 'paid') then
    raise exception 'Invalid mode %', p_mode;
  end if;

  if not exists (
    select 1 from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.profile_id = p_profile_id
      and gm.left_at is null
  ) then
    raise exception 'Member not found in this gym';
  end if;

  v_product := case when p_mode = 'paid' then p_store_product_id else null end;

  if v_product is not null and not exists (
    select 1 from public.store_products p
    where p.id = v_product
      and p.gym_id = p_gym_id
      and p.archived_at is null
  ) then
    raise exception 'Product not found in this gym';
  end if;

  insert into public.member_programming_access
    (gym_id, profile_id, mode, store_product_id, updated_by, updated_at)
  values
    (p_gym_id, p_profile_id, p_mode, v_product, auth.uid(), now())
  on conflict (gym_id, profile_id) do update set
    mode             = excluded.mode,
    store_product_id = excluded.store_product_id,
    updated_by       = excluded.updated_by,
    updated_at       = excluded.updated_at;
end;
$$;

grant execute on function public.set_member_programming_access(uuid, uuid, text, uuid) to authenticated;

-- ============================================================================
-- 10. RPC: my_programming_access — powers the member locked card.
-- ============================================================================

-- has_programming is computed under definer, deliberately: when the
-- member is locked out, RLS hides every row, and this is the one bit
-- that tells the UI there is something to unlock at all.
create or replace function public.my_programming_access(
  p_gym_id uuid
) returns table (
  entitled                   boolean,
  mode                       text,
  has_programming            boolean,
  product_id                 uuid,
  product_name               text,
  product_price_cents        integer,
  product_recurring          boolean,
  product_recurring_interval text,
  product_active             boolean,
  plan_upgrade_available     boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not authorised';
  end if;

  return query
  select
    public.has_individual_programming_access(p_gym_id, auth.uid()),
    coalesce(a.mode, 'free'),
    exists (
      select 1 from public.member_programming mp
      where mp.gym_id = p_gym_id and mp.profile_id = auth.uid()
    ) or exists (
      select 1 from public.member_programming_files f
      where f.gym_id = p_gym_id and f.profile_id = auth.uid()
    ),
    p.id,
    p.name,
    p.price_cents,
    coalesce(p.recurring, false),
    p.recurring_interval,
    coalesce(p.active and p.archived_at is null, false),
    exists (
      select 1 from public.membership_plans mp
      where mp.gym_id = p_gym_id
        and mp.includes_individual_programming
        and mp.archived_at is null
    )
  from (select 1) one
  left join public.member_programming_access a
    on a.gym_id = p_gym_id and a.profile_id = auth.uid()
  left join public.store_products p
    on p.id = a.store_product_id;
end;
$$;

grant execute on function public.my_programming_access(uuid) to authenticated;

-- ============================================================================
-- 11. RPC: list_programmed_members — the staff Individuals screen.
-- ============================================================================

create or replace function public.list_programmed_members(
  p_gym_id uuid
) returns table (
  profile_id    uuid,
  full_name     text,
  avatar_url    text,
  mode          text,
  days_total    integer,
  upcoming_days integer,
  last_date     date,
  files_total   integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_program_members') then
    raise exception 'Not authorised';
  end if;

  return query
  with days as (
    select mp.profile_id as pid,
           count(*)::integer as days_total,
           count(*) filter (where mp.date >= current_date)::integer as upcoming_days,
           max(mp.date) as last_date
    from public.member_programming mp
    where mp.gym_id = p_gym_id
    group by mp.profile_id
  ),
  files as (
    select f.profile_id as pid, count(*)::integer as files_total
    from public.member_programming_files f
    where f.gym_id = p_gym_id
    group by f.profile_id
  ),
  access as (
    select a.profile_id as pid, a.mode
    from public.member_programming_access a
    where a.gym_id = p_gym_id
  ),
  combined as (
    select coalesce(d.pid, f.pid, a.pid) as pid,
           coalesce(d.days_total, 0)     as days_total,
           coalesce(d.upcoming_days, 0)  as upcoming_days,
           d.last_date,
           coalesce(f.files_total, 0)    as files_total,
           coalesce(a.mode, 'free')      as mode
    from days d
    full join files f on f.pid = d.pid
    full join access a on a.pid = coalesce(d.pid, f.pid)
  )
  select c.pid, pr.full_name, pr.avatar_url, c.mode,
         c.days_total, c.upcoming_days, c.last_date, c.files_total
  from combined c
  join public.gym_memberships gm
    on gm.gym_id = p_gym_id and gm.profile_id = c.pid and gm.left_at is null
  join public.profiles pr on pr.id = c.pid
  order by pr.full_name nulls last;
end;
$$;

grant execute on function public.list_programmed_members(uuid) to authenticated;

-- ============================================================================
-- 12. Recorder linkage — personal analogue of source_programming_id.
-- ============================================================================

alter table public.tracked_workout_sections
  add column source_member_programming_id uuid
    references public.member_programming(id) on delete set null;

create index tracked_sections_source_member_prog_idx
  on public.tracked_workout_sections (source_member_programming_id)
  where source_member_programming_id is not null;

commit;
