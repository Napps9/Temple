-- Member importer completeness + legacy billing continuation.
--
-- Three gaps found dry-running a real CSV import against a demo gym:
--
-- 1. profiles.phone and gym_memberships.emergency_contact are real,
--    used columns but the importer had no way to populate them from a
--    CSV — silently dropped on every import.
--
-- 2. Active recurring memberships (Monthly Unlimited etc.) leave
--    Membership End Date blank in every real export (they're
--    ongoing) while Next Bill Date holds the actual renewal date —
--    but the importer only ever wired plan_end into paid_period_end,
--    so that renewal date was discarded entirely, not even stored
--    informationally. paid_period_end lands null instead (harmless —
--    coalesce(paid_period_end, 'infinity') already treats null as
--    "doesn't expire" — but it also means these members vanish from
--    renewal-risk reporting).
--
-- 3. A CSV-only import (no adopted Stripe subscription, see 0089)
--    creates a plan_subscription with stripe_subscription_id null and
--    Temple bills nothing — by design, so a legacy import never
--    double-charges someone still being billed on their old system.
--    But nothing ever surfaces that to the member or lets them move
--    onto real Temple billing: the member UI shows it identically to
--    a real paid plan, and self-serve switch/cancel hits a dead-end
--    error since stripe-modify-subscription requires a real
--    stripe_subscription_id. imported_legacy makes that state
--    explicit so the app can show a "continue billing" prompt instead
--    of pretending everything's already handled.

begin;

-- ============================================================================
-- 1. pending_members: phone, emergency_contact, next_bill_date
-- ============================================================================

alter table public.pending_members
  add column if not exists phone             text,
  add column if not exists emergency_contact text,
  add column if not exists next_bill_date    date;

-- ============================================================================
-- 2. plan_subscriptions.imported_legacy
-- ============================================================================

alter table public.plan_subscriptions
  add column if not exists imported_legacy boolean not null default false;

-- ============================================================================
-- 3. apply_pending_member_data — write phone/emergency_contact through,
--    fall back to next_bill_date for paid_period_end, flag legacy rows.
-- ============================================================================
--
-- Same shape as the 0089 version (still the "adopt real Stripe sub"
-- path when imported_stripe_subscription_id is set) with three
-- changes: the gym_memberships update now also carries
-- emergency_contact, profiles.phone is coalesced from the pending
-- row, and paid_period_end falls back to next_bill_date when plan_end
-- is empty. imported_legacy is true only when there's no adopted
-- Stripe subscription — an adopted one already bills live, so it
-- isn't "legacy" in the sense the UI needs to act on.

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
-- 4. import_pending_members — accept phone, emergency_contact, next_bill_date
-- ============================================================================

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
         tags, unsubscribed, notes, linked_membership_plan_id,
         imported_stripe_subscription_id, imported_stripe_customer_id,
         phone, emergency_contact, next_bill_date,
         created_by)
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
        nullif(trim(coalesce(v_row->>'imported_stripe_subscription_id', '')), ''),
        nullif(trim(coalesce(v_row->>'imported_stripe_customer_id', '')), ''),
        nullif(trim(coalesce(v_row->>'phone', '')), ''),
        nullif(trim(coalesce(v_row->>'emergency_contact', '')), ''),
        nullif(v_row->>'next_bill_date', '')::date,
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
              coalesce(v_plan_id, linked_membership_plan_id),
            imported_stripe_subscription_id =
              coalesce(nullif(trim(coalesce(v_row->>'imported_stripe_subscription_id','')),''), imported_stripe_subscription_id),
            imported_stripe_customer_id =
              coalesce(nullif(trim(coalesce(v_row->>'imported_stripe_customer_id','')),''), imported_stripe_customer_id),
            phone             = coalesce(nullif(trim(coalesce(v_row->>'phone','')),''), phone),
            emergency_contact = coalesce(nullif(trim(coalesce(v_row->>'emergency_contact','')),''), emergency_contact),
            next_bill_date    = coalesce(nullif(v_row->>'next_bill_date','')::date, next_bill_date)
        where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_inserted, v_updated, v_skipped;
end;
$$;

grant execute on function public.import_pending_members(uuid, jsonb)
  to authenticated;

-- ============================================================================
-- 5. update_my_emergency_contact — member self-serve
-- ============================================================================
--
-- gym_memberships has no self-update RLS policy (only owner/admin), so
-- a member editing their own emergency contact on Account needs a
-- narrow security-definer RPC rather than a client-side .update().

create or replace function public.update_my_emergency_contact(
  p_gym_id  uuid,
  p_contact text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  update public.gym_memberships
    set emergency_contact = nullif(trim(coalesce(p_contact, '')), '')
    where gym_id = p_gym_id
      and profile_id = v_uid
      and left_at is null;
  if not found then
    raise exception 'Not a member of this gym';
  end if;
end;
$$;
grant execute on function public.update_my_emergency_contact(uuid, text) to authenticated;

commit;
