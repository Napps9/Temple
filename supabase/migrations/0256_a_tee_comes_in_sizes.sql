-- A tee comes in sizes
--
-- The store sells "Forge tee" as one product with one stock count, so a
-- gym selling S/M/L either lists three products or guesses. This gives a
-- product variants: named options (S, M, L, EU 42) each with their own
-- optional stock count. Price stays on the product — a size is not a
-- different price, and the day a gym needs priced options it needs a
-- second product, not a surcharge column.
--
-- Stock rules, chosen to avoid a cross-table constraint:
--   - an order line that carries a variant decrements and restocks THAT
--     variant's count (when it has one) and never the product's;
--   - a line without a variant keeps the product-level behaviour;
--   - the catalogue's sold_out flag: with variants present, sold out
--     means every variant with a tracked count is at zero and none is
--     untracked; without, the 0085 rule stands.
--
-- Order items snapshot the variant name (variant_snapshot) the same way
-- they snapshot the product name: history must survive a renamed or
-- deleted size. variant_id itself nulls out on delete.
--
-- Members never read the variants table — the catalogue RPC embeds the
-- variants as jsonb, and checkout validates under the service role.
-- list_store_products is dropped and recreated (RETURNS TABLE shape
-- change, the 0043 rule); _mark_store_order_paid and _refund_store_order
-- keep their signatures so CREATE OR REPLACE preserves their 0240 grants.

begin;

create table public.store_product_variants (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.store_products(id) on delete cascade,
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  name           text not null,
  sort_order     integer not null default 0,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  created_at     timestamptz not null default now()
);

create index store_product_variants_product_idx
  on public.store_product_variants (product_id);
create unique index store_product_variants_name_uniq
  on public.store_product_variants (product_id, lower(name));

alter table public.store_product_variants enable row level security;

-- Staff who manage the store own the rows, delete included — a mistyped
-- size should be removable; sold lines keep their snapshot regardless.
create policy store_variants_staff_select on public.store_product_variants
  for select using (public.effective_can(gym_id, 'can_manage_store'));
create policy store_variants_staff_insert on public.store_product_variants
  for insert with check (public.effective_can(gym_id, 'can_manage_store'));
create policy store_variants_staff_update on public.store_product_variants
  for update using (public.effective_can(gym_id, 'can_manage_store'))
  with check (public.effective_can(gym_id, 'can_manage_store'));
create policy store_variants_staff_delete on public.store_product_variants
  for delete using (public.effective_can(gym_id, 'can_manage_store'));

alter table public.store_order_items
  add column variant_id uuid references public.store_product_variants(id) on delete set null,
  add column variant_snapshot text;

-- ---------------------------------------------------------------------------
-- Catalogue: variants ride along as jsonb, sold_out learns about them.
-- ---------------------------------------------------------------------------

drop function if exists public.list_store_products(uuid);

create function public.list_store_products(p_gym_id uuid)
returns table (
  id                 uuid,
  name               text,
  description        text,
  kind               public.store_product_kind,
  price_cents        integer,
  image_url          text,
  image_urls         text[],
  track_inventory    boolean,
  stock_quantity     integer,
  sold_out           boolean,
  recurring          boolean,
  recurring_interval text,
  category           text,
  variants           jsonb
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
      p.image_urls,
      p.track_inventory,
      p.stock_quantity,
      case
        when exists (select 1 from public.store_product_variants v
                     where v.product_id = p.id)
          then not exists (
            select 1 from public.store_product_variants v
            where v.product_id = p.id
              and (v.stock_quantity is null or v.stock_quantity > 0))
        else (p.track_inventory and coalesce(p.stock_quantity, 0) <= 0)
      end as sold_out,
      p.recurring,
      p.recurring_interval,
      p.category,
      (
        select jsonb_agg(jsonb_build_object(
                 'id', v.id,
                 'name', v.name,
                 'stock_quantity', v.stock_quantity,
                 'sold_out', (v.stock_quantity is not null and v.stock_quantity <= 0)
               ) order by v.sort_order, v.created_at)
        from public.store_product_variants v
        where v.product_id = p.id
      ) as variants
    from public.store_products p
    where p.gym_id = p_gym_id
      and p.active
      and p.archived_at is null
    order by p.created_at desc;
end;
$$;

revoke all on function public.list_store_products(uuid) from public, anon;
grant execute on function public.list_store_products(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settlement: a variant line spends the variant's stock.
-- ---------------------------------------------------------------------------

create or replace function public._mark_store_order_paid(
  p_session_id     text,
  p_payment_intent text,
  p_amount_total   integer,
  p_shipping_name  text,
  p_shipping       jsonb
) returns table (
  order_id   uuid,
  gym_id     uuid,
  profile_id uuid,
  currency   text,
  total_cents integer,
  newly_paid boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.store_orders;
  v_item   record;
begin
  select * into v_order
    from public.store_orders
    where stripe_checkout_session_id = p_session_id
    for update;

  if v_order.id is null then
    return;  -- unknown session: nothing to do
  end if;

  if v_order.status <> 'pending' then
    -- Already settled (Stripe retried the event) — report, don't re-apply.
    order_id := v_order.id;
    gym_id := v_order.gym_id;
    profile_id := v_order.profile_id;
    currency := v_order.currency;
    total_cents := v_order.total_cents;
    newly_paid := false;
    return next;
    return;
  end if;

  update public.store_orders
    set status = 'paid',
        paid_at = now(),
        stripe_payment_intent_id = p_payment_intent,
        shipping_name = coalesce(p_shipping_name, shipping_name),
        shipping_address = coalesce(p_shipping, shipping_address)
    where id = v_order.id;

  -- Decrement tracked stock (clamped at zero) and grant digital deliveries.
  for v_item in
    select oi.id, oi.product_id, oi.variant_id, oi.kind_snapshot, oi.quantity,
           oi.name_snapshot, p.digital_asset_path
      from public.store_order_items oi
      left join public.store_products p on p.id = oi.product_id
      where oi.order_id = v_order.id
  loop
    if v_item.variant_id is not null then
      update public.store_product_variants
        set stock_quantity = greatest(0, stock_quantity - v_item.quantity)
        where id = v_item.variant_id
          and stock_quantity is not null;
    elsif v_item.product_id is not null then
      update public.store_products
        set stock_quantity = greatest(0, coalesce(stock_quantity, 0) - v_item.quantity),
            updated_at = now()
        where id = v_item.product_id
          and track_inventory;
    end if;

    if v_item.kind_snapshot = 'digital' and v_item.digital_asset_path is not null then
      insert into public.store_digital_deliveries
        (order_item_id, gym_id, product_id, profile_id, name_snapshot, asset_path)
      values
        (v_item.id, v_order.gym_id, v_item.product_id, v_order.profile_id,
         v_item.name_snapshot, v_item.digital_asset_path);
    end if;
  end loop;

  order_id := v_order.id;
  gym_id := v_order.gym_id;
  profile_id := v_order.profile_id;
  currency := v_order.currency;
  total_cents := v_order.total_cents;
  newly_paid := true;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refund: the goods go back to the shelf they came from.
-- ---------------------------------------------------------------------------

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
    update public.store_product_variants v
      set stock_quantity = v.stock_quantity + oi.quantity
      from public.store_order_items oi
      where oi.order_id = p_order_id
        and oi.variant_id = v.id
        and v.stock_quantity is not null;
    update public.store_products p
      set stock_quantity = coalesce(p.stock_quantity, 0) + oi.quantity,
          updated_at = now()
      from public.store_order_items oi
      where oi.order_id = p_order_id
        and oi.variant_id is null
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

commit;
