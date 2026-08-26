-- Next week is not theirs yet
--
-- class_programming's select policy has been a bare user_belongs_to since
-- 0007 and has never been touched. Every active member of the gym reads
-- every class type's programming for every date, past and future, the
-- instant it is saved. A head coach who wants to plan a block properly has
-- exactly one way to stop members reading Thursday on Monday, which is not
-- to write it down — so the planning either does not happen or it happens
-- in a spreadsheet, which is the same problem 0268 just solved for macros.
--
-- PUBLISHED_AT IS THE WHOLE MECHANISM. Null is a draft, a past timestamp
-- is live, a future one is scheduled, and `published_at <= now()` in the
-- member's policy is the release. No cron, no worker, no state machine and
-- nothing to go wrong overnight: the row becomes visible because time
-- passed, which is the one scheduler that never fails to run.
--
-- THE BACKFILL IS NOT OPTIONAL. `add column` defaults null, null reads as
-- draft, and every gym's live programming would vanish from every member's
-- app the moment this deployed. published_at = updated_at says what was
-- already true: it was written, so it was published.
--
-- READ AND WRITE MOVE TOGETHER, which is 0219's rule — a gate that lets
-- somebody write what they cannot then read is worse than either gate
-- alone. Staff keep the whole calendar under can_edit_classes; the member
-- policy is the one that gains the clock.
--
-- And the write becomes an RPC. A draft is a state a member must not be
-- able to reach, and ProgrammingModal has been upserting the table
-- directly since 0007 — fine while every row was public, wrong the moment
-- one of them is not.

begin;

-- ============================================================================
-- 1. The column, and the truth about what already exists
-- ============================================================================

alter table public.class_programming
  add column if not exists published_at timestamptz;

update public.class_programming
   set published_at = updated_at
 where published_at is null;

comment on column public.class_programming.published_at is
  'When members may read this. Null = draft, past = live, future = '
  'scheduled. The member policy tests published_at <= now(), so release '
  'happens because time passed rather than because a job ran.';

create index class_programming_published_idx
  on public.class_programming(gym_id, date, published_at);

-- ============================================================================
-- 2. Who reads what
-- ============================================================================

drop policy if exists class_programming_tenant_select on public.class_programming;

create policy class_programming_member_select on public.class_programming
  for select using (
    public.user_belongs_to(gym_id)
    and published_at is not null
    and published_at <= now()
  );

-- Staff read everything, drafts included — they are the ones writing them.
create policy class_programming_staff_select on public.class_programming
  for select using (public.effective_can(gym_id, 'can_edit_classes'));

-- ============================================================================
-- 3. Writing it
-- ============================================================================

create or replace function public.save_class_programming(
  p_gym_id        uuid,
  p_class_type_id uuid,
  p_date          date,
  p_sections      jsonb,
  p_published_at  timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.effective_can(p_gym_id, 'can_edit_classes') then
    raise exception 'Not authorised';
  end if;
  if not exists (
    select 1 from public.class_types ct
    where ct.id = p_class_type_id and ct.gym_id = p_gym_id
  ) then
    raise exception 'Class type not found in this gym';
  end if;

  -- Clearing every section deletes the row rather than leaving an empty
  -- one, which is what the direct upsert did and what the calendar's
  -- "nothing programmed" state reads.
  if p_sections is null or jsonb_array_length(p_sections) = 0 then
    delete from public.class_programming
     where class_type_id = p_class_type_id and date = p_date;
    return null;
  end if;

  insert into public.class_programming
    (gym_id, class_type_id, date, sections, author_id, updated_at, published_at)
  values
    (p_gym_id, p_class_type_id, p_date, p_sections, v_uid, now(), p_published_at)
  on conflict (class_type_id, date) do update
    set sections     = excluded.sections,
        author_id    = excluded.author_id,
        updated_at   = now(),
        published_at = excluded.published_at
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_class_programming(uuid, uuid, date, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_class_programming(uuid, uuid, date, jsonb, timestamptz)
  to authenticated;

-- Releasing a day that was written ahead, without reopening the editor.
create or replace function public.publish_class_programming(
  p_gym_id       uuid,
  p_date         date,
  p_published_at timestamptz default now()
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.effective_can(p_gym_id, 'can_edit_classes') then
    raise exception 'Not authorised';
  end if;
  update public.class_programming
     set published_at = p_published_at
   where gym_id = p_gym_id and date = p_date;
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.publish_class_programming(uuid, date, timestamptz)
  from public, anon;
grant execute on function public.publish_class_programming(uuid, date, timestamptz)
  to authenticated;

commit;
