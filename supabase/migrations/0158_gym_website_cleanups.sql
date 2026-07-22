-- Site builder housekeeping (no behaviour change):
--
--   * Drop gym_websites_gym_idx. The gym_id UNIQUE constraint (0097)
--     already provides an identical btree index, so this one is pure
--     duplicate write cost.
--   * Refresh the design default from the stale legacy v1 shape to the
--     current v2 document. The app always inserts a full design, and
--     coerceDocument upgrades v1->v2 on read, so this is cosmetic — but a
--     freshly defaulted row should not be born in a shape the code treats
--     as legacy.

begin;

drop index if exists public.gym_websites_gym_idx;

alter table public.gym_websites
  alter column design set default
    '{"version":2,"settings":{"themeId":"forged"},"pages":[{"id":"home","slug":"","title":"Home","blocks":[]}]}'::jsonb;

commit;
