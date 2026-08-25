-- Three months off a one-off purchase
--
-- 0264 lets an owner write "50% off for three months" and attach it to
-- any plan. A credit pack is bought once — mode=payment, not a
-- subscription — so a repeating discount on one means nothing: Stripe
-- takes it off the single charge and the other two months never come.
-- The owner has promised something the machinery cannot deliver, and
-- the member is the one who reads the promise.
--
-- preview_plan_coupon is the one place that decides whether a code
-- applies, so the refusal belongs there rather than in a CHECK: whether
-- it is nonsense depends on the plan being bought, not on the coupon
-- alone, and the same coupon is perfectly sensible on the membership
-- sitting next to it.

begin;

create or replace function public.preview_plan_coupon(
  p_gym_id  uuid,
  p_plan_id uuid,
  p_code    text
)
returns table (
  coupon_id             uuid,
  code                  text,
  name                  text,
  discount_kind         text,
  percent_off           numeric,
  amount_off_cents      integer,
  currency              text,
  duration              text,
  duration_in_months    integer,
  discounted_first_cents integer,
  reason                text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c      public.plan_coupons;
  v_uid  uuid := auth.uid();
  v_used integer;
  v_mine integer;
  v_price integer;
  v_kind  text;
  v_new   integer;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (
    select 1 from public.gym_memberships
    where gym_id = p_gym_id and profile_id = v_uid and left_at is null
  ) then
    raise exception 'Not a member of this gym';
  end if;

  -- Alias-qualified: this function's OUT parameters include code, name,
  -- currency and duration, and a bare column name in here reads the
  -- (null) output variable instead of the column.
  select pc.* into c
    from public.plan_coupons pc
   where pc.gym_id = p_gym_id
     and upper(pc.code) = upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', '', 'g'))
     and pc.archived_at is null
   limit 1;

  if c.id is null then
    return query select null::uuid, null::text, null::text, null::text,
                        null::numeric, null::integer, null::text, null::text,
                        null::integer, null::integer,
                        'That code isn''t recognised'::text;
    return;
  end if;

  select count(*)::integer into v_used
    from public.plan_coupon_redemptions r where r.coupon_id = c.id;
  select count(*)::integer into v_mine
    from public.plan_coupon_redemptions r
   where r.coupon_id = c.id and r.profile_id = v_uid;

  select mp.monthly_price_cents, mp.kind into v_price, v_kind
    from public.membership_plans mp
   where mp.plan_id = p_plan_id and mp.gym_id = p_gym_id;

  v_reason := case
    when c.valid_from > now() then 'That code isn''t active yet'
    when c.valid_until is not null and c.valid_until < now() then 'That code has expired'
    when c.max_redemptions is not null and v_used >= c.max_redemptions
      then 'That code has been fully claimed'
    when v_mine >= c.per_member_limit then 'You''ve already used that code'
    when exists (
      select 1 from public.plan_coupon_plans cp where cp.coupon_id = c.id
    ) and not exists (
      select 1 from public.plan_coupon_plans cp
      where cp.coupon_id = c.id and cp.plan_id = p_plan_id
    ) then 'That code doesn''t apply to this plan'
    -- A credit pack is bought once, so a discount measured in months
    -- cannot be honoured. Refused here rather than half-applied at
    -- checkout, where the member would only find out from the receipt.
    when c.duration = 'repeating' and v_kind = 'credit_pack'
      then 'That code runs for several months, so it can''t be used on a one-off pack'
    else null
  end;

  -- Display only. What is actually charged is Stripe's arithmetic on
  -- the coupon it holds; this is the figure shown beside it, computed
  -- here so the screen and the server agree about the rounding.
  v_new := case
    when v_price is null then null
    when c.discount_kind = 'percent'
      then greatest(0, floor(v_price * (100 - c.percent_off) / 100)::integer)
    else greatest(0, v_price - c.amount_off_cents)
  end;

  return query select
    c.id, c.code, c.name, c.discount_kind, c.percent_off, c.amount_off_cents,
    c.currency, c.duration, c.duration_in_months, v_new, v_reason;
end;
$$;

commit;
