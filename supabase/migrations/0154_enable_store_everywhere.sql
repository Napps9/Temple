-- Store on by default, same move as 0153 for the website builder.
--
-- store_enabled (0085) defaulted to false so a gym opted in via
-- set_store_settings. The store is part of the base product now:
-- backfill every existing gym and default the column to true so new
-- gyms start with it on. Unlike the website flag this one keeps its
-- owner-facing setter — set_store_settings still lets an owner switch
-- the store off (and back on) per gym.

begin;

alter table public.gyms
  alter column store_enabled set default true;

update public.gyms
   set store_enabled = true
 where not store_enabled;

commit;
