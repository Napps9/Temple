-- A shop order can be refunded
--
-- store_order_status has allowed 'refunded' since the shop was built and
-- nothing has ever written it. No screen, no RPC, no edge function — a
-- member who ordered the wrong size had to be refunded in the Stripe
-- dashboard, and the order sat in Temple saying 'paid' for ever. Every
-- other refund path in the product goes through stripe-refund, which is
-- memberships only, so money.refund is scoped to memberships and says so.
--
-- Two halves, the same shape as memberships:
--
--   * The edge function (refund-store-order) talks to Stripe on the gym's
--     connected account, because the secret key never goes near a client
--     and the amount is recomputed server-side rather than trusted.
--   * This function is what it calls afterwards, and it is where the
--     decisions live that Stripe knows nothing about.
--
-- Three of those decisions, none of them obvious:
--
--   1. **Stock comes back only if nothing shipped.** _mark_store_order_paid
--      decrements tracked stock at purchase. Refunding an order that was
--      never fulfilled means the goods are still on the shelf, so the
--      count should go back up. Refunding one that shipped means they are
--      not, and silently adding them back would have somebody sell a
--      hoodie they posted last week.
--   2. **A digital delivery is revoked.** It cannot be un-downloaded and
--      pretending otherwise would be theatre, but leaving a live download
--      link on a refunded order is worse: it is a file the gym is still
--      serving to somebody who has their money back.
--   3. **A partial refund still ends the order.** There is no
--      'partly_refunded' status and inventing one would spread through
--      every surface that reads status. The amount is recorded on the
--      billing event, which is where the money already lives.

-- ---------------------------------------------------------------------------
-- 1. Revoking a digital delivery
-- ---------------------------------------------------------------------------

alter table public.store_digital_deliveries
  add column if not exists revoked_at timestamptz;

comment on column public.store_digital_deliveries.revoked_at is
  'Set when the order was refunded. The select policy hides a revoked '
  'delivery; what was already downloaded is gone, which is why the refund '
  'card says so rather than implying otherwise.';

-- ---------------------------------------------------------------------------
-- 2. The write
-- ---------------------------------------------------------------------------
--
-- Definer and revoked from clients: the only legitimate caller is the
-- edge function, after Stripe has confirmed the money moved. A client
-- able to call this could mark an order refunded without refunding it.

create or replace function public._refund_store_order(
  p_order_id uuid,
  p_refund_cents integer,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.store_orders;
begin
  select * into v_order
    from public.store_orders where id = p_order_id
    for update;
  if v_order.id is null then
    raise exception 'Order not found';
  end if;
  if v_order.status = 'refunded' then
    return;
  end if;

  -- Nothing shipped, so the goods are still here.
  if v_order.fulfilled_at is null then
    update public.store_products p
      set stock_quantity = coalesce(p.stock_quantity, 0) + oi.quantity,
          updated_at = now()
      from public.store_order_items oi
      where oi.order_id = p_order_id
        and oi.product_id = p.id
        and p.track_inventory;
  end if;

  update public.store_digital_deliveries d
    set revoked_at = now()
    from public.store_order_items oi
    where oi.order_id = p_order_id
      and d.order_item_id = oi.id
      and d.revoked_at is null;

  update public.store_orders
    set status = 'refunded'
    where id = p_order_id;

  -- Not a revenue event (is_revenue_event, 0019) — a refund is money
  -- leaving, and counting it as takings would flatter the month. The
  -- gym's connected account id is carried because billing_events_check
  -- requires it and gym_id to be present or absent together. It lives on
  -- gym_stripe_accounts, not on gyms.
  insert into public.billing_events
    (provider_event_id, provider_account_id, gym_id, member_id, kind,
     amount_cents, currency, occurred_at, payload)
  select
    'store_refund:' || p_order_id::text,
    a.stripe_account_id,
    v_order.gym_id,
    v_order.profile_id,
    'refund',
    p_refund_cents,
    v_order.currency,
    now(),
    jsonb_build_object('order_id', p_order_id, 'actor', p_actor)
  from public.gym_stripe_accounts a where a.gym_id = v_order.gym_id
  on conflict (provider, provider_event_id) do nothing;
end;
$$;

revoke execute on function
  public._refund_store_order(uuid, integer, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A revoked download is refused
-- ---------------------------------------------------------------------------
--
-- The member app reads this table directly under RLS (src/lib/store.ts),
-- so there is no RPC to teach — the policy is the whole of the read, and
-- a revoked delivery simply stops being visible. Replaced rather than
-- amended because a policy's USING clause cannot be altered in place.

drop policy if exists store_deliveries_self_select
  on public.store_digital_deliveries;

create policy store_deliveries_self_select on public.store_digital_deliveries
  for select using (profile_id = auth.uid() and revoked_at is null);
