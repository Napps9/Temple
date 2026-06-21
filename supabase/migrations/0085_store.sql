-- Gym Store — Phase 1.
--
-- A branded storefront where members buy one-off goods: physical items
-- (water bottles, tees — shipped, so Stripe collects an address) and
-- digital goods (programmes, event tickets — delivered as a private
-- Storage asset the buyer downloads on-platform and via a signed link in
-- the receipt email). Recurring products are a later phase.
--
-- Money rides the existing Stripe Connect rails: store-checkout opens a
-- direct-charge Checkout Session on the gym's connected account (no
-- platform fee, like memberships) and stripe-webhook records the result.
-- Inventory decrements at payment, and a tracked item with no stock left
-- reads as sold out.
--
-- Access control: two new capabilities. can_manage_store gates adding /
-- pricing / fulfilling; can_see_store_revenue gates the sales figures.
-- Enabling the store and the shipping fee are owner-level settings.

begin;

-- ============================================================================
-- 1. Capabilities — register before any policy references them.
-- ============================================================================

create or replace function public.default_capability(
  p_role public.gym_role,
  p_capability text
) returns boolean
language sql
immutable
as $$
  select case p_capability
    when 'can_access_staff_area' then p_role in ('admin','coach','staff')
    when 'can_see_money'         then false
    when 'can_see_full_pii'      then p_role = 'admin'
    when 'can_see_email'         then p_role = 'admin'
    when 'can_see_health_flag'   then p_role in ('admin','coach','staff')
    when 'can_edit_classes'      then p_role in ('admin','coach')
    when 'can_check_in_member'   then p_role in ('admin','coach','staff')
    when 'can_issue_override'    then p_role in ('admin','coach','staff')
    when 'can_issue_comp_grant'  then p_role in ('admin','coach')
    when 'can_manage_plans'      then false
    when 'can_assign_plan'       then p_role in ('admin','coach','staff')
    when 'can_invite'            then p_role = 'admin'
    when 'can_refund'            then false
    when 'can_manage_staff'      then p_role = 'admin'
    when 'can_see_insights'      then p_role = 'admin'
    when 'can_set_targets'       then false
    when 'can_export_members'    then p_role = 'admin'
    when 'can_manage_tags'       then p_role = 'admin'
    when 'can_manage_tasks'      then p_role in ('admin','coach')
    when 'can_request_cover'     then p_role = 'coach'
    when 'can_claim_cover'       then p_role = 'coach'
    when 'can_manage_sops'       then p_role = 'admin'
    when 'can_view_sops'         then p_role in ('admin','coach','staff')
    when 'can_view_attendance'   then p_role in ('admin','coach','staff')
    when 'can_archive_classes'   then p_role in ('admin','coach')
    when 'can_archive_plans'     then false
    when 'can_archive_members'   then p_role = 'admin'
    when 'can_hard_delete'       then false
    when 'can_see_workout_logs'  then p_role in ('admin','coach')
    when 'can_set_coach_pay'     then false
    when 'can_configure_leaderboards' then false
    when 'can_post_announcements'     then p_role in ('admin','coach')
    when 'can_broadcast_to_class'     then p_role in ('admin','coach')
    when 'can_manage_parq'            then p_role = 'admin'
    when 'can_acknowledge_alerts'     then p_role in ('admin','coach')
    when 'can_manage_comms'           then p_role = 'admin'
    when 'can_manage_store'           then p_role = 'admin'
    when 'can_see_store_revenue'      then p_role = 'admin'
    else false
  end;
$$;

grant execute on function public.default_capability(public.gym_role, text) to authenticated;

-- ============================================================================
-- 2. Gym-level store settings (owner-configured).
-- ============================================================================

alter table public.gyms
  add column if not exists store_enabled boolean not null default false,
  add column if not exists store_shipping_fee_cents integer not null default 0
    check (store_shipping_fee_cents >= 0);

create or replace function public.set_store_settings(
  p_gym_id            uuid,
  p_enabled           boolean,
  p_shipping_fee_cents integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_owner_of(p_gym_id) then
    raise exception 'Only an owner can change store settings';
  end if;
  if p_shipping_fee_cents < 0 then
    raise exception 'Shipping fee cannot be negative';
  end if;
  update public.gyms
    set store_enabled = p_enabled,
        store_shipping_fee_cents = p_shipping_fee_cents
    where id = p_gym_id;
end;
$$;

grant execute on function public.set_store_settings(uuid, boolean, integer) to authenticated;

-- ============================================================================
-- 3. Types + tables
-- ============================================================================

create type public.store_product_kind as enum ('physical', 'digital');
create type public.store_order_status as enum
  ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded');

-- The catalogue. digital_asset_path points at a private Storage object and
-- is NEVER exposed to members (they read the catalogue through
-- list_store_products, which omits it); only can_manage_store staff select
-- the base table. track_inventory off = unlimited (a programme); on = a
-- finite count (apparel, event tickets) that reads as sold out at zero.
create table public.store_products (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  name               text not null,
  description        text,
  kind               public.store_product_kind not null,
  price_cents        integer not null check (price_cents >= 0),
  image_url          text,
  track_inventory    boolean not null default true,
  stock_quantity     integer check (stock_quantity is null or stock_quantity >= 0),
  digital_asset_path text,
  active             boolean not null default true,
  archived_at        timestamptz,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A tracked item must carry a count; an untracked one must not.
  constraint store_products_stock_shape
    check (track_inventory = (stock_quantity is not null))
);

create index store_products_gym_idx on public.store_products (gym_id);

-- One row per checkout. Pending until the webhook confirms payment. The
-- shipping snapshot is whatever Stripe collected at checkout (physical
-- orders only). Money is integer minor units in the gym's currency.
create table public.store_orders (
  id                        uuid primary key default gen_random_uuid(),
  gym_id                    uuid not null references public.gyms(id) on delete cascade,
  profile_id                uuid not null references public.profiles(id) on delete cascade,
  status                    public.store_order_status not null default 'pending',
  subtotal_cents            integer not null default 0,
  shipping_cents            integer not null default 0,
  total_cents               integer not null default 0,
  currency                  text not null,
  has_physical              boolean not null default false,
  shipping_name             text,
  shipping_address          jsonb,
  tracking_note             text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id  text,
  paid_at                   timestamptz,
  fulfilled_at              timestamptz,
  fulfilled_by              uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now()
);

create index store_orders_gym_idx on public.store_orders (gym_id, created_at desc);
create index store_orders_member_idx on public.store_orders (profile_id, created_at desc);

-- Line snapshots — name/price/kind frozen at purchase so later catalogue
-- edits never rewrite history. gym_id is denormalised for cheap RLS.
create table public.store_order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.store_orders(id) on delete cascade,
  gym_id           uuid not null references public.gyms(id) on delete cascade,
  product_id       uuid references public.store_products(id) on delete set null,
  name_snapshot    text not null,
  kind_snapshot    public.store_product_kind not null,
  unit_price_cents integer not null,
  quantity         integer not null check (quantity > 0),
  line_total_cents integer not null
);

create index store_order_items_order_idx on public.store_order_items (order_id);

-- A member's claim on a digital asset, created at payment. asset_path is a
-- snapshot of the product's path at purchase time, so re-uploading the
-- product file later doesn't change what a past buyer downloads. The
-- buyer downloads via a signed URL (on-platform on demand, or the link in
-- the receipt email).
create table public.store_digital_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  order_item_id      uuid not null references public.store_order_items(id) on delete cascade,
  gym_id             uuid not null references public.gyms(id) on delete cascade,
  product_id         uuid references public.store_products(id) on delete set null,
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  name_snapshot      text not null,
  asset_path         text not null,
  created_at         timestamptz not null default now(),
  last_downloaded_at timestamptz
);

create index store_deliveries_member_idx on public.store_digital_deliveries (profile_id);

-- ============================================================================
-- 4. RLS
-- ============================================================================

alter table public.store_products enable row level security;
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;
alter table public.store_digital_deliveries enable row level security;

-- Products: staff who manage the store read + write the base table
-- directly. Members never touch it — they read the safe projection from
-- list_store_products, which hides digital_asset_path.
create policy store_products_staff_select on public.store_products
  for select using (public.effective_can(gym_id, 'can_manage_store'));
create policy store_products_staff_insert on public.store_products
  for insert with check (public.effective_can(gym_id, 'can_manage_store'));
create policy store_products_staff_update on public.store_products
  for update using (public.effective_can(gym_id, 'can_manage_store'))
  with check (public.effective_can(gym_id, 'can_manage_store'));

-- Orders: a member sees their own; managing staff see the gym's queue.
-- No client writes — orders are created by store-checkout and advanced by
-- the webhook / fulfil_store_order, all under the service role.
create policy store_orders_select on public.store_orders
  for select using (
    profile_id = auth.uid()
    or public.effective_can(gym_id, 'can_manage_store')
  );

create policy store_order_items_select on public.store_order_items
  for select using (
    exists (
      select 1 from public.store_orders o
      where o.id = order_id
        and (o.profile_id = auth.uid()
             or public.effective_can(o.gym_id, 'can_manage_store'))
    )
  );

-- Deliveries are the buyer's to read (to mint a download URL). Staff don't
-- need the asset path — they manage the product, not the grant.
create policy store_deliveries_self_select on public.store_digital_deliveries
  for select using (profile_id = auth.uid());

-- ============================================================================
-- 5. Storage buckets + policies
-- ============================================================================

-- Product images — public read so the storefront and the receipt email
-- can render them anywhere. Writes gated on can_manage_store for the gym
-- folder (<gym_id>/...), mirroring email-assets.
insert into storage.buckets (id, name, public)
  values ('store-product-images', 'store-product-images', true)
  on conflict (id) do nothing;

-- Digital goods — private. Members read only the objects they've bought
-- (matched by a delivery row); staff read/write their gym's folder.
insert into storage.buckets (id, name, public)
  values ('store-digital-assets', 'store-digital-assets', false)
  on conflict (id) do nothing;

drop policy if exists store_images_public_read   on storage.objects;
drop policy if exists store_images_staff_insert  on storage.objects;
drop policy if exists store_images_staff_delete  on storage.objects;
drop policy if exists store_assets_member_read   on storage.objects;
drop policy if exists store_assets_staff_read    on storage.objects;
drop policy if exists store_assets_staff_insert  on storage.objects;
drop policy if exists store_assets_staff_delete  on storage.objects;

create policy store_images_public_read on storage.objects
  for select using (bucket_id = 'store-product-images');

-- Folder segment compared as text — never cast to uuid, since this policy
-- is evaluated against every bucket's inserts and a non-uuid folder
-- elsewhere would error the cast.
create policy store_images_staff_insert on storage.objects
  for insert with check (
    bucket_id = 'store-product-images'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_store')
    )
  );

create policy store_images_staff_delete on storage.objects
  for delete using (
    bucket_id = 'store-product-images'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_store')
    )
  );

create policy store_assets_member_read on storage.objects
  for select using (
    bucket_id = 'store-digital-assets'
    and exists (
      select 1 from public.store_digital_deliveries d
      where d.profile_id = auth.uid()
        and d.asset_path = name
    )
  );

create policy store_assets_staff_read on storage.objects
  for select using (
    bucket_id = 'store-digital-assets'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_store')
    )
  );

create policy store_assets_staff_insert on storage.objects
  for insert with check (
    bucket_id = 'store-digital-assets'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_store')
    )
  );

create policy store_assets_staff_delete on storage.objects
  for delete using (
    bucket_id = 'store-digital-assets'
    and exists (
      select 1 from public.gym_memberships gm
      where gm.profile_id = auth.uid()
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_store')
    )
  );

-- ============================================================================
-- 6. Member catalogue — the safe projection (no digital_asset_path).
-- ============================================================================

create or replace function public.list_store_products(p_gym_id uuid)
returns table (
  id             uuid,
  name           text,
  description    text,
  kind           public.store_product_kind,
  price_cents    integer,
  image_url      text,
  track_inventory boolean,
  stock_quantity integer,
  sold_out       boolean
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
      (p.track_inventory and coalesce(p.stock_quantity, 0) <= 0) as sold_out
    from public.store_products p
    where p.gym_id = p_gym_id
      and p.active
      and p.archived_at is null
    order by p.created_at desc;
end;
$$;

grant execute on function public.list_store_products(uuid) to authenticated;

-- ============================================================================
-- 7. Payment settlement — called by stripe-webhook under the service role.
--    NOT granted to authenticated: a member must never be able to mark
--    their own order paid. Idempotent on the pending->paid transition.
-- ============================================================================

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
    select oi.id, oi.product_id, oi.kind_snapshot, oi.quantity,
           oi.name_snapshot, p.digital_asset_path
      from public.store_order_items oi
      left join public.store_products p on p.id = oi.product_id
      where oi.order_id = v_order.id
  loop
    if v_item.product_id is not null then
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

-- No internal caller check (it trusts the service role), so it must not be
-- reachable by members — Postgres grants EXECUTE to PUBLIC by default.
revoke all on function public._mark_store_order_paid(text, text, integer, text, jsonb)
  from public;
grant execute on function public._mark_store_order_paid(text, text, integer, text, jsonb)
  to service_role;

-- ============================================================================
-- 8. Staff order queue + fulfilment + revenue.
-- ============================================================================

-- Joins the buyer's name (crosses profiles RLS, hence security definer),
-- gated on can_manage_store. Newest first; the staff screen filters.
create or replace function public.staff_store_orders(p_gym_id uuid)
returns table (
  id              uuid,
  status          public.store_order_status,
  subtotal_cents  integer,
  shipping_cents  integer,
  total_cents     integer,
  currency        text,
  has_physical    boolean,
  shipping_name   text,
  shipping_address jsonb,
  tracking_note   text,
  buyer_name      text,
  item_count      integer,
  items_summary   text,
  created_at      timestamptz,
  paid_at         timestamptz,
  fulfilled_at    timestamptz
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
      o.id, o.status, o.subtotal_cents, o.shipping_cents, o.total_cents,
      o.currency, o.has_physical, o.shipping_name, o.shipping_address,
      o.tracking_note,
      pr.full_name,
      coalesce(sum(oi.quantity)::int, 0),
      string_agg(oi.quantity || '× ' || oi.name_snapshot, ', '
        order by oi.name_snapshot),
      o.created_at, o.paid_at, o.fulfilled_at
    from public.store_orders o
    join public.profiles pr on pr.id = o.profile_id
    left join public.store_order_items oi on oi.order_id = o.id
    where o.gym_id = p_gym_id
      and o.status <> 'pending'
    group by o.id, pr.full_name
    order by o.created_at desc;
end;
$$;

grant execute on function public.staff_store_orders(uuid) to authenticated;

-- Mark a paid order shipped/handed over. Physical orders need this; an
-- all-digital order is delivered the instant it's paid, but staff may
-- still mark it done for their own tracking.
create or replace function public.fulfil_store_order(
  p_order_id uuid,
  p_note     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
  v_status public.store_order_status;
begin
  select gym_id, status into v_gym, v_status
    from public.store_orders where id = p_order_id;
  if v_gym is null then
    raise exception 'Order not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_store') then
    raise exception 'Not allowed';
  end if;
  if v_status not in ('paid', 'fulfilled') then
    raise exception 'Only a paid order can be fulfilled';
  end if;
  update public.store_orders
    set status = 'fulfilled',
        fulfilled_at = now(),
        fulfilled_by = auth.uid(),
        tracking_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_order_id;
end;
$$;

grant execute on function public.fulfil_store_order(uuid, text) to authenticated;

-- Store sales over a window, by currency. Gated separately so an owner can
-- let someone run the shop without opening the books.
create or replace function public.store_revenue_summary(
  p_gym_id       uuid,
  p_period_start date,
  p_period_end   date
) returns table (
  currency    text,
  gross_cents bigint,
  order_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_see_store_revenue') then
    raise exception 'Not allowed';
  end if;
  return query
    select o.currency, sum(o.total_cents)::bigint, count(*)::int
    from public.store_orders o
    where o.gym_id = p_gym_id
      and o.status in ('paid', 'fulfilled')
      and o.paid_at is not null
      and o.paid_at >= p_period_start::timestamptz
      and o.paid_at < (p_period_end + 1)::timestamptz
    group by o.currency;
end;
$$;

grant execute on function public.store_revenue_summary(uuid, date, date) to authenticated;

commit;
