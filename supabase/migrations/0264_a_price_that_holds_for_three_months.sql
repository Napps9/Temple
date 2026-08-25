-- A price that holds for three months
--
-- The owner runs an offer — first month free, half price in January, a
-- reward for a referral — and today there is nowhere to put it. There
-- is one price column on a plan and nothing anywhere in the schema that
-- knows what a discount is.
--
-- The principle: the code is ours, the arithmetic is Stripe's. A coupon
-- here is a code, a window, a cap and a list of plans; the money is a
-- Stripe Coupon on the gym's own connected account, attached to the
-- Checkout Session. Not allow_promotion_codes, which would move
-- validation into Stripe's dashboard where the per-member limit and the
-- plan restriction do not exist. A discount Temple computed by itself
-- would drift from the invoice the member actually receives, and the
-- invoice is the one they will read out on the phone.
--
-- What is mirrored to Stripe is the arithmetic and nothing else:
-- percent or amount, once or N months. max_redemptions, the valid-until
-- date and the plan list stay here, enforced in preview_plan_coupon —
-- a Stripe-side max_redemptions would brick a cached coupon id the
-- moment it filled up.
--
-- Stripe's Coupon is immutable in every field that decides money, so
-- once stripe_coupon_id is set those columns freeze here too. A trigger
-- AND the RPC both refuse it: the owner who edits 20% to 50% would
-- otherwise keep charging 20% while the screen said 50%, and the
-- invoice would be the only place the truth appeared. The trigger is
-- there because the RPC should not be the only thing standing between
-- a PATCH and a wrong number.
--
-- Redemptions are counted, not reserved. Every other cap in this schema
-- is enforced at the moment of effect, and a reservation ledger would
-- need its own expiry sweep to stay honest. The cost is that a code
-- going round a WhatsApp group could land a couple over its cap from
-- checkouts already open; the saving is a state machine that can rot.
--
-- 'forever' is deliberately not a duration. This is a limited-time
-- offer; an owner who wants a permanent price should price a plan.

begin;

-- ============================================================================
-- 1. plan_coupons
-- ============================================================================

create table public.plan_coupons (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  code               text not null,
  -- What shows on the member's invoice.
  name               text,
  discount_kind      text not null check (discount_kind in ('percent', 'amount')),
  percent_off        numeric(5,2) check (percent_off > 0 and percent_off <= 100),
  amount_off_cents   integer check (amount_off_cents > 0),
  currency           text,
  duration           text not null default 'once'
                       check (duration in ('once', 'repeating')),
  duration_in_months integer check (duration_in_months between 1 and 36),
  valid_from         timestamptz not null default now(),
  valid_until        timestamptz,
  max_redemptions    integer check (max_redemptions >= 1),
  per_member_limit   integer not null default 1 check (per_member_limit >= 1),
  archived_at        timestamptz,
  -- Created lazily at first checkout and cached, exactly as
  -- membership_plans.stripe_price_id is: SQL cannot call Stripe, and a
  -- gym may write an offer before it has connected Stripe at all.
  stripe_coupon_id   text,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  check (
    (discount_kind = 'percent'
      and percent_off is not null
      and amount_off_cents is null and currency is null)
    or
    (discount_kind = 'amount'
      and amount_off_cents is not null and currency is not null
      and percent_off is null)
  ),
  check (
    (duration = 'repeating' and duration_in_months is not null)
    or (duration <> 'repeating' and duration_in_months is null)
  ),
  check (valid_until is null or valid_until > valid_from)
);

create unique index plan_coupons_gym_code_idx
  on public.plan_coupons (gym_id, upper(code));
create index plan_coupons_gym_live_idx
  on public.plan_coupons (gym_id, valid_until) where archived_at is null;

-- Empty means every plan, the same way plan_class_types (0008) means
-- every class type. Stated because the opposite reading is the natural
-- one and it would silently make every coupon inapplicable.
create table public.plan_coupon_plans (
  coupon_id uuid not null references public.plan_coupons(id) on delete cascade,
  plan_id   uuid not null references public.membership_plans(plan_id) on delete cascade,
  primary key (coupon_id, plan_id)
);

create table public.plan_coupon_redemptions (
  id                         uuid primary key default gen_random_uuid(),
  coupon_id                  uuid not null references public.plan_coupons(id) on delete cascade,
  gym_id                     uuid not null references public.gyms(id) on delete cascade,
  profile_id                 uuid not null references public.profiles(id) on delete cascade,
  plan_id                    uuid references public.membership_plans(plan_id) on delete set null,
  -- 'self_serve' came through Stripe and changed a charge. 'staff' was
  -- applied on the unbilled path, where it changes the recorded price
  -- and nothing else — see assign_member_plan below.
  source                     text not null check (source in ('self_serve', 'staff')),
  stripe_checkout_session_id text,
  stripe_subscription_id     text,
  applied_at                 timestamptz not null default now()
);

create unique index plan_coupon_redemptions_session_idx
  on public.plan_coupon_redemptions (coupon_id, stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index plan_coupon_redemptions_member_idx
  on public.plan_coupon_redemptions (coupon_id, profile_id);

-- ============================================================================
-- 2. The money fields freeze once Stripe has seen them
-- ============================================================================

create function public._plan_coupon_freeze()
returns trigger
language plpgsql
as $$
begin
  if old.stripe_coupon_id is not null
     and (new.discount_kind      is distinct from old.discount_kind
       or new.percent_off        is distinct from old.percent_off
       or new.amount_off_cents   is distinct from old.amount_off_cents
       or new.currency           is distinct from old.currency
       or new.duration           is distinct from old.duration
       or new.duration_in_months is distinct from old.duration_in_months)
  then
    raise exception
      'This coupon has already been used — archive it and create a new one';
  end if;
  return new;
end;
$$;

create trigger plan_coupons_freeze_money
  before update on public.plan_coupons
  for each row execute function public._plan_coupon_freeze();

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table public.plan_coupons            enable row level security;
alter table public.plan_coupon_plans       enable row level security;
alter table public.plan_coupon_redemptions enable row level security;

-- A member must never be able to read the coupon table: the codes ARE
-- the discount, and a list of them is a list of free money. Their only
-- window is preview_plan_coupon, which needs the code to answer.
create policy plan_coupons_staff_select on public.plan_coupons
  for select using (
    public.effective_can(gym_id, 'can_manage_plans')
    or public.effective_can(gym_id, 'can_see_money')
  );

create policy plan_coupon_plans_staff_select on public.plan_coupon_plans
  for select using (
    exists (
      select 1 from public.plan_coupons c
      where c.id = plan_coupon_plans.coupon_id
        and public.effective_can(c.gym_id, 'can_manage_plans')
    )
  );

create policy plan_coupon_redemptions_staff_select on public.plan_coupon_redemptions
  for select using (public.effective_can(gym_id, 'can_see_money'));
create policy plan_coupon_redemptions_self_select on public.plan_coupon_redemptions
  for select using (profile_id = auth.uid());

revoke insert, update, delete on public.plan_coupons            from anon, authenticated;
revoke insert, update, delete on public.plan_coupon_plans       from anon, authenticated;
revoke insert, update, delete on public.plan_coupon_redemptions from anon, authenticated;

-- ============================================================================
-- 4. Writing an offer
-- ============================================================================

create function public.upsert_plan_coupon(
  p_gym_id             uuid,
  p_code               text,
  p_discount_kind      text,
  p_coupon_id          uuid    default null,
  p_name               text    default null,
  p_percent_off        numeric default null,
  p_amount_off_cents   integer default null,
  p_duration           text    default 'once',
  p_duration_in_months integer default null,
  p_valid_from         timestamptz default null,
  p_valid_until        timestamptz default null,
  p_max_redemptions    integer default null,
  p_per_member_limit   integer default 1,
  p_plan_ids           uuid[]  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_code     text;
  v_currency text;
  v_id       uuid := p_coupon_id;
  v_plan     uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  -- A coupon is pricing, and pricing is owner-only in this product.
  if not public.effective_can(p_gym_id, 'can_manage_plans') then
    raise exception 'Not authorised';
  end if;

  v_code := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', '', 'g'));
  if length(v_code) < 3 or length(v_code) > 40 or v_code !~ '^[A-Z0-9_-]+$' then
    raise exception
      'A code can use letters, numbers, dashes and underscores';
  end if;

  if p_discount_kind = 'amount' then
    select coalesce(currency, 'GBP') into v_currency
      from public.gyms where id = p_gym_id;
  end if;

  if p_plan_ids is not null then
    foreach v_plan in array p_plan_ids loop
      if not exists (
        select 1 from public.membership_plans
        where plan_id = v_plan and gym_id = p_gym_id and archived_at is null
      ) then
        raise exception 'Plan belongs to another gym';
      end if;
    end loop;
  end if;

  if v_id is null then
    insert into public.plan_coupons
      (gym_id, code, name, discount_kind, percent_off, amount_off_cents,
       currency, duration, duration_in_months, valid_from, valid_until,
       max_redemptions, per_member_limit, created_by)
    values
      (p_gym_id, v_code, nullif(btrim(coalesce(p_name, '')), ''),
       p_discount_kind, p_percent_off, p_amount_off_cents, v_currency,
       coalesce(p_duration, 'once'), p_duration_in_months,
       coalesce(p_valid_from, now()), p_valid_until,
       p_max_redemptions, coalesce(p_per_member_limit, 1), v_uid)
    returning id into v_id;
  else
    if not exists (
      select 1 from public.plan_coupons
      where id = v_id and gym_id = p_gym_id
    ) then
      raise exception 'Coupon not found';
    end if;
    -- The freeze trigger has the last word on the money fields; this
    -- update simply carries them, so an edit that only renames a live
    -- coupon still works.
    update public.plan_coupons
       set code               = v_code,
           name               = nullif(btrim(coalesce(p_name, '')), ''),
           discount_kind      = p_discount_kind,
           percent_off        = p_percent_off,
           amount_off_cents   = p_amount_off_cents,
           currency           = v_currency,
           duration           = coalesce(p_duration, 'once'),
           duration_in_months = p_duration_in_months,
           valid_from         = coalesce(p_valid_from, valid_from),
           valid_until        = p_valid_until,
           max_redemptions    = p_max_redemptions,
           per_member_limit   = coalesce(p_per_member_limit, 1)
     where id = v_id;
  end if;

  if p_plan_ids is not null then
    delete from public.plan_coupon_plans where coupon_id = v_id;
    insert into public.plan_coupon_plans (coupon_id, plan_id)
    select v_id, unnest(p_plan_ids)
    on conflict do nothing;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'That code is already in use at this gym';
end;
$$;

revoke all on function public.upsert_plan_coupon(
  uuid, text, text, uuid, text, numeric, integer, text, integer,
  timestamptz, timestamptz, integer, integer, uuid[]
) from public, anon;
grant execute on function public.upsert_plan_coupon(
  uuid, text, text, uuid, text, numeric, integer, text, integer,
  timestamptz, timestamptz, integer, integer, uuid[]
) to authenticated;

create function public.archive_plan_coupon(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.plan_coupons where id = p_coupon_id;
  if v_gym is null then
    raise exception 'Coupon not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_plans') then
    raise exception 'Not authorised';
  end if;
  update public.plan_coupons
     set archived_at = coalesce(archived_at, now())
   where id = p_coupon_id;
end;
$$;

revoke all on function public.archive_plan_coupon(uuid) from public, anon;
grant execute on function public.archive_plan_coupon(uuid) to authenticated;

-- ============================================================================
-- 5. The one place that decides whether a code applies
-- ============================================================================

-- Called by the member's screen as they type AND by stripe-checkout
-- before it creates a session. One function, so the answer the member
-- reads and the answer the money is based on cannot disagree.
--
-- Always returns exactly one row. reason is null when the code applies,
-- and otherwise says why in words the member can act on — except for
-- the first, which is deliberately vague: unknown, archived and another
-- gym's code must be indistinguishable, or the codes are enumerable.
create function public.preview_plan_coupon(
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

  -- Alias-qualified: this function's OUT parameters include code,
  -- name, currency and duration, and a bare column name in here reads
  -- the (null) output variable instead of the column.
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
    else null
  end;

  select mp.monthly_price_cents into v_price
    from public.membership_plans mp
   where mp.plan_id = p_plan_id and mp.gym_id = p_gym_id;

  -- Display only. What is actually charged is Stripe's arithmetic on
  -- the coupon it holds; this is the figure the screen shows next to
  -- it, and it is computed here so the screen and the server agree
  -- about the rounding.
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

revoke all on function public.preview_plan_coupon(uuid, uuid, text) from public, anon;
grant execute on function public.preview_plan_coupon(uuid, uuid, text) to authenticated;

-- Written by the Stripe webhook once the money has actually moved.
-- Service role only: nothing a member or a staff account can call
-- should be able to say "this was redeemed".
create function public._apply_plan_coupon(
  p_coupon_id                  uuid,
  p_gym_id                     uuid,
  p_profile_id                 uuid,
  p_plan_id                    uuid,
  p_stripe_checkout_session_id text default null,
  p_stripe_subscription_id     text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.plan_coupon_redemptions
    (coupon_id, gym_id, profile_id, plan_id, source,
     stripe_checkout_session_id, stripe_subscription_id)
  values
    (p_coupon_id, p_gym_id, p_profile_id, p_plan_id, 'self_serve',
     p_stripe_checkout_session_id, p_stripe_subscription_id)
  on conflict (coupon_id, stripe_checkout_session_id)
    where stripe_checkout_session_id is not null
  do update set stripe_subscription_id =
    coalesce(excluded.stripe_subscription_id,
             public.plan_coupon_redemptions.stripe_subscription_id);
$$;

revoke all on function public._apply_plan_coupon(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;

-- ============================================================================
-- 6. The staff path: a coupon that changes the record, not a charge
-- ============================================================================

-- assign_member_plan gains p_coupon_code. Arity change, so the old
-- 5-argument version is dropped first (0043's lesson: CREATE OR REPLACE
-- will not do it).
--
-- Be plain about what this does. This path is unbilled — it refuses a
-- card-billed member outright — so a coupon here changes the price the
-- membership is recorded at and nothing else. It is how "I gave Sam
-- their first month at half price" ends up true in the revenue numbers,
-- not a discount on a charge, because there is no charge.

drop function if exists public.assign_member_plan(uuid, uuid, uuid, date, text);

create function public.assign_member_plan(
  p_gym_id      uuid,
  p_profile_id  uuid,
  p_plan_id     uuid,
  p_until       date default null,
  p_mode        text default 'move',
  p_coupon_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan       public.membership_plans%rowtype;
  v_membership public.gym_memberships%rowtype;
  v_existing   public.plan_subscriptions%rowtype;
  v_ends_at    timestamptz;
  v_credits    integer;
  v_sub_id     uuid;
  v_switched   boolean := false;
  v_coupon     public.plan_coupons%rowtype;
  v_price      integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.effective_can(p_gym_id, 'can_assign_plan') then
    raise exception 'Not authorised';
  end if;
  if p_mode not in ('move', 'add') then
    raise exception 'Unknown mode';
  end if;
  -- Bounded like a comp's window is. Unbounded, the lowest staff tier could
  -- write a perpetual unbilled membership that 0125's sweep can never reach
  -- (it only lapses rows whose end has passed), or a date already gone,
  -- which lands dead the same night.
  if p_until is not null
     and (p_until < current_date or p_until > current_date + 366) then
    raise exception 'End date out of range';
  end if;

  select * into v_plan
    from public.membership_plans
    where plan_id = p_plan_id
      and gym_id = p_gym_id
      and archived_at is null;
  if v_plan.plan_id is null then
    raise exception 'No such plan';
  end if;
  -- programming_only carries credit_count is null by CHECK (0123:104-111), so
  -- it can never satisfy the eligibility predicate's credit test and is not a
  -- class entitlement. Creating one would be actively harmful rather than
  -- merely useless: _book_class_for's require-membership gate (0103:198-204)
  -- tests for the mere EXISTENCE of a subscription row, so this row would
  -- permanently stop the member self-booking classes they can book for free
  -- today. Until that gate learns about plan kinds, this path refuses.
  if v_plan.kind = 'programming_only' then
    raise exception 'Plan does not cover classes';
  end if;

  -- left_at is null matters: the parent-match trigger (0008:152-178)
  -- checks the membership exists but never that it is live, so a removed
  -- member could otherwise be handed an entitling subscription.
  select * into v_membership
    from public.gym_memberships
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and left_at is null;
  if v_membership.id is null then
    raise exception 'Not a member of this gym';
  end if;

  -- The plan's own period, unless the caller named an end. Stored as an
  -- EXCLUSIVE midnight boundary — the instant access stops — so that the
  -- last day always counts in full and 0125's 03:30 sweep lapses the row
  -- the morning after it ran out rather than during it. The same
  -- convention is used for a pending row's plan_end below, because
  -- apply_pending_member_data casts that straight into this column and
  -- the two paths must buy a member the same number of days.
  v_ends_at := case
    when p_until is not null then (p_until + 1)::timestamptz
    when v_plan.kind = 'credit_pack' then null
    when v_plan.period_length is not null
      then ((now() + v_plan.period_length)::date + 1)::timestamptz
    else ((now() + interval '1 month')::date + 1)::timestamptz
  end;

  -- programming_only carries credit_count is null by CHECK (0123:104-111)
  -- and so can never satisfy the booking predicate's credit test. Only
  -- the two credit kinds get a balance.
  v_credits := case
    when v_plan.kind in ('credit_pack', 'credit_period') then v_plan.credit_count
    else null
  end;

  -- A coupon on this path is bookkeeping, not billing. There is no
  -- card here — assign_member_plan refuses a card-billed member a few
  -- lines below — so applying one changes the price this membership is
  -- RECORDED at, and what revenue reporting therefore believes. It
  -- takes no money and it sends no invoice.
  v_price := v_plan.monthly_price_cents;
  if nullif(btrim(coalesce(p_coupon_code, '')), '') is not null then
    select * into v_coupon
      from public.plan_coupons
     where gym_id = p_gym_id
       and upper(code) = upper(regexp_replace(btrim(p_coupon_code), '\s+', '', 'g'))
       and archived_at is null
     limit 1;
    if v_coupon.id is null then
      raise exception 'That code isn''t recognised';
    end if;
    if v_coupon.valid_from > now()
       or (v_coupon.valid_until is not null and v_coupon.valid_until < now()) then
      raise exception 'That code has expired';
    end if;
    if exists (select 1 from public.plan_coupon_plans where coupon_id = v_coupon.id)
       and not exists (
         select 1 from public.plan_coupon_plans
         where coupon_id = v_coupon.id and plan_id = v_plan.plan_id
       ) then
      raise exception 'That code doesn''t apply to this plan';
    end if;
    v_price := case
      when v_price is null then null
      when v_coupon.discount_kind = 'percent'
        then greatest(0, floor(v_price * (100 - v_coupon.percent_off) / 100)::integer)
      else greatest(0, v_price - v_coupon.amount_off_cents)
    end;
  end if;

  -- The newest entitling membership is the one they are on. Statuses match
  -- the booking predicate's (0050:118-127) so "what they're on" means the
  -- same thing here as it does at the door. Read in BOTH modes, because a
  -- card-billed member has to be refused whichever was asked for.
  select * into v_existing
    from public.plan_subscriptions
    where gym_id = p_gym_id
      and profile_id = p_profile_id
      and status in ('active', 'cancelled_at_period_end', 'refunded_retained')
    order by created_at desc
    limit 1;

  -- A live Stripe subscription is a billing change, not a row edit.
  -- Swapping it would bill the old amount forever, and adding a NEWER
  -- unbilled row beside it is worse than useless: the member's own
  -- membership screen resolves one recurring subscription and would pick
  -- this one, taking away their ability to cancel or switch the thing they
  -- are actually paying for. Both modes refuse; stripe-modify-subscription
  -- owns that path.
  if v_existing.id is not null
     and v_existing.stripe_subscription_id is not null then
    raise exception 'Membership is billed by card'
      using hint = v_existing.id::text;
  end if;

  -- Adding means leaving what they have alone; only a move edits it.
  if p_mode = 'move' and v_existing.id is not null then
    update public.plan_subscriptions
      set plan_id         = v_plan.plan_id,
          status          = 'active'::public.plan_sub_state,
          -- Explicit: the snapshot trigger is INSERT-only.
          price_cents     = v_price,
          credit_balance  = v_credits,
          paid_period_end = v_ends_at,
          imported_legacy = true,
          cancelled_at    = null
      where id = v_existing.id
      returning id into v_sub_id;
    v_switched := true;
  else
    insert into public.plan_subscriptions (
      gym_membership_id, profile_id, gym_id, plan_id,
      status, credit_balance, paid_period_end, price_cents,
      stripe_subscription_id, stripe_customer_id, priority,
      -- Unbilled but convertible: this is the flag stripe-checkout's
      -- adoption branch requires (index.ts:151-152) to put the member
      -- onto real billing by UPDATING this row rather than opening a
      -- second one, and the flag 0125's nightly sweep lapses on.
      imported_legacy
    ) values (
      v_membership.id, p_profile_id, p_gym_id, v_plan.plan_id,
      'active'::public.plan_sub_state, v_credits, v_ends_at,
      v_price,
      null, null, 0,
      true
    )
    returning id into v_sub_id;
  end if;

  if v_coupon.id is not null then
    insert into public.plan_coupon_redemptions
      (coupon_id, gym_id, profile_id, plan_id, source)
    values (v_coupon.id, p_gym_id, p_profile_id, v_plan.plan_id, 'staff');
  end if;

  return jsonb_build_object(
    'subscription_id', v_sub_id,
    'switched', v_switched,
    'plan_name', v_plan.name,
    'plan_kind', v_plan.kind,
    'price_cents', v_price,
    'list_price_cents', v_plan.monthly_price_cents,
    'coupon_code', v_coupon.code,
    'credit_balance', v_credits,
    'ends_at', v_ends_at,
    -- The last day they can train, which is the date a person would say.
    -- The stored boundary is the midnight after it; a receipt that echoed
    -- that would name a day they no longer have.
    'runs_to', case when v_ends_at is not null then v_ends_at::date - 1 end
  );
end;
$$;

revoke all on function public.assign_member_plan(uuid, uuid, uuid, date, text, text)
  from public, anon;
grant execute on function public.assign_member_plan(uuid, uuid, uuid, date, text, text)
  to authenticated;

commit;
