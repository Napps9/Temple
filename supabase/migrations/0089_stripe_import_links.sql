-- 0089_stripe_import_links.sql
--
-- "Adopt" mode for the Stripe member import: bring an existing Stripe
-- subscriber across so their LIVE subscription is owned by Temple. The
-- importer stages each member with their Stripe subscription + customer
-- id; when they sign up, apply_pending_member_data creates the working
-- plan_subscription carrying those ids (not null), so:
--   * stripe-webhook matches renewals / cancels by stripe_subscription_id
--     and keeps the Temple row in sync,
--   * in-app cancel / change-plan act on the real subscription,
--   * future Temple checkouts reuse the same Stripe customer.
-- No re-charge — the subscription keeps billing on its existing schedule.
--
-- CSV imports (no Stripe ids) are unchanged: the subscription is created
-- with null Stripe ids exactly as in 0076.

begin;

alter table public.pending_members
  add column if not exists imported_stripe_subscription_id text,
  add column if not exists imported_stripe_customer_id     text;

-- ----------------------------------------------------------------------
-- apply_pending_member_data — carry the Stripe ids onto the working
-- plan_subscription, and seed gym_stripe_customers so the connected-
-- account customer is reused.
-- ----------------------------------------------------------------------
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
      on conflict (gym_id, lower(email)) where topic_id is null do nothing;
  end if;

  -- Auto-create the working plan_subscription when the importer mapped
  -- this pending row to a Temple plan. When the row also carries a Stripe
  -- subscription id (the "adopt" import), that live subscription becomes
  -- the Temple subscription — same renewal date, no re-charge — and the
  -- connected-account customer is cached for future checkouts.
  if v_pending.linked_membership_plan_id is not null then
    select * into v_plan
      from public.membership_plans
      where plan_id = v_pending.linked_membership_plan_id;

    if v_plan.plan_id is not null and v_plan.archived_at is null then
      insert into public.plan_subscriptions (
        gym_membership_id, profile_id, gym_id, plan_id,
        status, credit_balance, paid_period_end,
        stripe_subscription_id, stripe_customer_id, priority
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
        nullif(v_pending.imported_stripe_subscription_id, ''),
        nullif(v_pending.imported_stripe_customer_id, ''),
        0
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

-- ----------------------------------------------------------------------
-- import_pending_members — accept the two Stripe ids per row.
-- ----------------------------------------------------------------------
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
              coalesce(nullif(trim(coalesce(v_row->>'imported_stripe_customer_id','')),''), imported_stripe_customer_id)
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
