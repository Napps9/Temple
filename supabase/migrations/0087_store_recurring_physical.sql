-- Gym Store — Phase 3: recurring physical products (subscription boxes).
--
-- Lifts the Phase 2 guard that a recurring product can't be physical. A
-- physical subscription ships a box every cycle: store-checkout now collects
-- a delivery address in subscription mode, the webhook seeds it onto the
-- subscription, and each paid invoice produces an ordinary physical
-- store_order (has_physical, shipping address copied) that drops into the
-- existing staff fulfilment queue — staff mark it shipped each month. The
-- monthly price is all-in (it includes shipping); the per-order flat
-- shipping fee stays a one-off-only thing.
--
-- The member (or managing staff) can update the delivery address on an
-- active box subscription; it takes effect from the next cycle.

begin;

-- ============================================================================
-- 1. Allow recurring physical; carry a delivery address on the subscription
-- ============================================================================

alter table public.store_products
  drop constraint if exists store_products_recurring_not_physical;

alter table public.store_subscriptions
  add column if not exists shipping_name    text,
  add column if not exists shipping_address jsonb;

-- ============================================================================
-- 2. Per-cycle settlement — now also mints physical orders (carrying the
--    subscription's delivery address) for the fulfilment queue. Same shape +
--    idempotency as Phase 2, so CREATE OR REPLACE is safe.
-- ============================================================================

create or replace function public._record_store_subscription_cycle(
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
  v_physical boolean;
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

  v_physical := v_sub.kind_snapshot = 'physical';

  insert into public.store_orders
    (gym_id, profile_id, subscription_id, status, subtotal_cents, shipping_cents,
     total_cents, currency, has_physical, shipping_name, shipping_address,
     stripe_invoice_id, paid_at)
  values
    (v_sub.gym_id, v_sub.profile_id, v_sub.id, 'paid', v_sub.unit_price_cents, 0,
     coalesce(p_amount_total, v_sub.unit_price_cents), v_sub.currency, v_physical,
     case when v_physical then v_sub.shipping_name else null end,
     case when v_physical then v_sub.shipping_address else null end,
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
-- 3. Update the delivery address on a box subscription (self or managing
--    staff). Takes effect from the next cycle's order.
-- ============================================================================

create function public.update_store_subscription_shipping(
  p_sub_id  uuid,
  p_name    text,
  p_address jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.store_subscriptions;
begin
  select * into v_sub from public.store_subscriptions where id = p_sub_id;
  if v_sub.id is null then
    raise exception 'Subscription not found';
  end if;
  if not (
    v_sub.profile_id = auth.uid()
    or public.effective_can(v_sub.gym_id, 'can_manage_store')
  ) then
    raise exception 'Not allowed';
  end if;
  if v_sub.kind_snapshot <> 'physical' then
    raise exception 'Only a shipped subscription has a delivery address';
  end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'A delivery address is required';
  end if;

  update public.store_subscriptions
    set shipping_name = nullif(btrim(coalesce(p_name, '')), ''),
        shipping_address = p_address,
        updated_at = now()
    where id = p_sub_id;
end;
$$;

grant execute on function public.update_store_subscription_shipping(uuid, text, jsonb)
  to authenticated;

commit;
