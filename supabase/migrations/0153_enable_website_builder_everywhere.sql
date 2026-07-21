-- Website builder for everyone.
--
-- website_builder_enabled (0097) launched as a paid add-on: default
-- false, flipped per-gym by Temple staff after an external invoice.
-- That gate is now retired — the website builder is part of the base
-- product. Backfill every existing gym and change the column default
-- so new gyms get it from creation. The column itself stays (RLS on
-- gym_websites / gym_website_domains and the stock-photos edge
-- function all reference it) so this is a data + default change, not
-- a schema removal.

begin;

alter table public.gyms
  alter column website_builder_enabled set default true;

update public.gyms
   set website_builder_enabled = true
 where not website_builder_enabled;

commit;
