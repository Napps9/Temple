-- Two follow-ups from the AI front desk review:
--
-- 1. agent_outcomes: the agent was a black box after setup — activity was
--    visible (texts/threads/calls) but not RESULTS. This rolls up, for the
--    'AI front desk' lead source: leads captured (30d), leads currently
--    committed, leads converted to members (30d), and the attributed
--    monthly revenue (price snapshots of the converted members' current
--    recurring subscriptions). Owner-only; returns no row otherwise, the
--    same silent style as my_agreed_plan.
--
-- 2. agent_flag_health_mention: prospects volunteer injuries on sales
--    calls. Details must NOT land in leads.notes/transcript-adjacent
--    stores (special-category data outside the Article 9 surfaces), but
--    the coach needs to know to check in. The flag writes one fixed
--    marker line — deliberately no free text parameter, so the model
--    CANNOT record the medical details even if asked to — and pings the
--    assigned coach (owner fallback) through lead_notifications, deduped
--    per day.

begin;

create function public.agent_outcomes(p_gym_id uuid)
returns table (
  leads_30d                int,
  committed                int,
  converted_30d            int,
  attributed_monthly_cents bigint,
  currency                 text
)
language sql security definer set search_path = public
as $$
  with src as (
    select id from public.lead_sources
    where gym_id = p_gym_id and lower(label) = 'ai front desk'
      and archived_at is null
  )
  select
    (select count(*)::int from public.leads l
      where l.gym_id = p_gym_id and l.source_id in (select id from src)
        and l.captured_at > now() - interval '30 days'),
    (select count(*)::int from public.leads l
      where l.gym_id = p_gym_id and l.source_id in (select id from src)
        and l.status = 'committed'),
    (select count(*)::int from public.leads l
      where l.gym_id = p_gym_id and l.source_id in (select id from src)
        and l.converted_at > now() - interval '30 days'),
    (select coalesce(sum(coalesce(ps.price_cents, mp.monthly_price_cents, 0)), 0)::bigint
      from public.leads l
      join public.plan_subscriptions ps
        on ps.profile_id = l.converted_profile_id and ps.gym_id = p_gym_id
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where l.gym_id = p_gym_id and l.source_id in (select id from src)
        and l.converted_profile_id is not null
        and ps.status in
          ('active', 'pending', 'paused', 'cancelled_at_period_end', 'refunded_retained')
        and mp.kind <> 'credit_pack'),
    (select coalesce(g.currency, 'GBP') from public.gyms g where g.id = p_gym_id)
  where public.user_is_owner_of(p_gym_id);
$$;
grant execute on function public.agent_outcomes(uuid) to authenticated;

create function public.agent_flag_health_mention(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_gym    uuid;
  v_lead   uuid;
  v_coach  uuid;
  v_marker text := 'Mentioned an injury or health concern — have a coach check in before their first session (details deliberately not recorded).';
begin
  select gym_id, lead_id into v_gym, v_lead
    from public.agent_conversations where id = p_conversation_id;
  if v_lead is null then
    return;
  end if;

  update public.leads
    set notes = case
          when notes is null then v_marker
          when position(v_marker in notes) > 0 then notes
          else notes || E'\n— ' || v_marker
        end,
        updated_at = now()
    where id = v_lead;

  select assigned_coach_id into v_coach from public.leads where id = v_lead;
  if v_coach is null then
    select profile_id into v_coach
      from public.gym_memberships
      where gym_id = v_gym and role = 'owner' and left_at is null
      order by created_at
      limit 1;
  end if;
  if v_coach is not null then
    perform public.enqueue_lead_notifications(
      v_lead, v_coach, 'health-mention:' || to_char(now(), 'YYYY-MM-DD'));
  end if;
end;
$$;
revoke execute on function public.agent_flag_health_mention(uuid)
  from public, anon, authenticated;
grant execute on function public.agent_flag_health_mention(uuid)
  to service_role;

commit;
