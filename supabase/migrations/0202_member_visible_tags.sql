-- A "visible to the member" flag on tags — enforcement now, surface later.
--
-- member_tags.member_visible marks a tag as safe for its member's own
-- eyes; tag_rules.member_visible stamps rule-applied tags with the same.
-- No member-facing screen reads it yet (deliberately) — the point today
-- is the read boundary: the 0013 SELECT policy was tenant-wide, so any
-- signed-in member could read every member's tags through PostgREST,
-- including internal operational labels like "Ghosting" or "Giving
-- notice". The replacement scopes reads to the staff surfaces that
-- actually use them (can_manage_tags for the roster and tag screens,
-- can_manage_comms for the audience/automation tag pickers) plus a
-- member's OWN tags flagged member_visible — so whatever member surface
-- gets built later, the data it can show is already exactly bounded.
--
-- Rule edits toggle visibility on existing tags IN PLACE: an UPDATE, not
-- the delete-and-reinsert used for label/colour changes, because
-- created_at is the member_tagged automation anchor (0201) and flipping
-- who may see a tag must not make it look freshly gained.

begin;

alter table public.member_tags
  add column member_visible boolean not null default false;

alter table public.tag_rules
  add column member_visible boolean not null default false;

drop policy member_tags_tenant_select on public.member_tags;

create policy member_tags_scoped_select on public.member_tags
  for select using (
    public.effective_can(gym_id, 'can_manage_tags')
    or public.effective_can(gym_id, 'can_manage_comms')
    or (profile_id = auth.uid() and member_visible)
  );

-- ============================================================================
-- _apply_tag_rules — stamp and follow the rule's visibility
-- ============================================================================

create or replace function public._apply_tag_rules(p_gym_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule  public.tag_rules%rowtype;
  v_total integer := 0;
begin
  -- Tags of paused rules go away (deleted rules already cascade via rule_id).
  delete from public.member_tags mt
    using public.tag_rules r
    where mt.rule_id = r.id
      and mt.gym_id = p_gym_id
      and not r.active;

  for v_rule in
    select * from public.tag_rules
    where gym_id = p_gym_id and active = true
  loop
    -- A rule edit that changed label or colour re-creates its tags: the
    -- label is the row's conflict identity, so it can't be moved in place.
    delete from public.member_tags mt
      where mt.rule_id = v_rule.id
        and (mt.label <> v_rule.label or mt.color <> v_rule.color);

    -- Visibility follows the rule in place — created_at must survive.
    update public.member_tags mt
      set member_visible = v_rule.member_visible
      where mt.rule_id = v_rule.id
        and mt.member_visible <> v_rule.member_visible;

    with matches as (
      select c.profile_id
      from public.v_member_cohort c
      where c.gym_id = p_gym_id
        and case v_rule.predicate_kind
          when 'intro'         then c.is_intro
          when 'expiring_soon' then c.days_until_expiry is not null
                                    and c.days_until_expiry <= coalesce(v_rule.threshold_days, 7)
          when 'expired'       then c.is_expired
          when 'paying'        then c.is_paying
          when 'inactive'      then not c.is_active
          when 'never_paid'    then not c.is_paying
          when 'booked_class_type' then exists (
            select 1
            from public.class_bookings cb
            join public.class_sessions cs on cs.id = cb.class_session_id
            where cb.gym_id = p_gym_id
              and cb.profile_id = c.profile_id
              and cs.class_type_id = v_rule.class_type_id
              and (v_rule.threshold_days is null
                   or cs.starts_at >= now() - make_interval(days => v_rule.threshold_days))
          )
          when 'attended_class_type' then exists (
            select 1
            from public.class_bookings cb
            join public.class_sessions cs on cs.id = cb.class_session_id
            where cb.gym_id = p_gym_id
              and cb.profile_id = c.profile_id
              and cs.class_type_id = v_rule.class_type_id
              and cb.attended_at is not null
              and (v_rule.threshold_days is null
                   or cb.attended_at >= now() - make_interval(days => v_rule.threshold_days))
          )
          when 'no_recent_attendance' then not exists (
            select 1
            from public.class_bookings cb
            where cb.gym_id = p_gym_id
              and cb.profile_id = c.profile_id
              and cb.attended_at is not null
              and cb.attended_at >= now() - make_interval(days => v_rule.threshold_days)
          )
          when 'on_plan' then exists (
            select 1
            from public.plan_subscriptions ps
            where ps.gym_id = p_gym_id
              and ps.profile_id = c.profile_id
              and ps.plan_id = v_rule.plan_id
              and ps.status in ('active', 'cancelled_at_period_end', 'refunded_retained')
          )
          when 'cancelling' then exists (
            select 1
            from public.plan_subscriptions ps
            where ps.gym_id = p_gym_id
              and ps.profile_id = c.profile_id
              and ps.status = 'cancelled_at_period_end'
          )
          when 'joined_within' then
            c.joined_at >= now() - make_interval(days => v_rule.threshold_days)
          else false
        end
    ),
    pruned as (
      delete from public.member_tags mt
      where mt.rule_id = v_rule.id
        and mt.profile_id not in (select profile_id from matches)
    )
    insert into public.member_tags
      (gym_id, profile_id, label, color, source, rule_id, created_by, member_visible)
    select
      p_gym_id, m.profile_id, v_rule.label, v_rule.color, 'auto',
      v_rule.id, coalesce(p_actor, v_rule.created_by), v_rule.member_visible
    from matches m
    on conflict (gym_id, profile_id, label) do nothing;
  end loop;

  select count(*) into v_total
    from public.member_tags
    where gym_id = p_gym_id and source = 'auto';

  return v_total;
end;
$$;

commit;
