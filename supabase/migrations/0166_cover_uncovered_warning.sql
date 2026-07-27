-- Warn when a class is about to run with nobody covering it.
--
-- 0165 closed both ends of the cover loop — coaches learn there is cover
-- to claim, the requester learns when a class is picked up. Neither
-- covers the failure case, which is the one that actually hurts: a
-- request nobody answers. Today it just sits there and the class runs
-- unstaffed, or doesn't.
--
-- A nightly sweep warns the requester (their holiday is at risk) and the
-- gym's owners and admins (a class on their timetable is about to have
-- no coach) about offers still unclaimed with the class close at hand.
--
-- Digest per REQUEST per recipient per gym-local DAY, for the same
-- reason 0165 digests per request: a fortnight's cover going unanswered
-- must not mean twenty warnings. Including the local date in the
-- idempotency key means the warning REPEATS daily while the problem
-- persists — deliberate, unlike the one-shot 0165 events. An escalating
-- operational problem should keep asking.
--
-- The other coaches are not re-pinged. They already had the request
-- digest; nagging the whole gym nightly is how a sender gets filtered.
--
-- Sections:
--   1. 'cover_uncovered' joins the kind vocabulary
--   2. warn_uncovered_cover() + pg_cron
--
-- The 48-hour lead time is a constant, not a per-gym dial. It can become
-- one if a gym asks; inventing the column, the RPC arity change and the
-- settings UI before anyone has wanted it is not worth it.

begin;

-- ============================================================================
-- 1. Kind vocabulary
-- ============================================================================

alter table public.cover_notifications
  drop constraint cover_notifications_kind_check;

alter table public.cover_notifications
  add constraint cover_notifications_kind_check
  check (kind in ('cover_requested', 'cover_claimed', 'cover_uncovered'));

-- ============================================================================
-- 2. warn_uncovered_cover
-- ============================================================================
--
-- Not granted to authenticated: this is a sweep, not a user action.

create or replace function public.warn_uncovered_cover()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead interval := interval '48 hours';
begin
  with at_risk as (
    -- Requests with at least one unclaimed offer whose class runs within
    -- the lead time. now() < starts_at keeps classes that have already
    -- begun out of it — expire_cover_requests (0164) sweeps those.
    select distinct cr.id as request_id, cr.gym_id, cr.requested_by
    from public.cover_requests cr
    join public.cover_request_sessions crs on crs.request_id = cr.id
    join public.class_sessions cs on cs.id = crs.class_session_id
    where cr.status in ('open', 'partial')
      and crs.claimed_by is null
      and cs.starts_at > now()
      and cs.starts_at <= now() + v_lead
  ),
  recipient as (
    -- The requester, plus whoever runs the gym. Distinct, so an owner
    -- who asked for the cover is warned once, not twice.
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
    -- Gym-local date, so "once a day" means the gym's day.
    c.channel || ':uncovered:' || rc.request_id || ':' || rc.profile_id || ':'
      || (now() at time zone g.timezone)::date
  from recipient rc
  join public.gyms g on g.id = rc.gym_id
  left join auth.users u on u.id = rc.profile_id
  cross join (values ('in_app'), ('email')) as c(channel)
  on conflict (idempotency_key) do nothing;
end;
$$;

revoke execute on function public.warn_uncovered_cover()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

-- Runs before expire-cover-requests (04:00) so a class that is both
-- imminent and about to be swept still gets its last warning. Daily is
-- the right cadence for a 48-hour lead: two warnings before the class,
-- and nothing that reads as nagging.
select cron.schedule(
  'warn-uncovered-cover',
  '30 3 * * *',
  $$select public.warn_uncovered_cover();$$
);

commit;
