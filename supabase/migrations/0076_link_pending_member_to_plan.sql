-- Bootstrap a gym from its member CSV.
--
-- The members importer currently stages rows into pending_members and the
-- linking trigger (0046/0047) stamps imported_* columns onto the resulting
-- gym_memberships row + copies tags into member_tags + propagates the
-- unsubscribed flag. But it stops short of actually creating a working
-- plan_subscription, so imported members can't book a class until a
-- staffer manually wires one up.
--
-- This migration closes that gap and lays the groundwork for an AI-
-- assisted plan-mapping step in the import wizard:
--
--   1. pending_members gains a nullable linked_membership_plan_id. The
--      review step in /management/members/import sets this per row from
--      the owner-confirmed plan map; on signup the linking trigger
--      creates a plan_subscription pinned to that plan, with status
--      'active', credit_balance carried from imported_credits_remaining
--      (for credit-based plans), paid_period_end carried from plan_end,
--      and stripe_subscription_id null — Temple billing is bypassed for
--      the imported continuation. When plan_end passes, the existing
--      booking gate (paid_period_end check) naturally expires the
--      subscription, so no new lapse code is needed.
--
--   2. A cross-gym import_inference_corrections table captures every
--      AI-suggested plan/tag mapping and the owner's final decision, so
--      the next gym's import gets exact matches served instantly and
--      novel plan-names benefit from the most-similar past corrections
--      as Claude few-shot examples. pg_trgm gives us fuzzy similarity
--      without standing up a vector store. RLS denies all client reads —
--      the edge function (service role) is the only reader/writer.
--      record_import_corrections is the public RPC the wizard calls on
--      commit. Payloads carry only plan-name strings and counts: no
--      emails, names or DOBs.

begin;

-- ============================================================================
-- 1. pending_members.linked_membership_plan_id
-- ============================================================================

alter table public.pending_members
  add column if not exists linked_membership_plan_id uuid
    references public.membership_plans(plan_id) on delete set null;

create index if not exists pending_members_linked_plan_idx
  on public.pending_members(linked_membership_plan_id)
  where linked_membership_plan_id is not null;

-- ============================================================================
-- 2. apply_pending_member_data — extend to create plan_subscription
-- ============================================================================
--
-- All existing behaviour preserved verbatim (stamp imported_* columns,
-- copy tags into member_tags, propagate unsubscribed, flip pending row
-- to linked). New: when linked_membership_plan_id is set, insert a
-- plan_subscription with the imported credits / period end. The plan's
-- kind determines whether credit_balance is set (credit_pack /
-- credit_period) or left null (unlimited).

create or replace function public.apply_pending_member_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_pending public.pending_members%rowtype;
  v_plan    public.membership_plans%rowtype;
  v_tag     text;
begin
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

  update public.gym_memberships
    set imported_plan_name         = v_pending.plan_name,
        imported_plan_start        = v_pending.plan_start,
        imported_plan_end          = v_pending.plan_end,
        imported_credits_remaining = v_pending.credits_remaining,
        imported_at                = now()
    where id = new.id;

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
      on conflict (gym_id, lower(email)) do nothing;
  end if;

  -- NEW: auto-create the working plan_subscription. Only when the
  -- importer mapped this pending row to a Temple plan; rows without a
  -- mapping behave exactly as before (metadata stamped, no
  -- subscription created — staff handle manually).
  if v_pending.linked_membership_plan_id is not null then
    select * into v_plan
      from public.membership_plans
      where plan_id = v_pending.linked_membership_plan_id;

    if v_plan.plan_id is not null and v_plan.archived_at is null then
      insert into public.plan_subscriptions (
        gym_membership_id, profile_id, gym_id, plan_id,
        status, credit_balance, paid_period_end,
        stripe_subscription_id, priority
      ) values (
        new.id, new.profile_id, new.gym_id, v_plan.plan_id,
        'active'::public.plan_sub_state,
        case
          when v_plan.kind in ('credit_pack', 'credit_period')
            then coalesce(v_pending.credits_remaining, v_plan.credit_count)
          else null
        end,
        case
          when v_pending.plan_end is not null
            then v_pending.plan_end::timestamptz
          else null
        end,
        null,
        0
      );
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
-- 3. import_inference_corrections — cross-gym learning store
-- ============================================================================

create extension if not exists pg_trgm;

create table if not exists public.import_inference_corrections (
  id              uuid primary key default gen_random_uuid(),
  field_kind      text not null
    check (field_kind in ('plan', 'tag')),
  input_payload   jsonb not null,
  ai_suggestion   jsonb,
  final_value     jsonb not null,
  was_overridden  boolean not null,
  gym_id          uuid references public.gyms(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Fuzzy similarity over the plan-name string for the look-aside cache.
-- The IMMUTABLE coercion of lower(jsonb->>) requires an expression
-- index — GIN with gin_trgm_ops gives us trigram-backed similarity()
-- queries in milliseconds without standing up a vector store.
create index if not exists import_inference_corrections_lookup_idx
  on public.import_inference_corrections
  using gin ((lower(input_payload->>'raw_name')) gin_trgm_ops);

create index if not exists import_inference_corrections_field_recency_idx
  on public.import_inference_corrections (field_kind, created_at desc);

create index if not exists import_inference_corrections_exact_idx
  on public.import_inference_corrections
    (field_kind, (lower(input_payload->>'raw_name')), created_at desc);

alter table public.import_inference_corrections enable row level security;

-- No client policies — RLS denies by default. The edge function reads
-- and writes with the service role; the public RPC below is the only
-- way an authenticated owner can contribute.

-- ============================================================================
-- 4. record_import_corrections RPC
-- ============================================================================
--
-- Wizards call this on commit with one entry per plan / tag decision
-- the review step rendered. Each entry stores the AI input, the AI
-- suggestion (nullable when AI was unavailable), the owner's final
-- value, and a was_overridden flag. SECURITY DEFINER so authenticated
-- owners can write across the no-RLS-policy boundary.

create or replace function public.record_import_corrections(
  p_gym_id uuid,
  p_rows   jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_count   int := 0;
begin
  if not public.user_can_assign_plan(p_gym_id) then
    raise exception 'Not authorised';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if (v_row->>'field_kind') not in ('plan', 'tag') then continue; end if;
    if v_row->'input_payload' is null or v_row->'final_value' is null then
      continue;
    end if;
    insert into public.import_inference_corrections
      (field_kind, input_payload, ai_suggestion, final_value,
       was_overridden, gym_id)
    values
      (v_row->>'field_kind',
       v_row->'input_payload',
       case when v_row->'ai_suggestion' is null then null
            else v_row->'ai_suggestion' end,
       v_row->'final_value',
       coalesce((v_row->>'was_overridden')::boolean, false),
       p_gym_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.record_import_corrections(uuid, jsonb)
  to authenticated;

-- ============================================================================
-- 5. import_pending_members — accept linked_membership_plan_id per row
-- ============================================================================
--
-- Same auth gate, same upsert semantics, additionally writing the new
-- column when the wizard supplies it. Linked rows still leave the
-- historical record alone (`status = 'linked'` short-circuits the
-- update branch as before).

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
  v_plan_id  uuid;
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
    v_plan_id := nullif(v_row->>'linked_membership_plan_id', '')::uuid;

    select * into v_existing
      from public.pending_members
      where gym_id = p_gym_id and lower(email) = lower(v_email);

    if v_existing.id is null then
      insert into public.pending_members
        (gym_id, email, full_name, date_of_birth, plan_name,
         plan_start, plan_end, credits_remaining, imported_status,
         tags, unsubscribed, notes, linked_membership_plan_id, created_by)
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
        v_plan_id,
        v_caller
      );
      v_inserted := v_inserted + 1;
    elsif v_existing.status = 'linked' then
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
            notes             = coalesce(nullif(trim(coalesce(v_row->>'notes','')),''), notes),
            linked_membership_plan_id =
              coalesce(v_plan_id, linked_membership_plan_id)
        where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_inserted, v_updated, v_skipped;
end;
$$;

grant execute on function public.import_pending_members(uuid, jsonb)
  to authenticated;

commit;
