-- The shop gets aisles
--
-- The member storefront is one flat list: a gym selling tee shirts,
-- programme PDFs and open-gym passes stacks them all in one column and
-- the member scrolls past the kind they did not come for. The boards
-- draw category chips over a grid — All, Kit, Programmes, whatever the
-- gym actually sells — and this migration gives the chips something to
-- stand on.
--
-- One nullable text column, deliberately free-form. Gyms sell what they
-- sell; an enum here would be Temple deciding what a gym's aisles are
-- called, and the first gym selling coffee would prove it wrong. A
-- product with no category simply appears under All. Variants and sizes
-- are NOT this migration — they change the checkout line shape and
-- deserve their own design rather than a column bolted on here.
--
-- list_store_products is dropped and recreated rather than replaced:
-- adding a column changes the RETURNS TABLE shape, and CREATE OR
-- REPLACE cannot do that (0043 learnt this the hard way). The body is
-- 0135's with the one extra column. The recreate also picks up the
-- 0240 grant hygiene the 0135 version predates: revoke from public and
-- anon before granting to authenticated.

begin;

alter table public.store_products add column category text;

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
  category           text
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
      p.recurring_interval,
      p.category
    from public.store_products p
    where p.gym_id = p_gym_id
      and p.active
      and p.archived_at is null
    order by p.created_at desc;
end;
$$;

revoke all on function public.list_store_products(uuid) from public, anon;
grant execute on function public.list_store_products(uuid) to authenticated;

commit;
