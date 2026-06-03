-- Phase 1 / Track B: discounts + promo codes (§3.4).
--
-- Owners author discounts; members redeem a code at signup. A
-- discount can be percent (e.g. 25%) or amount (e.g. £10 off).
-- valid_from / valid_to enforce a window; max_redemptions caps
-- total uses (NULL = unlimited).
--
-- stripe_coupon_id / stripe_promo_id mirror the discount into Stripe
-- so the actual price the member pays comes from Stripe — never an
-- in-app "discount" that doesn't change the real charge (spec
-- forbids that). The mirror happens in a follow-up edge function;
-- the schema lands here so signup_member can reference discount_id
-- on plan_subscriptions.
--
-- Validation is via redeem_discount(code, plan_id) which returns
-- enough info for the signup UI to render the discounted price
-- preview. It does NOT consume a redemption — that happens when
-- signup_member is called and the plan_subscription row is created.

create type public.discount_kind as enum ('percent', 'amount');

create table public.discounts (
  discount_id        uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  code               text not null,
  kind               public.discount_kind not null,
  -- percent stored in basis points (2500 = 25.00%). amount in cents.
  value              integer not null check (value > 0),
  valid_from         timestamptz,
  valid_to           timestamptz,
  max_redemptions    integer,
  redemption_count   integer not null default 0,
  stripe_coupon_id   text,
  stripe_promo_id    text,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (gym_id, lower(code)),
  check (max_redemptions is null or max_redemptions >= 0),
  check (kind = 'percent' and value <= 10000 or kind = 'amount'),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create index discounts_gym_idx on public.discounts(gym_id);
create index discounts_code_idx on public.discounts(gym_id, lower(code))
  where archived_at is null;

alter table public.discounts enable row level security;

create policy discounts_owner_manage on public.discounts
  for all using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));

-- Members can read discounts at their gym (so the redeem function
-- can return enough info for the price preview). Active-only via
-- the function; the policy is permissive.
create policy discounts_tenant_select on public.discounts
  for select using (public.user_belongs_to(gym_id));

-- ============================================================================
-- discount_redemptions
--   One row per successful redemption. The discount_id ↔ subscription
--   link lets owners report on which promo brought which member in.
-- ============================================================================

create table public.discount_redemptions (
  redemption_id        uuid primary key default gen_random_uuid(),
  discount_id          uuid not null references public.discounts(discount_id) on delete restrict,
  plan_subscription_id uuid not null references public.plan_subscriptions(id) on delete cascade,
  redeemed_at          timestamptz not null default now()
);

create index discount_redemptions_discount_idx on public.discount_redemptions(discount_id);

alter table public.discount_redemptions enable row level security;

create policy discount_redemptions_owner_select on public.discount_redemptions
  for select using (
    exists (
      select 1 from public.discounts d
      where d.discount_id = discount_redemptions.discount_id
        and public.user_is_owner_of(d.gym_id)
    )
  );

-- Members can see their own redemptions via the plan_subscription.
create policy discount_redemptions_self_select on public.discount_redemptions
  for select using (
    exists (
      select 1 from public.plan_subscriptions ps
      where ps.id = discount_redemptions.plan_subscription_id
        and ps.profile_id = auth.uid()
    )
  );

-- ============================================================================
-- redeem_discount — validation + price preview.
--   Returns the resolved discount + a computed final price for the
--   plan's monthly_price_cents. Does not write anything; the actual
--   consume + plan_subscriptions.discount_id wiring happens inside
--   signup_member.
-- ============================================================================

create or replace function public.redeem_discount(
  p_gym_id  uuid,
  p_code    text,
  p_plan_id uuid
) returns table (
  discount_id          uuid,
  kind                 public.discount_kind,
  value                integer,
  original_price_cents integer,
  final_price_cents    integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_discount  public.discounts;
  v_plan      public.membership_plans;
  v_final     integer;
begin
  select * into v_discount
  from public.discounts
  where gym_id = p_gym_id
    and lower(code) = lower(p_code)
    and archived_at is null
    and (valid_from is null or valid_from <= now())
    and (valid_to   is null or valid_to   >  now())
    and (max_redemptions is null or redemption_count < max_redemptions);

  if v_discount.discount_id is null then
    raise exception 'Discount not found, expired, or fully redeemed';
  end if;

  select * into v_plan
  from public.membership_plans
  where plan_id = p_plan_id and gym_id = p_gym_id;
  if v_plan.plan_id is null then
    raise exception 'Plan not found';
  end if;

  if v_plan.monthly_price_cents is null then
    return query
      select v_discount.discount_id, v_discount.kind, v_discount.value,
             null::integer, null::integer;
    return;
  end if;

  v_final := case v_discount.kind
    when 'percent' then
      greatest(0, v_plan.monthly_price_cents - (v_plan.monthly_price_cents * v_discount.value / 10000))
    when 'amount' then
      greatest(0, v_plan.monthly_price_cents - v_discount.value)
  end;

  return query
    select v_discount.discount_id, v_discount.kind, v_discount.value,
           v_plan.monthly_price_cents, v_final;
end;
$$;

grant execute on function public.redeem_discount(uuid, text, uuid) to authenticated;
