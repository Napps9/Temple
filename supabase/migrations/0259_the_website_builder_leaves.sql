-- The website builder leaves
--
-- Shipped across 0097-0162 and hardened in 0220, the builder let a gym
-- publish a marketing site under /site/<slug> or a custom domain. It is
-- now removed entirely as a scope cut, not a sunset: no gym ever
-- published a site or connected a domain, so nothing needs a migration
-- path and the data can go with the code. Everything the feature owned
-- is dropped here — the two tables, the eleven functions, the gate
-- column, the capability, and the asset bucket. The same push deletes
-- the client editor, the /site renderer, the domain middleware, and the
-- custom-domain / stock-photos edge functions; _shared/caller.ts stops
-- consulting gym_website_domains for email-link origins in that push
-- too, and if an old worker races this drop its query simply errors
-- into the app-origin fallback, which is the right answer for every
-- gym.

begin;

-- The RPCs, public read surface first, then the staff writes.
drop function public.gym_website_by_slug(text);
drop function public.gym_public_schedule(text);
drop function public.gym_public_plans(text);
drop function public.gym_public_team(text);
drop function public.gym_public_ai_phone(text);
drop function public.gym_slug_for_domain(text);
drop function public.gym_website_canonical_domain(text);
drop function public.save_gym_website(uuid, jsonb, text, timestamptz);
drop function public.publish_gym_website(uuid);
drop function public.unpublish_gym_website(uuid);
drop function public._gym_website_image_urls(jsonb);

-- The tables take their policies, indexes and the touch trigger with
-- them; the trigger's function can only go once its trigger has.
drop table public.gym_website_domains;
drop table public.gym_websites;
drop function public._gym_websites_touch_updated_at();

-- The asset-bucket policies check website_builder_enabled, so they must
-- go before the column can.
drop policy if exists website_assets_public_read  on storage.objects;
drop policy if exists website_assets_staff_insert on storage.objects;
drop policy if exists website_assets_staff_delete on storage.objects;

alter table public.gyms drop column website_builder_enabled;

-- The capability: 0226's body restated with the website line removed.
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
    -- Same people can_assign_plan has today, so the split changes
    -- nothing on day one and the switch finally says what it does.
    when 'can_work_leads'        then p_role in ('admin','coach','staff')
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
    when 'can_program_members'        then p_role in ('admin','coach')
    when 'can_review_ai_calls'        then p_role = 'admin'
    when 'can_bulk_edit_classes'      then p_role = 'admin'
    else false
  end;
$$;

-- Stored overrides for the dead key, both layers (0020, 0127).
delete from public.gym_role_capabilities
  where capability = 'can_manage_website';
delete from public.gym_member_capabilities
  where capability = 'can_manage_website';

-- The asset bucket itself (SQL-level storage removal precedent: 0137);
-- its policies went above, ahead of the column drop.
delete from storage.objects where bucket_id = 'gym-website-assets';
delete from storage.buckets where id = 'gym-website-assets';

commit;
