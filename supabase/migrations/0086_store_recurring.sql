-- Gym Store — Phase 2: recurring (subscription) products.
--
-- Members can subscribe to a monthly product — a digital good re-delivered
-- each cycle (e.g. monthly programming) or a no-deliverable service (e.g.
-- locker rental). Physical subscription boxes (per-cycle shipping +
-- fulfilment) are deliberately deferred to Phase 3, enforced here by a
-- CHECK that a recurring product can't be physical.
--
-- Billing rides the same Stripe Connect subscription rails as memberships:
-- store-checkout opens a subscription-mode Checkout Session on the gym's
-- connected account (lazily creating + caching a recurring Price), and the
-- webhook drives the lifecycle. Each paid cycle is recorded as an ordinary
-- paid store_order (with its line + a fresh digital delivery), so cycles
-- flow through the existing receipts, purchases list and revenue summary
-- with no new machinery. Cancellation is at period end.

begin;

-- ============================================================================
-- 1. store_products — recurring billing attributes
-- ============================================================================

alter table public.store_products
  add column if not exists recurring boolean not null default false,
  add column if not exists recurring_interval text,
  add column if not exists stripe_price_id text;

alter table public.store_products
  add constraint store_products_recurring_interval_valid
    check (recurring_interval is null or recurring_interval in ('week', 'month', 'year')),
  add constraint store_products_recurring_shape
    check (recurring = (recurring_interval is not null)),
  -- Recurring physical (subscription boxes) is Phase 3.
  add constraint store_products_recurring_not_physical
    check (not recurring or kind <> 'physical');

-- ============================================================================
-- 2. store_subscriptions — a member's live recurring purchase
-- ============================================================================

create table public.store_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  gym_id                 uuid not null references public.gyms(id) on delete cascade,
  profile_id             uuid not null references public.profiles(id) on delete cascade,
  product_id             uuid references public.store_products(id) on delete set null,
  name_snapshot          text not null,
  kind_snapshot          public.store_product_kind not null,
  unit_price_cents       integer not null,
  currency               text not null,
  interval               text not null,
  -- Snapshot of the file to re-deliver each cycle (null for a service).
  digital_asset_path     text,
  status                 text not null default 'active'
                           check (status in ('active', 'past_due', 'cancelled')),
  cancel_at_period_end   boolean not null default false,
  current_period_end     timestamptz,
  stripe_subscription_id text unique,
  stripe_customer_id     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  cancelled_at           timestamptz
);

create index store_subscriptions_member_idx
  on public.store_subscriptions (profile_id, created_at desc);
create index store_subscriptions_gym_idx
  on public.store_subscriptions (gym_id, status);

-- Each paid cycle becomes a store_order; link it back to the subscription
-- and key idempotency off the Stripe invoice.
alter table public.store_orders
  add column if not exists subscription_id uuid
    references public.store_subscriptions(id) on delete set null,
  add column if not exists stripe_invoice_id text unique;

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table public.store_subscriptions enable row level security;

-- A member sees their own; managing staff see the gym's. No client writes —
-- created/advanced by the webhook, cancelled via store-cancel-subscription.
create policy store_subs_select on public.store_subscriptions
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_manage_store')
  );

-- ============================================================================
-- 4. Member catalogue — re-create to add the recurring columns.
--    (CREATE OR REPLACE can't change a function's RETURNS shape.)
-- ============================================================================

drop function if exists public.list_store_products(uuid);
create function public.list_store_products(p_gym_id uuid)
returns table (
  id                uuid,
  name              text,
  description       text,
  kind              public.store_product_kind,
  price_cents       integer,
  image_url         text,
  track_inventory   boolean,
  stock_quantity    integer,
  sold_out          boolean,
  recurring         boolean,
  recurring_interval text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.user_belongs_to(p_gym_id) then
    raise exception 'Not a member of this gym';
  end if;
  return query
    select
      p.id,
      p.name,
      p.description,
      p.kind,
      p.price_cents,
      p.image_url,
      p.track_inventory,
      p.stock_quantity,
      (p.track_inventory and coalesce(p.stock_quantity, 0) <= 0) as sold_out,
      p.recurring,
      p.recurring_interval
    from public.store_products p
    where p.gym_id = p_gym_id
      and p.active
      and p.archived_at is null
    order by p.created_at desc;
end;
$$;

grant execute on function public.list_store_products(uuid) to authenticated;

-- ============================================================================
-- 5. Per-cycle settlement — called by stripe-webhook (service role) on each
--    paid subscription invoice. Records the cycle as a paid order + line +
--    (for a digital good) a fresh delivery. Idempotent on the invoice id.
-- ============================================================================

create function public._record_store_subscription_cycle(
  p_stripe_subscription_id text,
  p_stripe_invoice_id      text,
  p_amount_total           integer,
  p_period_end             timestamptz
) returns table (
  order_id     uuid,
  gym_id       uuid,
  profile_id   uuid,
  currency     text,
  newly_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub      public.store_subscriptions;
  v_existing uuid;
  v_order    uuid;
  v_item     uuid;
begin
  select * into v_sub
    from public.store_subscriptions
    where stripe_subscription_id = p_stripe_subscription_id
    for update;
  if v_sub.id is null then
    return;  -- unknown subscription: nothing to do
  end if;

  update public.store_subscriptions
    set status = 'active',
        current_period_end = coalesce(p_period_end, current_period_end),
        updated_at = now()
    where id = v_sub.id;

  select id into v_existing
    from public.store_orders
    where stripe_invoice_id = p_stripe_invoice_id;
  if v_existing is not null then
    order_id := v_existing;
    gym_id := v_sub.gym_id;
    profile_id := v_sub.profile_id;
    currency := v_sub.currency;
    newly_created := false;
    return next;
    return;
  end if;

  insert into public.store_orders
    (gym_id, profile_id, subscription_id, status, subtotal_cents, shipping_cents,
     total_cents, currency, has_physical, stripe_invoice_id, paid_at)
  values
    (v_sub.gym_id, v_sub.profile_id, v_sub.id, 'paid', v_sub.unit_price_cents, 0,
     coalesce(p_amount_total, v_sub.unit_price_cents), v_sub.currency, false,
     p_stripe_invoice_id, now())
  returning id into v_order;

  insert into public.store_order_items
    (order_id, gym_id, product_id, name_snapshot, kind_snapshot,
     unit_price_cents, quantity, line_total_cents)
  values
    (v_order, v_sub.gym_id, v_sub.product_id, v_sub.name_snapshot,
     v_sub.kind_snapshot, v_sub.unit_price_cents, 1, v_sub.unit_price_cents)
  returning id into v_item;

  if v_sub.kind_snapshot = 'digital' and v_sub.digital_asset_path is not null then
    insert into public.store_digital_deliveries
      (order_item_id, gym_id, product_id, profile_id, name_snapshot, asset_path)
    values
      (v_item, v_sub.gym_id, v_sub.product_id, v_sub.profile_id,
       v_sub.name_snapshot, v_sub.digital_asset_path);
  end if;

  order_id := v_order;
  gym_id := v_sub.gym_id;
  profile_id := v_sub.profile_id;
  currency := v_sub.currency;
  newly_created := true;
  return next;
end;
$$;

revoke all on function public._record_store_subscription_cycle(text, text, integer, timestamptz)
  from public;
grant execute on function public._record_store_subscription_cycle(text, text, integer, timestamptz)
  to service_role;

-- ============================================================================
-- 6. Staff subscriber list
-- ============================================================================

create function public.staff_store_subscriptions(p_gym_id uuid)
returns table (
  id                   uuid,
  product_name         text,
  buyer_name           text,
  unit_price_cents     integer,
  currency             text,
  interval             text,
  status               text,
  cancel_at_period_end boolean,
  current_period_end   timestamptz,
  created_at           timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_manage_store') then
    raise exception 'Not allowed';
  end if;
  return query
    select
      s.id, s.name_snapshot, pr.full_name, s.unit_price_cents, s.currency,
      s.interval, s.status, s.cancel_at_period_end, s.current_period_end,
      s.created_at
    from public.store_subscriptions s
    join public.profiles pr on pr.id = s.profile_id
    where s.gym_id = p_gym_id
    order by (s.status = 'active') desc, s.created_at desc;
end;
$$;

grant execute on function public.staff_store_subscriptions(uuid) to authenticated;

commit;
