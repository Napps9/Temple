-- Three corrections from an adversarial review of tonight's own work.
--
-- 1. THE STALL-RECOVERY GUARD WAS ONE PREDICATE TOO NARROW. 0187 added a
--    second pass over campaigns stuck in 'sending', to remove the class of
--    unrecoverable state 0186 could create. It only re-pokes campaigns that
--    still have a `status = 'queued'` recipient — so a campaign whose
--    recipients all drained but whose final status write did not land stays
--    'sending' forever. The due-loop filters 'scheduled', the recovery loop
--    misses it, comms_send_campaign rejects anything outside
--    draft/scheduled, and the report screen's only control is Refresh. Same
--    dead end, one predicate over.
--
--    A campaign with nothing left queued is not stuck mid-send, it is
--    finished — so finish it, rather than re-poking a worker that has
--    nothing to do.
--
-- 2. to_jsonb(void) IS THE EMPTY STRING. 0189 wraps eleven sweeps as
--    `_log_cron_run(name, to_jsonb(fn()))`, which is right for the nine
--    that return a count and useless for expire_cover_requests and
--    warn_uncovered_cover, which return void and therefore log `""`. The
--    log exists to make these observable; two of them were logging
--    nothing legible. The wrapper is not the problem — returning void is,
--    for a sweep whose whole point is how much it swept — so the two
--    functions now return a count like the other nine.
--
-- 3. THE CREDIT COPY REPLACED ONE FALSE STATEMENT WITH ANOTHER. 0176 set
--    out to stop telling credit members their classes were unaffected, and
--    told every non-unlimited member they cannot book. That is also untrue:
--    a failed renewal means the next batch of credits has not ARRIVED, not
--    that the balance is zero, so a member with credits left can still
--    book. And programming_only members do not book classes at all, so
--    neither sentence applies to them.

begin;

-- ============================================================================
-- 1. Finish a campaign that has nothing left to send
-- ============================================================================

create or replace function public.dispatch_scheduled_campaigns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      record;
  v_sent     integer := 0;
  v_due      integer := 0;
  v_repoked  integer := 0;
  v_finished integer := 0;
  v_started  timestamptz := clock_timestamp();
  v_key      text := public._worker_service_key();
begin
  if v_key is null then
    perform public._log_cron_run('dispatch-scheduled-campaigns',
      jsonb_build_object('skipped', 'no worker_service_key in vault'));
    return 0;
  end if;

  for v_row in
    select id from public.email_campaigns
    where status = 'scheduled' and scheduled_for is not null
      and scheduled_for <= now()
    order by scheduled_for
  loop
    v_due := v_due + 1;
    if public._send_due_campaign(v_row.id) > 0 then
      v_sent := v_sent + 1;
      begin
        perform net.http_post(
          url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-campaign',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
          ),
          body := jsonb_build_object('campaign_id', v_row.id)
        );
      exception when others then
        null;
      end;
    end if;
  end loop;

  -- Stuck with work left: poke the worker again.
  for v_row in
    select c.id from public.email_campaigns c
    where c.status = 'sending'
      and c.updated_at < now() - interval '10 minutes'
      and exists (
        select 1 from public.email_campaign_recipients r
        where r.campaign_id = c.id and r.status = 'queued'
      )
    order by c.updated_at
    limit 20
  loop
    v_repoked := v_repoked + 1;
    begin
      perform net.http_post(
        url := 'https://ujkovhbfniaodkmvfqxo.supabase.co/functions/v1/send-campaign',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('campaign_id', v_row.id)
      );
    exception when others then
      null;
    end;
  end loop;

  -- Stuck with NO work left: the worker drained every recipient and the
  -- closing status write did not land. Nothing else would ever look at
  -- these again, and re-poking would be pointless — there is nothing
  -- queued for the worker to pick up. Close them out as the worker would
  -- have: 'sent' if anything actually went, 'failed' if nothing did.
  update public.email_campaigns c
    set status = case
          when exists (
            select 1 from public.email_campaign_recipients r
            where r.campaign_id = c.id
              and r.status in ('sent', 'delivered', 'simulated')
          ) then 'sent' else 'failed' end,
        sent_at = coalesce(c.sent_at, now()),
        updated_at = now()
    where c.status = 'sending'
      and c.updated_at < now() - interval '10 minutes'
      and not exists (
        select 1 from public.email_campaign_recipients r
        where r.campaign_id = c.id and r.status = 'queued'
      );
  get diagnostics v_finished = row_count;

  perform public._log_cron_run('dispatch-scheduled-campaigns',
    jsonb_build_object('due', v_due, 'dispatched', v_sent,
                       'repoked', v_repoked, 'finished', v_finished),
    (extract(epoch from clock_timestamp() - v_started) * 1000)::integer);

  return v_sent;
end;
$$;

revoke execute on function public.dispatch_scheduled_campaigns()
  from public, anon, authenticated;

-- ============================================================================
-- 2. The two void sweeps report a count like the other nine
-- ============================================================================

-- Returning void is the actual defect, not the wrapper: fix it at the
-- source and `to_jsonb(fn())` keeps working unchanged for all eleven.
-- Nothing calls either one for its value — pg_cron and two pgTAP
-- `perform`s — so widening the return breaks no caller.
--
-- The RETURNS shape is changing, so these have to be dropped rather than
-- replaced (0043).

drop function if exists public.expire_cover_requests();

create function public.expire_cover_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer;
begin
  delete from public.cover_request_sessions crs
  using public.class_sessions cs
  where cs.id = crs.class_session_id
    and crs.claimed_by is null
    and cs.starts_at <= now();

  update public.cover_requests cr
    set status = 'expired'
    from public.gyms g
    where g.id = cr.gym_id
      and cr.status in ('open', 'partial')
      and case
        when cr.requested_end is not null
          then cr.requested_end < (now() at time zone g.timezone)::date
        else not exists (
          select 1
          from public.cover_request_sessions crs
          join public.class_sessions cs on cs.id = crs.class_session_id
          where crs.request_id = cr.id and cs.starts_at > now()
        )
      end;

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

revoke execute on function public.expire_cover_requests()
  from public, anon, authenticated;

drop function if exists public.warn_uncovered_cover();

create function public.warn_uncovered_cover()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent integer;
begin
  with at_risk as (
    select distinct cr.id as request_id, cr.gym_id, cr.requested_by
    from public.cover_requests cr
    join public.gyms g on g.id = cr.gym_id
    join public.cover_request_sessions crs on crs.request_id = cr.id
    join public.class_sessions cs on cs.id = crs.class_session_id
    where cr.status in ('open', 'partial')
      and g.cover_warning_hours > 0
      and crs.claimed_by is null
      and cs.starts_at > now()
      and cs.starts_at <= now() + make_interval(hours => g.cover_warning_hours)
  ),
  recipient as (
    select distinct r.request_id, r.gym_id, p.profile_id
    from at_risk r
    cross join lateral (
      select r.requested_by as profile_id
      union
      select m.profile_id
      from public.gym_memberships m
      where m.gym_id = r.gym_id
        and m.role in ('owner', 'admin')
        and m.left_at is null
    ) p
  )
  insert into public.cover_notifications
    (gym_id, request_id, kind, channel, recipient, recipient_profile_id,
     status, sent_at, error, idempotency_key)
  select
    rc.gym_id, rc.request_id, 'cover_uncovered', c.channel,
    case when c.channel = 'in_app' then rc.profile_id::text else u.email end,
    rc.profile_id,
    case
      when c.channel = 'in_app' then 'sent'
      when u.email is null then 'skipped'
      when public._email_blanket_unsubscribed(rc.gym_id, u.email) then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case
      when c.channel = 'email' and u.email is null
        then 'Coach has no email address'
      when c.channel = 'email'
        and public._email_blanket_unsubscribed(rc.gym_id, u.email)
        then 'Coach has unsubscribed from all email from this gym'
    end,
    c.channel || ':uncovered:' || rc.request_id || ':' || rc.profile_id || ':'
      || (now() at time zone g.timezone)::date
  from recipient rc
  join public.gyms g on g.id = rc.gym_id
  left join auth.users u on u.id = rc.profile_id
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_sent = row_count;
  return v_sent;
end;
$$;

revoke execute on function public.warn_uncovered_cover()
  from public, anon, authenticated;

-- Re-registered because the dropped function is a different one; the
-- command text is 0189's unchanged.
select cron.schedule('expire-cover-requests', '0 4 * * *',
  $$select public._log_cron_run('expire-cover-requests',
      to_jsonb(public.expire_cover_requests()));$$);

select cron.schedule('warn-uncovered-cover', '30 3 * * *',
  $$select public._log_cron_run('warn-uncovered-cover',
      to_jsonb(public.warn_uncovered_cover()));$$);

-- ============================================================================
-- 3. Say the true thing to each plan kind
-- ============================================================================

create or replace function public._enqueue_payment_notice(
  p_subscription_id uuid,
  p_kind            text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps         public.plan_subscriptions;
  v_dun        public.plan_subscription_dunning;
  v_kind       text;
  v_gym        text;
  v_tz         text;
  v_email      text;
  v_body       text;
  v_body_email text;
  v_key        text;
  v_count      integer;
begin
  select * into v_ps from public.plan_subscriptions where id = p_subscription_id;
  if v_ps.id is null then
    return 0;
  end if;

  select * into v_dun from public.plan_subscription_dunning
    where plan_subscription_id = p_subscription_id;
  if v_dun.plan_subscription_id is null then
    return 0;
  end if;

  select mp.kind into v_kind
    from public.membership_plans mp where mp.plan_id = v_ps.plan_id;

  select g.name,
         case when exists (select 1 from pg_timezone_names t
                           where t.name = g.timezone)
              then g.timezone else 'UTC' end
    into v_gym, v_tz
    from public.gyms g where g.id = v_ps.gym_id;
  select u.email into v_email from auth.users u where u.id = v_ps.profile_id;

  v_key := p_kind || ':' || p_subscription_id || ':'
           || extract(epoch from v_dun.past_due_since)::bigint;

  if p_kind = 'payment_final_notice' then
    v_body := 'We could not take your membership payment for '
      || coalesce(v_gym, 'your gym')
      || ', and we have stopped trying. Your membership will be cancelled '
      || 'unless it is paid.';
    v_body_email := v_body;
  else
    v_body := 'We could not take your membership payment for '
      || coalesce(v_gym, 'your gym') || '. '
      -- Three cases. An unlimited member keeps booking. A credit member
      -- keeps the credits they already have — the failure means the next
      -- batch has not arrived, not that the balance is zero — so telling
      -- them they cannot book is as untrue as the sentence this replaced.
      -- A programming-only member does not book classes at all.
      || case
           when v_kind = 'unlimited' then
             'Your classes are not affected — you can keep booking — and we '
             || 'will try again'
           when v_kind = 'programming_only' then
             'Your programming is not affected, and we will try again'
           else
             'Any class credits you have left still work, but this month''s '
             || 'have not been added yet — they will not top up until this '
             || 'is paid. We will try again'
         end;
    v_body_email := v_body
      || case when v_dun.next_payment_attempt is null then ''
              else ' on ' || to_char(
                v_dun.next_payment_attempt at time zone v_tz, 'FMDD Mon') end
      || '. Paying now saves the wait.';
    v_body := v_body || ' soon. Paying now saves the wait.';
  end if;

  insert into public.payment_notifications
    (gym_id, plan_subscription_id, recipient_profile_id, kind, channel,
     recipient, body, status, sent_at, error, idempotency_key)
  select
    v_ps.gym_id, v_ps.id, v_ps.profile_id, p_kind, c.channel,
    case when c.channel = 'in_app' then v_ps.profile_id::text end,
    case when c.channel = 'in_app' then v_body else v_body_email end,
    case
      when c.channel = 'in_app' then 'sent'
      when v_email is null then 'skipped'
      else 'queued'
    end,
    case when c.channel = 'in_app' then now() end,
    case when c.channel = 'email' and v_email is null
         then 'Member has no email address' end,
    c.channel || ':' || v_key
  from (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0) / 2;
end;
$$;

revoke execute on function public._enqueue_payment_notice(uuid, text)
  from public, anon, authenticated;

commit;
