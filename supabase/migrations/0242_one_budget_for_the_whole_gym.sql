-- 0242: One budget for the whole gym
--
-- Six jobs ship, and every one of them caps itself at three proposals a
-- gym a day. Nobody ever set the total. With all six taken on that is
-- eighteen questions waiting when an owner opens the Timeline, which is
-- a to-do list with a new name — the thing the Timeline was built to
-- replace. And an owner who meets eighteen turns jobs off, losing the
-- good ones along with the noisy ones.
--
-- One number across the four jobs that can wait: five a day. The per-job
-- cap of three stays, and the two together give the property that
-- matters — no single job can take more than three of the five, so
-- whichever tick runs first can never starve the rest.
--
-- WHICH JOBS SHARE IT, AND WHY THE OTHERS DO NOT.
--
--   Capped:  retention_message, first_week_message, credits_low_message,
--            plan_upgrade_offer. Every one of these is the gym NOTICING
--            something. A day later is the same message.
--   Exempt:  chase_message and plan_adjustment_offer — money already
--            missed, with Stripe's own retry clock running; a day costs
--            real money and the money loop has its own cadence.
--   Exempt:  cover_ask — a class tomorrow with no coach. A day later is
--            not the same message, it is a cancelled class.
--
-- The budget is deliberately a constant rather than a per-gym setting.
-- Making it a setting means a screen, a rule-sheet line and a decision
-- an owner has no way to make well before they have lived with it. If a
-- gym turns out to want a different number, that is a number in one
-- function.
--
-- The four ticks below are their live definitions with one check added
-- to each, extracted and patched rather than restated: these are the
-- only paths by which four of the six jobs propose anything, and a
-- branch lost here is a job that silently goes quiet.

begin;

create or replace function public._agent_ask_budget_left(p_gym_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 5 - (
    select count(*)::int
      from public.agent_actions
     where gym_id = p_gym_id
       and action_kind in ('retention_message', 'first_week_message',
                           'credits_low_message', 'plan_upgrade_offer')
       and proposed_at > now() - interval '1 day'
  ));
$$;

revoke all on function public._agent_ask_budget_left(uuid)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_retention_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_level    text;
  v_action   uuid;
  v_weeks    integer;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name,
           max(cb.attended_at) as last_seen,
           a.level
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      join public.class_bookings cb
        on cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
       and cb.attended_at is not null
      where a.action_kind = 'retention_message' and a.level <> 'reserved'
        and exists (select 1 from public.plan_subscriptions ps
                     where ps.gym_id = gm.gym_id
                       and ps.profile_id = gm.profile_id
                       and ps.status = 'active')
        -- Never the same member twice inside 45 days, and a "No" blocks
        -- the window too.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'retention_message'
                           and aa.proposed_at > now() - interval '45 days')
      group by gm.gym_id, gm.profile_id, p.full_name, a.level
      having max(cb.attended_at) between now() - interval '90 days'
                                     and now() - interval '21 days'
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      continue;
    end if;

    -- At most three proposals per gym per day: quiet by design.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'retention_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_weeks := greatest(1, floor(extract(epoch from now() - m.last_seen)
      / 604800)::integer);

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'retention', 'retention_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'weeks_absent', v_weeks
       ),
       jsonb_build_array(
         'Last trained on ' || to_char(m.last_seen, 'DD Mon') || ' — '
           || v_weeks || ' week' || case when v_weeks = 1 then '' else 's' end
           || ' ago.',
         'Still on an active membership.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    v_level := m.level;
    if v_level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-retention-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_first_week_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_action   uuid;
  v_days     integer;
  v_booked   integer;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name, gm.created_at as joined_at,
           a.level
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      where a.action_kind = 'first_week_message' and a.level <> 'reserved'
        and gm.created_at
              between now() - interval '30 days' and now() - interval '7 days'
        and exists (select 1 from public.plan_subscriptions ps
                     where ps.gym_id = gm.gym_id
                       and ps.profile_id = gm.profile_id
                       and ps.status = 'active')
        -- Rule 1. A migration is not a new joiner.
        and not exists (select 1 from public.pending_members pm
                         where pm.gym_id = gm.gym_id
                           and pm.linked_profile_id = gm.profile_id)
        -- Has never trained. Booking and not turning up still counts as
        -- never started — the evidence below says which it was.
        and not exists (select 1 from public.class_bookings cb
                         where cb.gym_id = gm.gym_id
                           and cb.profile_id = gm.profile_id
                           and cb.attended_at is not null)
        -- Rule 2. Once, ever — so a "no" is final for that member.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'first_week_message')
      order by gm.created_at
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      continue;
    end if;

    -- Rule 4.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'first_week_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_days := greatest(1, floor(extract(epoch from now() - m.joined_at)
      / 86400)::integer);

    -- Booked and not come is a different thing from never booked, and the
    -- owner decides differently on each, so the card says which.
    select count(*)::int into v_booked
      from public.class_bookings cb
      where cb.gym_id = m.gym_id and cb.profile_id = m.profile_id;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'retention', 'first_week_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'days_since_join', v_days
       ),
       jsonb_build_array(
         'Joined on ' || to_char(m.joined_at, 'DD Mon') || ' — '
           || v_days || ' day' || case when v_days = 1 then '' else 's' end
           || ' ago.',
         case when v_booked = 0
              then 'Has not booked anything yet.'
              else 'Booked ' || v_booked || ' class'
                   || case when v_booked = 1 then '' else 'es' end
                   || ' and has not been to one.'
         end,
         'Paying for an active membership.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if m.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-first-week-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_credits_low_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m          record;
  v_started  timestamptz := clock_timestamp();
  v_action   uuid;
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_phrase   text;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name, a.level,
           ps.id as subscription_id, ps.credit_balance, mp.name as plan_name,
           (select max(cb.attended_at) from public.class_bookings cb
             where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
               and cb.attended_at is not null) as last_seen
      from public.agent_authority a
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      join public.plan_subscriptions ps
        on ps.gym_id = gm.gym_id and ps.profile_id = gm.profile_id
       and ps.status = 'active'
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where a.action_kind = 'credits_low_message' and a.level <> 'reserved'
        -- Rule 1. A credit_period balance resets; only a pack runs out.
        and mp.kind = 'credit_pack'
        -- Rule 2. One or two left. Zero is already locked out.
        and ps.credit_balance between 1 and 2
        -- Rule 4. Once per subscription per 60 days.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.action_kind = 'credits_low_message'
                           and aa.payload->>'subscription_id' = ps.id::text
                           and aa.proposed_at > now() - interval '60 days')
        -- Rule 6 (0241). The upgrade offer already carries this message.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'plan_upgrade_offer'
                           and aa.status <> 'rejected'
                           and aa.proposed_at > now() - interval '7 days')
      -- Rule 3. Trained inside 21 days, which is retention's threshold in
      -- the other direction, so no member can be held by both jobs.
      group by gm.gym_id, gm.profile_id, p.full_name, a.level, ps.id,
               ps.credit_balance, mp.name
      having (select max(cb.attended_at) from public.class_bookings cb
               where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
                 and cb.attended_at is not null) > now() - interval '21 days'
      order by ps.credit_balance, gm.profile_id
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      continue;
    end if;

    -- Rule 5.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'credits_low_message'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_phrase := m.credit_balance || ' class'
      || case when m.credit_balance = 1 then '' else 'es' end;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'revenue', 'credits_low_message', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'plan_name', m.plan_name,
         'credits_left', m.credit_balance,
         'credits_left_phrase', v_phrase,
         'subscription_id', m.subscription_id::text
       ),
       jsonb_build_array(
         v_phrase || ' left on their ' || m.plan_name || '.',
         'Last trained on ' || to_char(m.last_seen, 'DD Mon') || '.',
         'Still booking, so this is a top-up rather than a goodbye.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if m.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-credits-low-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_plan_upgrade_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m           record;
  v_offer     record;
  v_started   timestamptz := clock_timestamp();
  v_action    uuid;
  v_proposed  integer := 0;
  v_auto      integer := 0;
  v_per_class integer;
  v_at_rate   integer;
  v_saving    integer;
  v_phrase    text;
begin
  for m in
    select gm.gym_id, gm.profile_id, p.full_name, a.level, g.currency,
           ps.id as subscription_id, ps.credit_balance, ps.price_cents,
           mp.name as plan_name, mp.credit_count,
           (select count(*) from public.class_bookings cb
             where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
               and cb.attended_at > now() - interval '30 days')::int
             as attended_30d
      from public.agent_authority a
      join public.gyms g on g.id = a.gym_id
      join public.gym_memberships gm
        on gm.gym_id = a.gym_id and gm.role = 'member' and gm.left_at is null
      join public.profiles p on p.id = gm.profile_id
      join public.plan_subscriptions ps
        on ps.gym_id = gm.gym_id and ps.profile_id = gm.profile_id
       and ps.status = 'active'
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where a.action_kind = 'plan_upgrade_offer' and a.level <> 'reserved'
        -- Rule 1, shared with credits_low: a pack, down to one or two.
        and mp.kind = 'credit_pack'
        and ps.credit_balance between 1 and 2
        -- Rule 2 needs both of these to divide by, and a free or comped
        -- pack has no per-class price to beat.
        and coalesce(mp.credit_count, 0) > 0
        and coalesce(ps.price_cents, 0) > 0
        -- Rule 5. Once per member per 180 days.
        and not exists (select 1 from public.agent_actions aa
                         where aa.gym_id = gm.gym_id
                           and aa.subject_profile = gm.profile_id
                           and aa.action_kind = 'plan_upgrade_offer'
                           and aa.proposed_at > now() - interval '180 days')
        -- Rule 1 again: trained inside 21 days, retention's threshold in
        -- the other direction, so no member is held by both jobs.
        and exists (select 1 from public.class_bookings cb
                     where cb.gym_id = gm.gym_id and cb.profile_id = gm.profile_id
                       and cb.attended_at > now() - interval '21 days')
      order by gm.profile_id
  loop
    -- 0242. The gym's whole daily ask budget, shared with the other
    -- three jobs that can wait a day. `continue`, not `exit`: this loop
    -- walks every gym that has taken the job on, and one gym being out
    -- of budget says nothing about the next.
    if public._agent_ask_budget_left(m.gym_id) <= 0 then
      continue;
    end if;

    -- Rule 6.
    if (select count(*) from public.agent_actions
         where gym_id = m.gym_id and action_kind = 'plan_upgrade_offer'
           and proposed_at > now() - interval '1 day') >= 3 then
      continue;
    end if;

    v_per_class := m.price_cents / m.credit_count;
    v_at_rate   := m.attended_30d * v_per_class;

    -- Rule 3. Cheapest live recurring plan that actually covers the way
    -- they train. An unlimited plan always does; a credit_period one only
    -- when its allowance reaches what they did last month.
    select mp2.plan_id, mp2.name, mp2.monthly_price_cents
      into v_offer
      from public.membership_plans mp2
      where mp2.gym_id = m.gym_id
        and mp2.archived_at is null
        and mp2.kind in ('unlimited', 'credit_period')
        and coalesce(mp2.monthly_price_cents, 0) > 0
        and (mp2.kind = 'unlimited'
             or coalesce(mp2.credit_count, 0) >= m.attended_30d)
      order by mp2.monthly_price_cents asc, mp2.name asc
      limit 1;
    if v_offer.plan_id is null then
      continue;
    end if;

    -- Rules 2 and 4.
    v_saving := v_at_rate - v_offer.monthly_price_cents;
    if v_saving < greatest(v_at_rate / 5, v_per_class) then
      continue;
    end if;

    v_phrase := m.credit_balance || ' class'
      || case when m.credit_balance = 1 then '' else 'es' end;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, payload, evidence,
       status)
    values
      (m.gym_id, 'revenue', 'plan_upgrade_offer', m.profile_id,
       jsonb_build_object(
         'member_name', coalesce(m.full_name, 'A member'),
         'plan_name', m.plan_name,
         'credits_left', m.credit_balance,
         'credits_left_phrase', v_phrase,
         'attended_30d', m.attended_30d,
         'offer_plan_name', v_offer.name,
         'offer_price', public.money_text(v_offer.monthly_price_cents, m.currency),
         'upgrade_saving', public.money_text(v_saving, m.currency),
         'subscription_id', m.subscription_id::text
       ),
       jsonb_build_array(
         'Trained ' || m.attended_30d || ' time'
           || case when m.attended_30d = 1 then '' else 's' end
           || ' in the last 30 days, with ' || v_phrase || ' left.',
         'At ' || public.money_text(v_per_class, m.currency)
           || ' a class on their ' || m.plan_name || ', another month at '
           || 'that rate is ' || public.money_text(v_at_rate, m.currency) || '.',
         v_offer.name || ' is '
           || public.money_text(v_offer.monthly_price_cents, m.currency)
           || ' — ' || public.money_text(v_saving, m.currency) || ' better off.'
       ),
       'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if m.level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  perform public._log_cron_run('agent-plan-upgrade-tick',
    jsonb_build_object('proposed', v_proposed, 'auto', v_auto),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('proposed', v_proposed, 'auto', v_auto);
end;
$function$;

commit;
