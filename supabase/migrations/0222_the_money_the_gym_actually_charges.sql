-- The money the gym actually charges
--
-- Every price in Temple printed a pound sign. Not as a default that a
-- setting could change — as the three characters '£' typed into forty
-- places, from the plan editor to the setup script to the shop. A gym
-- billing in euros saw its own prices in sterling on every surface, while
-- the money summary and the refund card read the real currency off the
-- rows they described. The two disagreed, and the wrong one was the one
-- an owner used to set a price.
--
-- The client half of the fix is a formatter that takes the currency as a
-- required argument, so the compiler found the call sites rather than a
-- reviewer. This is the server half: the money job writes prose, and its
-- prose goes further than a screen — {offer_price} is substituted into
-- the email the member receives.

-- ---------------------------------------------------------------------------
-- 1. A price, as text, in the gym's money
-- ---------------------------------------------------------------------------
--
-- Postgres has no locale-aware currency formatter and this is not the
-- place to invent one. The symbol table is the same six currencies the
-- settings picker offers; anything else prints the ISO code after the
-- amount, which is unambiguous even where it is not pretty. Minor units
-- are dropped when there are none, matching what the app shows.

create or replace function public._money_amount(p_cents integer)
returns text
language sql
immutable
as $$
  select case
    when p_cents % 100 = 0 then (p_cents / 100)::text
    else to_char(p_cents::numeric / 100, 'FM999999990.00')
  end;
$$;

create or replace function public.money_text(
  p_cents    integer,
  p_currency text
) returns text
language sql
immutable
as $$
  select case
    when p_cents is null then ''
    else case upper(coalesce(p_currency, 'GBP'))
      when 'GBP' then '£'  || public._money_amount(p_cents)
      when 'USD' then '$'  || public._money_amount(p_cents)
      when 'EUR' then '€'  || public._money_amount(p_cents)
      when 'AUD' then 'A$' || public._money_amount(p_cents)
      when 'CAD' then 'C$' || public._money_amount(p_cents)
      when 'NZD' then 'NZ$'|| public._money_amount(p_cents)
      else public._money_amount(p_cents) || ' ' || upper(p_currency)
    end
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The money job says the price in the gym's money
-- ---------------------------------------------------------------------------
--
-- 0206's function, restated with one declaration, one lookup and two
-- formatted amounts changed. Everything else is exactly as it was.

create or replace function public.agent_revenue_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d          record;
  c          record;
  v_started  timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_proposed integer := 0;
  v_auto     integer := 0;
  v_closed   integer := 0;
  v_expired  integer := 0;
  v_level    text;
  v_action   uuid;
  v_case     uuid;
  v_touches  integer;
  v_kind     text;
  v_offer    record;
  v_payload  jsonb;
  v_evidence jsonb;
  v_member   record;
  v_plan     record;
  v_currency text;
begin
  -- Open a case for every live failure at a gym whose money job is on.
  for d in
    select dn.*, gm.left_at
      from public.plan_subscription_dunning dn
      join public.gym_memberships gm
        on gm.gym_id = dn.gym_id and gm.profile_id = dn.profile_id
      where exists (select 1 from public.agent_authority a
                     where a.gym_id = dn.gym_id)
        and gm.left_at is null
        and not exists (select 1 from public.agent_cases ac
                         where ac.plan_subscription_id = dn.plan_subscription_id
                           and ac.stage <> 'closed')
  loop
    insert into public.agent_cases (gym_id, plan_subscription_id, profile_id)
    values (d.gym_id, d.plan_subscription_id, d.profile_id)
    on conflict do nothing;
    v_opened := v_opened + 1;
  end loop;

  -- Work each open case against the policy.
  for c in
    select ac.*, dn.past_due_since, dn.payment_failure_count,
           dn.next_payment_attempt
      from public.agent_cases ac
      join public.plan_subscription_dunning dn
        on dn.plan_subscription_id = ac.plan_subscription_id
      where ac.stage <> 'closed'
  loop
    -- Hard cap: two agent touches per case, ever.
    select count(*) into v_touches
      from public.agent_actions
      where case_id = c.id and status in ('approved', 'executed');
    if v_touches >= 2 then continue; end if;

    -- One open question per case — and a "No" ends this case's asks for
    -- good. The owner said leave them alone; the system's own notices
    -- (0175) still run regardless.
    if exists (select 1 from public.agent_actions
                where case_id = c.id and status in ('proposed', 'rejected')) then
      continue;
    end if;

    v_kind := null;
    if c.next_payment_attempt is null then
      -- Stripe gave up: the judgement moment. Offer the cheaper plan if
      -- one exists; otherwise a final personal note.
      if not exists (select 1 from public.agent_actions
                      where case_id = c.id
                        and action_kind = 'plan_adjustment_offer'
                        and status in ('approved', 'executed')) then
        v_kind := 'plan_adjustment_offer';
      end if;
    elsif c.stage = 'watching'
      and c.past_due_since <= now() - interval '3 days'
      and c.next_payment_attempt > now() then
      v_kind := 'chase_message';
    end if;
    if v_kind is null then continue; end if;

    select p.full_name into v_member
      from public.profiles p where p.id = c.profile_id;
    select g.currency into v_currency
      from public.gyms g where g.id = c.gym_id;
    select mp.name, coalesce(ps.price_cents, mp.monthly_price_cents) as price_cents
      into v_plan
      from public.plan_subscriptions ps
      join public.membership_plans mp on mp.plan_id = ps.plan_id
      where ps.id = c.plan_subscription_id;

    v_payload := jsonb_build_object(
      'member_name', coalesce(v_member.full_name, 'A member'),
      'plan_name', coalesce(v_plan.name, 'membership')
    );

    if v_kind = 'plan_adjustment_offer' then
      -- Offers can only name an existing, active, cheaper recurring plan.
      select mp.plan_id, mp.name, mp.monthly_price_cents into v_offer
        from public.membership_plans mp
        where mp.gym_id = c.gym_id
          and mp.archived_at is null
          and mp.kind in ('unlimited', 'credit_period')
          and mp.monthly_price_cents is not null
          and mp.monthly_price_cents < coalesce(v_plan.price_cents, 0)
        order by mp.monthly_price_cents desc
        limit 1;
      if v_offer is null then
        -- No cheaper plan to offer — fall back to a final chase note.
        v_kind := 'chase_message';
      else
        v_payload := v_payload || jsonb_build_object(
          'offer_plan_id', v_offer.plan_id,
          'offer_plan_name', v_offer.name,
          'offer_price', public.money_text(v_offer.monthly_price_cents, v_currency),
          'final', true
        );
      end if;
    end if;

    v_evidence := jsonb_build_array(
      'Payment has failed ' || c.payment_failure_count || ' time'
        || case when c.payment_failure_count = 1 then '' else 's' end
        || ' since ' || to_char(c.past_due_since, 'DD Mon'),
      case when c.next_payment_attempt is null
        then 'Stripe has stopped retrying.'
        else 'Stripe will try again on '
          || to_char(c.next_payment_attempt, 'DD Mon') || '.' end,
      'On ' || coalesce(v_plan.name, 'their plan')
        || case when v_plan.price_cents is not null
           then ' at ' || public.money_text(v_plan.price_cents, v_currency)
                || ' a month.'
           else '.' end
    );

    select level into v_level
      from public.agent_authority
      where gym_id = c.gym_id and action_kind = v_kind;
    if v_level is null or v_level = 'reserved' then continue; end if;

    insert into public.agent_actions
      (gym_id, teammate, action_kind, subject_profile, subject_subscription,
       case_id, payload, evidence, status)
    values
      (c.gym_id, 'revenue', v_kind, c.profile_id, c.plan_subscription_id,
       c.id, v_payload, v_evidence, 'proposed')
    returning id into v_action;
    v_proposed := v_proposed + 1;

    if v_level = 'autonomous' then
      update public.agent_actions
        set status = 'approved', decided_at = now()
        where id = v_action;
      perform public._agent_execute_action(v_action);
      v_auto := v_auto + 1;
    end if;
  end loop;

  -- Close cases whose dunning row has gone: recovery deletes it (0176),
  -- leaving deletes it (leave_gym), lapse flips the subscription.
  for c in
    select ac.*, ps.status as sub_status, gm.left_at
      from public.agent_cases ac
      left join public.plan_subscription_dunning dn
        on dn.plan_subscription_id = ac.plan_subscription_id
      left join public.plan_subscriptions ps on ps.id = ac.plan_subscription_id
      left join public.gym_memberships gm
        on gm.gym_id = ac.gym_id and gm.profile_id = ac.profile_id
      where ac.stage <> 'closed' and dn.plan_subscription_id is null
  loop
    update public.agent_cases
      set stage = 'closed',
          closed_at = now(),
          outcome = case
            when c.left_at is not null then 'left'
            when c.sub_status = 'active' then 'recovered'
            when c.sub_status in ('cancelled') then 'left'
            else 'lapsed'
          end
      where id = c.id;
    update public.agent_actions
      set status = 'expired'
      where case_id = c.id and status = 'proposed';
    v_closed := v_closed + 1;
  end loop;

  -- Silence is not allowed to look like a decision.
  update public.agent_actions
    set status = 'expired'
    where status = 'proposed' and proposed_at < now() - interval '7 days';
  get diagnostics v_expired = row_count;

  perform public._log_cron_run('agent-revenue-tick',
    jsonb_build_object('opened', v_opened, 'proposed', v_proposed,
                       'auto', v_auto, 'closed', v_closed,
                       'expired', v_expired),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return jsonb_build_object('opened', v_opened, 'proposed', v_proposed,
                            'auto', v_auto, 'closed', v_closed);
end;
$$;
