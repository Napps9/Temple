-- Member import — staging table + linking trigger.
--
-- Imported members live in `pending_members` until a real signup
-- happens with the same email. At that moment a trigger on
-- gym_memberships looks them up by (gym_id, lower(email)) and applies
-- the imported state (tags, suppression, the imported plan metadata)
-- onto the freshly-created membership. Owners can self-serve (we
-- hand them the /join/<slug> URL + a personalised per-member CSV they
-- mail-merge from their own tool), or opt in to the "Temple sends the
-- welcome" path which routes through the Comms Suite via a new
-- audience kind ('pending_members').
--
-- Imported plan_name is deliberately a free text field. The owner
-- maps "Gold Monthly" → an actual public.membership_plans row later,
-- in a separate flow not built in this migration. Until then the
-- imported plan metadata sits on the membership as informational
-- columns; the gym ops surface still reads it via the join.

begin;

-- ============================================================================
-- 1. pending_members
-- ============================================================================

create table public.pending_members (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.gyms(id) on delete cascade,
  email             text not null check (length(trim(email)) > 0),
  full_name         text,
  date_of_birth     date,
  -- Plan metadata is free text + dates / credits — the owner maps it
  -- to a real membership_plan in a separate post-import step.
  plan_name         text,
  plan_start        date,
  plan_end          date,
  credits_remaining integer check (credits_remaining is null or credits_remaining >= 0),
  imported_status   text,           -- the source system's status string, informational
  tags              text[] not null default '{}',
  unsubscribed      boolean not null default false,
  notes             text,
  status            text not null default 'pending'
                      check (status in ('pending','invited','linked','skipped')),
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  linked_at         timestamptz,
  linked_profile_id uuid references public.profiles(id) on delete set null
);

create unique index pending_members_gym_email_idx
  on public.pending_members (gym_id, lower(email));
create index pending_members_gym_status_idx
  on public.pending_members (gym_id, status);

alter table public.pending_members enable row level security;

-- can_manage_staff (same gate as Team / invites) governs the whole
-- import surface — the conversation that scoped this explicitly chose
-- this over a new capability.
create policy pending_members_select on public.pending_members
  for select using (public.effective_can(gym_id, 'can_manage_staff'));
create policy pending_members_insert on public.pending_members
  for insert with check (
    public.effective_can(gym_id, 'can_manage_staff') and created_by = auth.uid()
  );
create policy pending_members_update on public.pending_members
  for update using (public.effective_can(gym_id, 'can_manage_staff'))
  with check (public.effective_can(gym_id, 'can_manage_staff'));
create policy pending_members_delete on public.pending_members
  for delete using (public.effective_can(gym_id, 'can_manage_staff'));

-- ============================================================================
-- 2. Carry the imported plan metadata on the membership itself
-- ============================================================================
--
-- These are informational columns the gym ops UI shows alongside the
-- real plan_subscription (when one exists). They never override
-- live billing state — they're for the owner to read off while
-- mapping plans, and for the member-detail page to show "imported
-- from your old provider as 'Gold Monthly', expires …".

alter table public.gym_memberships
  add column if not exists imported_plan_name        text,
  add column if not exists imported_plan_start       date,
  add column if not exists imported_plan_end         date,
  add column if not exists imported_credits_remaining integer
    check (imported_credits_remaining is null or imported_credits_remaining >= 0),
  add column if not exists imported_at               timestamptz;

-- ============================================================================
-- 3. Linking trigger on gym_memberships
-- ============================================================================
--
-- Fires on the membership insert that happens at sign-up (via
-- join_gym_by_slug or accept_invite). Looks up the new member's
-- auth.users email, finds a matching pending row for this gym, and
-- applies the imported state: tags, suppression, and the imported
-- plan metadata. Idempotent on re-join (the pending row may already
-- be 'linked' — we skip).
--
-- Defined as security definer so it can write across the tables the
-- joining role can't (member_tags, email_unsubscribes) without
-- relaxing those tables' policies.

create or replace function public.apply_pending_member_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_pending public.pending_members%rowtype;
  v_tag     text;
begin
  -- Pre-existing rejoin doesn't carry pending data: we only fire on
  -- the first INSERT, not on the update that clears left_at.
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select u.email into v_email from auth.users u where u.id = new.profile_id;
  if v_email is null then
    return new;
  end if;

  select * into v_pending
    from public.pending_members
    where gym_id = new.gym_id and lower(email) = lower(v_email)
    limit 1;
  if v_pending.id is null then
    return new;
  end if;

  -- Apply the imported plan metadata onto the new membership row.
  update public.gym_memberships
    set imported_plan_name         = v_pending.plan_name,
        imported_plan_start        = v_pending.plan_start,
        imported_plan_end          = v_pending.plan_end,
        imported_credits_remaining = v_pending.credits_remaining,
        imported_at                = now()
    where id = new.id;

  -- Tags.
  foreach v_tag in array coalesce(v_pending.tags, '{}'::text[]) loop
    if length(trim(v_tag)) > 0 then
      insert into public.member_tags (gym_id, profile_id, label)
        values (new.gym_id, new.profile_id, trim(v_tag))
        on conflict (gym_id, profile_id, lower(label)) do nothing;
    end if;
  end loop;

  -- Suppression: a member flagged "do not email" on the source system
  -- carries straight into our Comms Suite suppression list.
  if v_pending.unsubscribed then
    insert into public.email_unsubscribes
      (gym_id, email, profile_id, reason)
      values (v_pending.gym_id, v_pending.email, new.profile_id, 'imported')
      on conflict (gym_id, lower(email)) do nothing;
  end if;

  update public.pending_members
    set status = 'linked',
        linked_at = now(),
        linked_profile_id = new.profile_id
    where id = v_pending.id;

  return new;
end;
$$;

drop trigger if exists apply_pending_member_data_trigger on public.gym_memberships;
create trigger apply_pending_member_data_trigger
  after insert on public.gym_memberships
  for each row execute function public.apply_pending_member_data();

-- ============================================================================
-- 4. Import + stats RPCs
-- ============================================================================
--
-- import_pending_members: bulk upsert. Each row is a single jsonb
-- object matching the column names; rows are merged on
-- (gym_id, lower(email)) so re-running the import with an updated
-- CSV refreshes the metadata of any not-yet-linked rows. A row that
-- has already been linked is left alone.

create or replace function public.import_pending_members(
  p_gym_id uuid,
  p_rows   jsonb
) returns table (
  inserted integer,
  updated  integer,
  skipped  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_row      jsonb;
  v_inserted integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
  v_email    text;
  v_existing public.pending_members%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_manage_staff') then
    raise exception 'Not authorised';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_email := nullif(trim(coalesce(v_row->>'email', '')), '');
    if v_email is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_existing
      from public.pending_members
      where gym_id = p_gym_id and lower(email) = lower(v_email);

    if v_existing.id is null then
      insert into public.pending_members
        (gym_id, email, full_name, date_of_birth, plan_name,
         plan_start, plan_end, credits_remaining, imported_status,
         tags, unsubscribed, notes, created_by)
      values (
        p_gym_id,
        v_email,
        nullif(trim(coalesce(v_row->>'full_name', '')), ''),
        nullif(v_row->>'date_of_birth', '')::date,
        nullif(trim(coalesce(v_row->>'plan_name', '')), ''),
        nullif(v_row->>'plan_start', '')::date,
        nullif(v_row->>'plan_end', '')::date,
        nullif(v_row->>'credits_remaining', '')::integer,
        nullif(trim(coalesce(v_row->>'imported_status', '')), ''),
        coalesce(
          (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_row->'tags','[]'::jsonb))),
          '{}'::text[]
        ),
        coalesce((v_row->>'unsubscribed')::boolean, false),
        nullif(trim(coalesce(v_row->>'notes', '')), ''),
        v_caller
      );
      v_inserted := v_inserted + 1;
    elsif v_existing.status = 'linked' then
      -- Already linked to a profile — leave the historical record alone.
      v_skipped := v_skipped + 1;
    else
      update public.pending_members
        set full_name         = coalesce(nullif(trim(coalesce(v_row->>'full_name','')), ''), full_name),
            date_of_birth     = coalesce(nullif(v_row->>'date_of_birth','')::date, date_of_birth),
            plan_name         = coalesce(nullif(trim(coalesce(v_row->>'plan_name','')),''), plan_name),
            plan_start        = coalesce(nullif(v_row->>'plan_start','')::date, plan_start),
            plan_end          = coalesce(nullif(v_row->>'plan_end','')::date, plan_end),
            credits_remaining = coalesce(nullif(v_row->>'credits_remaining','')::integer, credits_remaining),
            tags              = coalesce(
                                  (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_row->'tags','[]'::jsonb))),
                                  tags
                                ),
            unsubscribed      = coalesce((v_row->>'unsubscribed')::boolean, unsubscribed),
            notes             = coalesce(nullif(trim(coalesce(v_row->>'notes','')),''), notes)
        where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_inserted, v_updated, v_skipped;
end;
$$;
grant execute on function public.import_pending_members(uuid, jsonb) to authenticated;

-- Stats for the live "X of Y linked" counter on the handover screen.
create or replace function public.pending_members_stats(p_gym_id uuid)
returns table (
  pending  integer,
  invited  integer,
  linked   integer,
  skipped  integer,
  total    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_manage_staff') then
    raise exception 'Not authorised';
  end if;
  return query
    select
      count(*) filter (where status = 'pending')::int,
      count(*) filter (where status = 'invited')::int,
      count(*) filter (where status = 'linked')::int,
      count(*) filter (where status = 'skipped')::int,
      count(*)::int
    from public.pending_members
    where gym_id = p_gym_id;
end;
$$;
grant execute on function public.pending_members_stats(uuid) to authenticated;

-- ============================================================================
-- 5. Comms Suite: 'pending_members' audience kind
-- ============================================================================
--
-- The opt-in "send the welcome email from Temple" path on the import
-- handover screen builds a campaign targeting this audience. The
-- resolver reads from pending_members (not gym_memberships) — these
-- people don't have profiles yet, so the regular cohort/tags resolver
-- can't see them. Honors the suppression list the same way.

create or replace function public.comms_audience_rows(
  p_gym_id     uuid,
  p_definition jsonb
) returns table (
  profile_id uuid,
  full_name  text,
  email      text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select gm.profile_id
    from public.gym_memberships gm
    where gm.gym_id = p_gym_id
      and gm.left_at is null
      and gm.role = 'member'
  ),
  selected as (
    select b.profile_id
    from base b
    where case coalesce(p_definition->>'kind', 'all_members')
      when 'all_members' then true
      when 'cohort' then exists (
        select 1 from public.v_member_cohort c
        where c.gym_id = p_gym_id and c.profile_id = b.profile_id
          and (
            ((p_definition->'cohorts') ? 'intro'         and c.is_intro)         or
            ((p_definition->'cohorts') ? 'active'        and c.is_active)        or
            ((p_definition->'cohorts') ? 'paying'        and c.is_paying)        or
            ((p_definition->'cohorts') ? 'expiring_soon' and c.is_expiring_soon) or
            ((p_definition->'cohorts') ? 'expired'       and c.is_expired)
          )
      )
      when 'tags' then exists (
        select 1 from public.member_tags mt
        where mt.gym_id = p_gym_id and mt.profile_id = b.profile_id
          and (p_definition->'tags') ? mt.label
      )
      when 'manual' then (p_definition->'profile_ids') ? b.profile_id::text
      else false
    end
  ),
  member_rows as (
    select distinct on (lower(u.email))
      s.profile_id,
      p.full_name,
      u.email
    from selected s
    join public.profiles p on p.id = s.profile_id
    join auth.users u on u.id = s.profile_id
    where u.email is not null
      and length(trim(u.email)) > 0
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id and lower(eu.email) = lower(u.email)
      )
    order by lower(u.email)
  ),
  pending_rows as (
    select distinct on (lower(pm.email))
      null::uuid       as profile_id,
      pm.full_name,
      pm.email
    from public.pending_members pm
    where coalesce(p_definition->>'kind', '') = 'pending_members'
      and pm.gym_id = p_gym_id
      and pm.status in ('pending','invited')
      and not exists (
        select 1 from public.email_unsubscribes eu
        where eu.gym_id = p_gym_id and lower(eu.email) = lower(pm.email)
      )
    order by lower(pm.email)
  )
  select * from member_rows
  union all
  select * from pending_rows;
$$;

revoke all on function public.comms_audience_rows(uuid, jsonb) from public;

commit;
