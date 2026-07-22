-- Site builder — draft/publish separation.
--
-- Until now a gym's public site read the SAME `design` column the editor
-- writes to on every keystroke (via the 1200ms autosave), so any edit to
-- an already-published site went live to anonymous visitors instantly —
-- there was no real "draft". This adds a published snapshot:
--
--   * `published_design` holds the design copied at the moment of publish;
--     the public RPC (gym_website_by_slug) reads it instead of live `design`.
--   * editing `design` (autosave) no longer changes anything public until
--     the owner publishes again.
--   * `published_at` records when that snapshot was taken.
--
-- Publish/unpublish move to SECURITY DEFINER RPCs so the snapshot copy and
-- the published flag flip atomically and can't be driven out of step by a
-- client that sets one without the other. The client `.update({published})`
-- is retired in favour of these.
--
-- Also folded in here (all touch the same table/policies):
--   * updated_at is now maintained by a trigger, not the client — every
--     write path (the new RPCs, and 0157's save RPC) bumps it authoritatively.
--   * the RLS entitlement asymmetry is closed: the UPDATE with-check and the
--     DELETE policy previously omitted the website_builder_enabled recheck
--     that SELECT/INSERT/UPDATE-using already enforce, so a gym with the
--     builder disabled could still be UPDATE-d or DELETE-d by a capable staffer.

begin;

-- ============================================================================
-- 1. Snapshot columns.
-- ============================================================================

alter table public.gym_websites
  add column if not exists published_design jsonb,
  add column if not exists published_at timestamptz;

-- Backfill: an already-published site's live design becomes its snapshot,
-- so nothing goes dark the moment the public RPC switches columns below.
update public.gym_websites
  set published_design = design,
      published_at = coalesce(published_at, updated_at)
  where published = true
    and published_design is null;

-- ============================================================================
-- 2. updated_at trigger — authoritative, no longer set client-side.
-- ============================================================================

create or replace function public._gym_websites_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger gym_websites_touch_updated_at_trg
  before update on public.gym_websites
  for each row execute function public._gym_websites_touch_updated_at();

-- ============================================================================
-- 3. RLS — close the entitlement-recheck asymmetry.
--
-- SELECT/INSERT/UPDATE-using already require website_builder_enabled; the
-- UPDATE with-check and DELETE did not. Recreate both to match.
-- ============================================================================

drop policy gym_websites_update on public.gym_websites;
create policy gym_websites_update on public.gym_websites
  for update using (
    public.effective_can(gym_id, 'can_manage_website')
    and exists (select 1 from public.gyms g where g.id = gym_id and g.website_builder_enabled)
  )
  with check (
    public.effective_can(gym_id, 'can_manage_website')
    and exists (select 1 from public.gyms g where g.id = gym_id and g.website_builder_enabled)
  );

drop policy gym_websites_delete on public.gym_websites;
create policy gym_websites_delete on public.gym_websites
  for delete using (
    public.effective_can(gym_id, 'can_manage_website')
    and exists (select 1 from public.gyms g where g.id = gym_id and g.website_builder_enabled)
  );

-- ============================================================================
-- 4. Public read — now serves the snapshot, not the live draft.
--
-- Return shape is unchanged (still 7 columns incl. gym_currency from 0098);
-- only the source of `design` changes: published_design, not design. DROP
-- first — CREATE OR REPLACE can't change a function that keeps the same
-- shape without issue, but we DROP for symmetry with 0098's precedent and
-- to make the column swap explicit.
-- ============================================================================

drop function if exists public.gym_website_by_slug(text);

create function public.gym_website_by_slug(p_slug text)
returns table (
  gym_id             uuid,
  gym_name           text,
  gym_logo_url       text,
  gym_primary_color  text,
  gym_currency       text,
  theme              text,
  design             jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select w.gym_id, g.name, g.logo_url, g.primary_color, g.currency, w.theme,
         coalesce(w.published_design, w.design)
  from public.gym_websites w
  join public.gyms g on g.id = w.gym_id
  where g.slug = lower(p_slug)
    and w.published = true;
$$;
grant execute on function public.gym_website_by_slug(text) to anon, authenticated;

-- ============================================================================
-- 5. Publish / unpublish RPCs — snapshot copy + flag flip, atomically.
--
-- Both re-assert capability AND entitlement independently of RLS, since
-- SECURITY DEFINER bypasses the base table's policies. Publish copies the
-- current draft into the snapshot; unpublish just clears the flag and
-- leaves the snapshot in place (so re-publishing without further edits
-- restores the same content, and published_at reflects the last publish).
-- Return the new updated_at so the client can keep its optimistic-
-- concurrency token (see 0157) in sync after a publish.
-- ============================================================================

create function public.publish_gym_website(p_gym_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated timestamptz;
begin
  if not public.effective_can(p_gym_id, 'can_manage_website') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.gyms g where g.id = p_gym_id and g.website_builder_enabled) then
    raise exception 'website_builder_disabled' using errcode = 'insufficient_privilege';
  end if;

  update public.gym_websites
    set published = true,
        published_design = design,
        published_at = now()
    where gym_id = p_gym_id
    returning updated_at into v_updated;

  if v_updated is null then
    raise exception 'no_site' using errcode = 'no_data_found';
  end if;
  return v_updated;
end;
$$;
grant execute on function public.publish_gym_website(uuid) to authenticated;

create function public.unpublish_gym_website(p_gym_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated timestamptz;
begin
  if not public.effective_can(p_gym_id, 'can_manage_website') then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.gyms g where g.id = p_gym_id and g.website_builder_enabled) then
    raise exception 'website_builder_disabled' using errcode = 'insufficient_privilege';
  end if;

  update public.gym_websites
    set published = false
    where gym_id = p_gym_id
    returning updated_at into v_updated;

  if v_updated is null then
    raise exception 'no_site' using errcode = 'no_data_found';
  end if;
  return v_updated;
end;
$$;
grant execute on function public.unpublish_gym_website(uuid) to authenticated;

commit;
