-- The website only shows what you chose, and only the RPCs publish it
--
-- 1. Hiding a plan from your website hid it from the page and not from
--    the server. The pricing block carries hiddenPlanIds and the
--    renderer honours it (src/lib/site-render.ts:568) — but
--    gym_public_plans returns every unarchived plan for a published site
--    (0098:52) and the anon key is embedded in the rendered HTML
--    (site-render.ts:655). So the name, kind, credit count and price of a
--    plan an owner deliberately took off their site were one request
--    away from anybody who viewed it.
--
--    0158 already solved exactly this for hidden team members, and this
--    is that solution applied to the sibling it missed: the same
--    jsonb_path_query exclusion, over the same coalesce(published_design,
--    design), with the same return shape.
--
-- 2. gym_websites still took a bare UPDATE from the client. Every real
--    path is a definer RPC — save_gym_website (0157), publish and
--    unpublish (0156) — and the client only ever inserts (website.tsx:551)
--    or deletes (:605). The leftover UPDATE grant was a second door onto
--    the same table that skips both the readiness check and the snapshot
--    copy that publishing is FOR: an UPDATE straight through PostgREST
--    could set published = true without ever writing published_design,
--    leaving the public site serving a snapshot that was never taken.
--    Revoked, and the policy that guarded it goes with it so a later
--    re-grant cannot silently inherit it (the 0195 argument).
--
-- 3. The website asset policies check the capability and the bucket and
--    the folder, but not whether the gym has the website builder at all
--    (0097:184). 0156 closed that asymmetry on the table and left the
--    storage half open. Latent — 0153 defaulted website_builder_enabled
--    true for every gym — but a gym with it switched off could still
--    write into its asset folder. They also never checked left_at, so
--    somebody who left could too; both predicates go in together.

-- ---------------------------------------------------------------------------
-- 1. A hidden plan is hidden from the server too
-- ---------------------------------------------------------------------------

drop function if exists public.gym_public_plans(text);

create function public.gym_public_plans(p_slug text)
returns table (
  plan_id             uuid,
  name                text,
  kind                text,
  credit_count        int,
  monthly_price_cents int
)
language sql
security definer
stable
set search_path = public
as $$
  select mp.plan_id, mp.name, mp.kind, mp.credit_count, mp.monthly_price_cents
  from public.membership_plans mp
  join public.gyms g on g.id = mp.gym_id
  join public.gym_websites w on w.gym_id = g.id
  where g.slug = lower(p_slug)
    and mp.archived_at is null
    and w.published = true
    -- What the owner ticked off the pricing block. Read from the
    -- published snapshot when there is one, exactly as the renderer does,
    -- so hiding a plan and publishing takes effect together.
    and mp.plan_id::text not in (
      select hid #>> '{}'
      from jsonb_path_query(
        coalesce(w.published_design, w.design), 'lax $.**.hiddenPlanIds[*]'
      ) as hid
      where jsonb_typeof(hid) = 'string'
    )
  order by mp.monthly_price_cents nulls last;
$$;

grant execute on function public.gym_public_plans(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Only the RPCs publish
-- ---------------------------------------------------------------------------

revoke update on public.gym_websites from anon, authenticated;

drop policy if exists gym_websites_update on public.gym_websites;

-- ---------------------------------------------------------------------------
-- 3. Asset writes need the builder switched on
-- ---------------------------------------------------------------------------
--
-- 0097's policies verbatim plus two predicates: the entitlement, which is
-- the point of this change, and `left_at is null`, which they never had —
-- somebody who left the gym could still write into its asset folder. The
-- bucket name and the text (not uuid) folder comparison are unchanged;
-- 0097's own note explains the latter, and it still applies.

drop policy if exists website_assets_staff_insert on storage.objects;
drop policy if exists website_assets_staff_delete on storage.objects;

create policy website_assets_staff_insert on storage.objects
  for insert with check (
    bucket_id = 'gym-website-assets'
    and exists (
      select 1 from public.gym_memberships gm
      join public.gyms g on g.id = gm.gym_id
      where gm.profile_id = auth.uid()
        and gm.left_at is null
        and g.website_builder_enabled
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_website')
    )
  );

create policy website_assets_staff_delete on storage.objects
  for delete using (
    bucket_id = 'gym-website-assets'
    and exists (
      select 1 from public.gym_memberships gm
      join public.gyms g on g.id = gm.gym_id
      where gm.profile_id = auth.uid()
        and gm.left_at is null
        and g.website_builder_enabled
        and (storage.foldername(name))[1] = gm.gym_id::text
        and public.effective_can(gm.gym_id, 'can_manage_website')
    )
  );
