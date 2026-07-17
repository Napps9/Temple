-- Store product galleries: multiple images per product.
--
-- store_products has carried a single image_url since 0085. This adds an
-- ordered image_urls text[] so a product can show a gallery that members
-- can swipe through. image_url is kept as the cover (the first image),
-- because the Stripe checkout line item (store-checkout edge function) and
-- the staff/list thumbnails read it directly — the editor keeps it in sync
-- with image_urls[1] on save.
--
-- Backfill seeds image_urls from the existing image_url so every current
-- product keeps its photo. The cardinality cap keeps a runaway upload from
-- bloating the row and the member catalogue payload.

alter table public.store_products
  add column image_urls text[] not null default '{}';

update public.store_products
  set image_urls = array[image_url]
  where image_url is not null and btrim(image_url) <> '';

alter table public.store_products
  add constraint store_products_image_urls_max
  check (cardinality(image_urls) <= 8);

-- Member catalogue — re-create to surface the gallery. CREATE OR REPLACE
-- can't change a function's RETURNS shape, so drop first (see 0086/0043).
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
      p.image_urls,
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
