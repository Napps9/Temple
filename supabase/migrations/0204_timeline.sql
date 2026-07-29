-- 0204: The Timeline lights up (read-only).
--
-- Phase 1 of docs/roadmap.md. Two pieces:
--
-- 1. agent_actions — the ledger seed from docs/loop-1-payment-recovery.md.
--    The Timeline renders this table directly: proposed rows are inline
--    approval cards, terminal rows collapse to one-line receipts, so a
--    decision can never escape the audit trail — the ask and the record
--    are the same row. Created now (empty) so the surface, the types and
--    the RLS boundary all exist before the first loop writes to it.
--
-- 2. timeline_feed — one chronological stream per gym, unioned from what
--    already happens: members joining, leads captured, payments failing,
--    cover asked/claimed, closures, pending membership requests. No new
--    writes anywhere — the gym's existing activity becomes legible in one
--    place. Per-kind gating runs inside the function because the stream
--    crosses capability boundaries: money rows need can_see_money, lead
--    and request rows need the plan-assign gate, cover rows the cover
--    gate. cron_run_log stays out: it has no gym dimension (0189), so a
--    per-gym feed cannot honestly attribute its rows; the per-gym queues
--    those sweeps write (cover warnings, payment notices, class-change
--    digests) are already the gym-scoped shadow of the same activity.

-- ============================================================================
-- 1. agent_actions
-- ============================================================================

create table public.agent_actions (
  id                   uuid primary key default gen_random_uuid(),
  gym_id               uuid not null references public.gyms(id) on delete cascade,
  teammate             text not null check (teammate in ('revenue')),
  action_kind          text not null
    check (action_kind in ('chase_message', 'plan_adjustment_offer')),
  subject_profile      uuid references public.profiles(id) on delete set null,
  subject_subscription uuid references public.plan_subscriptions(id) on delete set null,
  payload              jsonb not null default '{}'::jsonb,
  -- Deterministic, SQL-derived sentences — never model-authored.
  evidence             jsonb not null default '[]'::jsonb,
  status               text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'executed', 'expired')),
  proposed_at          timestamptz not null default now(),
  decided_by           uuid references public.profiles(id),
  decided_at           timestamptz,
  executed_at          timestamptz
);

create index agent_actions_gym_time_idx
  on public.agent_actions(gym_id, proposed_at desc);
create index agent_actions_gym_open_idx
  on public.agent_actions(gym_id)
  where status = 'proposed';

alter table public.agent_actions enable row level security;

-- Staff read behind can_see_money (the v1 teammate is Revenue). No client
-- write policies at all — every write goes through service-role RPCs when
-- the loop lands (loop-1 spec), so a decision cannot be forged or edited
-- from the app.
create policy agent_actions_money_select on public.agent_actions
  for select using (public.effective_can(gym_id, 'can_see_money'));

-- ============================================================================
-- 2. timeline_feed
-- ============================================================================

create or replace function public.timeline_feed(
  p_gym_id uuid,
  p_before timestamptz default null,
  p_limit  integer default 50
) returns table (
  item_id     text,
  kind        text,
  occurred_at timestamptz,
  subject     text,
  detail      jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_before timestamptz := coalesce(p_before, now() + interval '1 day');
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_money  boolean;
  v_leads  boolean;
  v_cover  boolean;
begin
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    raise exception 'Not allowed';
  end if;
  v_money := public.effective_can(p_gym_id, 'can_see_money');
  v_leads := public.user_can_assign_plan(p_gym_id);
  v_cover := public.user_can_cover(p_gym_id);

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
             'status', l.status::text
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
             'range_end', cr.range_end
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
     where v_leads
       and r.gym_id = p_gym_id
       and r.status = 'pending'
       and r.created_at < v_before

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
$$;

revoke all on function public.timeline_feed(uuid, timestamptz, integer)
  from public, anon;
grant execute on function public.timeline_feed(uuid, timestamptz, integer)
  to authenticated;
