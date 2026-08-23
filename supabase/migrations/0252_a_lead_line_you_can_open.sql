-- 0252: A lead line you can open
--
-- lead_captured events rendered as unclickable text: the feed carried
-- the lead's id but the conversation route keys on agent_conversations,
-- so storyHref had nothing to build. An owner who saw "Dan got in touch"
-- on their home screen then needed five taps through Manage to reach the
-- thread the line was about. The feed now carries the lead's latest
-- conversation id in the event detail, and the line links straight to it.
--
-- Same RETURNS shape and arity as 0244, so CREATE OR REPLACE is safe;
-- only the lead branch's jsonb payload gains a key.

begin;

CREATE OR REPLACE FUNCTION public.timeline_feed(p_gym_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(item_id text, kind text, occurred_at timestamp with time zone, subject text, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before timestamptz := coalesce(p_before, now() + interval '1 day');
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_money  boolean;
  v_leads  boolean;
  v_plans  boolean;
  v_cover  boolean;
  v_comms  boolean;
begin
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    raise exception 'Not allowed';
  end if;
  v_money := public.effective_can(p_gym_id, 'can_see_money');
  v_leads := public.effective_can(p_gym_id, 'can_work_leads');
  v_plans := public.effective_can(p_gym_id, 'can_assign_plan');
  v_cover := public.effective_can(p_gym_id, 'can_claim_cover');
  v_comms := public.effective_can(p_gym_id, 'can_manage_comms');

  return query
  select * from (

    -- Someone joined.
    select 'member:' || gm.id::text        as item_id,
           'member_joined'                 as kind,
           gm.created_at                   as occurred_at,
           coalesce(p.full_name, 'A new member') as subject,
           '{}'::jsonb                     as detail
      from public.gym_memberships gm
      join public.profiles p on p.id = gm.profile_id
     where gm.gym_id = p_gym_id
       and gm.role = 'member'
       and gm.left_at is null
       and gm.created_at < v_before

    union all

    -- An enquiry came in.
    select 'lead:' || l.id::text,
           'lead_captured',
           l.captured_at,
           l.full_name,
           jsonb_build_object(
             'source', ls.label,
             'status', l.status::text,
             'conversation_id',
             (select c.id
                from public.agent_conversations c
               where c.lead_id = l.id
               order by c.created_at desc
               limit 1)
           )
      from public.leads l
      left join public.lead_sources ls on ls.id = l.source_id
     where v_leads
       and l.gym_id = p_gym_id
       and l.archived_at is null
       and l.captured_at < v_before

    union all

    -- A payment is failing. Presence of a dunning row IS the live failure
    -- (recovery deletes it — 0176), so this line disappears when the money
    -- arrives, the same way the Money block's At-risk figure does. The
    -- decline reason stays off the feed on purpose.
    select 'dunning:' || d.plan_subscription_id::text,
           'payment_failing',
           d.past_due_since,
           coalesce(p.full_name, 'A member'),
           jsonb_build_object(
             'plan_name', mp.name,
             'next_payment_attempt', d.next_payment_attempt,
             'failure_count', d.payment_failure_count
           )
      from public.plan_subscription_dunning d
      join public.profiles p on p.id = d.profile_id
      join public.plan_subscriptions ps on ps.id = d.plan_subscription_id
      join public.membership_plans mp on mp.plan_id = ps.plan_id
     where v_money
       and d.gym_id = p_gym_id
       and d.past_due_since < v_before

    union all

    -- 0244. The day the gym had more worth saying than it was allowed to
    -- say. One line, not a list: the point is that an owner can tell a
    -- quiet day from a full one, not that they can audit the queue.
    select 'held:' || h.gym_id::text || ':' || h.on_day::text,
           'held_back',
           h.first_at,
           '',
           jsonb_build_object('held', h.held)
      from public.agent_deferrals h
     where v_money
       and h.gym_id = p_gym_id
       and h.first_at < v_before

    union all

    -- A coach asked for cover.
    select 'coverreq:' || cr.id::text,
           'cover_requested',
           cr.created_at,
           coalesce(p.full_name, 'A coach'),
           jsonb_build_object(
             'status', cr.status,
             'class_count', (
               select count(*) from public.cover_request_sessions s
                where s.request_id = cr.id
             ),
             'range_start', cr.range_start,
             'range_end', cr.range_end,
             -- 0243. Who asked, so the card can leave the claim buttons
             -- off your own request rather than offering you a class
             -- claim_cover would refuse.
             'requested_by', cr.requested_by,
             -- The offers still open, so the Timeline card has something
             -- to claim. Unclaimed and not yet run: a claimed one is
             -- somebody else's now, and one that already happened is a
             -- button that can only fail.
             'open_sessions', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'offer_id', s.id,
                        'name', coalesce(nullif(btrim(cs.name), ''), 'A class'),
                        'starts_at', cs.starts_at
                      ) order by cs.starts_at)
                 from public.cover_request_sessions s
                 join public.class_sessions cs on cs.id = s.class_session_id
                where s.request_id = cr.id
                  and s.claimed_by is null
                  and cs.starts_at > now()
             ), '[]'::jsonb)
           )
      from public.cover_requests cr
      join public.profiles p on p.id = cr.requested_by
     where v_cover
       and cr.gym_id = p_gym_id
       and cr.created_at < v_before

    union all

    -- A class got covered.
    select 'coverclaim:' || s.id::text,
           'cover_claimed',
           s.claimed_at,
           coalesce(claimer.full_name, 'A coach'),
           jsonb_build_object(
             'covered_for', original.full_name
           )
      from public.cover_request_sessions s
      join public.profiles claimer on claimer.id = s.claimed_by
      left join public.profiles original on original.id = s.original_coach_id
     where v_cover
       and s.gym_id = p_gym_id
       and s.claimed_by is not null
       and s.claimed_at < v_before

    union all

    -- The gym closed a window of dates.
    select 'closure:' || c.id::text,
           'gym_closed',
           c.created_at,
           coalesce(c.reason, ''),
           jsonb_build_object(
             'starts_on', c.starts_on,
             'ends_on', c.ends_on,
             'lifted', c.lifted_at is not null
           )
      from public.gym_closures c
     where c.gym_id = p_gym_id
       and c.created_at < v_before

    union all

    -- A member is asking to change or cancel — the stream's only
    -- question cards in phase 1, decided through the existing
    -- stripe-modify-subscription path, not a new one.
    select 'mcr:' || r.id::text,
           'membership_request',
           r.created_at,
           coalesce(p.full_name, 'A member'),
           jsonb_build_object(
             'request_id', r.id,
             'request_kind', r.kind::text,
             'current_plan', cur.name,
             'target_plan', tgt.name,
             'member_note', r.member_note
           )
      from public.membership_change_requests r
      join public.profiles p on p.id = r.profile_id
      left join public.plan_subscriptions ps on ps.id = r.plan_subscription_id
      left join public.membership_plans cur on cur.plan_id = ps.plan_id
      left join public.membership_plans tgt on tgt.plan_id = r.target_plan_id
     where v_plans
       and r.gym_id = p_gym_id
       and r.status = 'pending'
       and r.created_at < v_before

    union all

    -- A send finished, and what came of it. Counted at read time, not at
    -- send time: bounces arrive after the last email goes out.
    select 'campaign:' || ec.id::text,
           'campaign_sent',
           coalesce(ec.sent_at, ec.updated_at),
           coalesce(nullif(ec.title, ''), ec.subject, 'A campaign'),
           jsonb_build_object(
             'campaign_id', ec.id,
             'subject', ec.subject,
             'status', ec.status,
             'tracked', ec.delivery_tracked,
             'recipients', st.recipients,
             'sent', st.sent,
             'delivered', st.delivered,
             'successful', st.successful,
             'simulated', st.simulated,
             'bounced', st.bounced,
             'complained', st.complained,
             'opened', st.opened,
             'skipped', st.skipped
           )
      from (
        -- The outer query takes at most v_limit rows in total, so a
        -- campaign further back than the v_limit most recent ones cannot
        -- reach the page even if every row on it were a campaign. Cutting
        -- here rather than after the aggregate is the difference between
        -- counting every send the gym has ever made and counting fifty:
        -- at five hundred campaigns and four hundred thousand recipient
        -- rows that was 381ms on the staff home screen, and it grew for
        -- ever because campaigns are never deleted.
        select c.id, c.gym_id, c.subject, c.status, c.title,
               c.delivery_tracked, c.sent_at, c.updated_at
          from public.email_campaigns c
         where v_comms
           and c.gym_id = p_gym_id
           and c.status in ('sent', 'failed', 'cancelled')
           and coalesce(c.sent_at, c.updated_at) < v_before
         order by coalesce(c.sent_at, c.updated_at) desc
         limit v_limit
      ) ec
      cross join lateral (
        select
          count(*)::int as recipients,
          count(*) filter (where r.status in ('sent','delivered','bounced','simulated'))::int as sent,
          count(*) filter (where r.delivered_at is not null)::int as delivered,
          count(*) filter (where r.delivered_at is not null and r.status <> 'bounced')::int as successful,
          count(*) filter (where r.status = 'simulated')::int as simulated,
          count(*) filter (where r.status = 'bounced')::int as bounced,
          count(*) filter (where r.complained_at is not null)::int as complained,
          count(*) filter (where r.first_opened_at is not null)::int as opened,
          count(*) filter (where r.status = 'skipped')::int as skipped
        from public.email_campaign_recipients r
        where r.campaign_id = ec.id
      ) st

    union all

    -- The ledger itself. Empty until the first loop writes to it; unioned
    -- now so the surface needs no change when it does.
    select 'action:' || a.id::text,
           'agent_action',
           a.proposed_at,
           coalesce(p.full_name, ''),
           jsonb_build_object(
             'teammate', a.teammate,
             'action_kind', a.action_kind,
             'status', a.status,
             'payload', a.payload,
             'evidence', a.evidence
           )
      from public.agent_actions a
      left join public.profiles p on p.id = a.subject_profile
     where v_money
       and a.gym_id = p_gym_id
       and a.proposed_at < v_before

  ) t
  order by t.occurred_at desc
  limit v_limit;
end;
$function$;

commit;
