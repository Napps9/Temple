-- An address that bounces is a fact about a member, not about a campaign
--
-- 0229 records a hard bounce and holds the address back from every send,
-- which stops the reputation damage and is the whole of what the comms
-- surfaces need. It is not the whole of what a gym needs. The person
-- whose address died is still a member: they still have a plan, they
-- still stop coming, and the coach who goes to chase them has no way to
-- know that the email they are about to send will land nowhere. The one
-- place the fact is visible is the comms settings screen, which is an
-- admin surface for somebody composing a newsletter.
--
-- Two things make it a member fact rather than a comms one:
--
--   * email_suppressions gains profile_id, written by the same event
--     handler from the recipient row it already has in hand. Matching by
--     address at read time would work and is worse: it would mean every
--     member surface joining on an email column, and member email is
--     behind can_see_email (0178) precisely so that most staff never see
--     it.
--
--   * gym_unreachable_emails answers "can we email this person" without
--     answering "what is their address". Gated on can_access_staff_area,
--     because a coach chasing an absent member needs to know to phone
--     instead — that is the entire point — while the address itself stays
--     admin-only.
--
-- profile_id is nullable and stays that way: a suppression can belong to
-- a pending member, imported but never signed up, who has no profile at
-- all. Those rows are still suppressed and still shown in comms
-- settings; they simply have no member record to appear on.

begin;

alter table public.email_suppressions
  add column profile_id uuid references public.profiles(id) on delete set null;

create index email_suppressions_profile_idx
  on public.email_suppressions (gym_id, profile_id)
  where profile_id is not null;

-- Anything suppressed before this migration was matched to a recipient
-- row on the way in, so the link can be recovered rather than lost.
update public.email_suppressions es
   set profile_id = r.profile_id
  from public.email_campaign_recipients r
 where r.gym_id = es.gym_id
   and lower(r.email) = lower(es.email)
   and r.profile_id is not null
   and es.profile_id is null;

-- ============================================================================
-- The writer learns who it was
-- ============================================================================
--
-- 0229's body with profile_id carried through from the recipient row.

create or replace function public.comms_apply_delivery_event(
  p_provider_message_id text,
  p_kind                text,
  p_hard                boolean default true,
  p_detail              text default null,
  p_occurred_at         timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_gym       uuid;
  v_campaign  uuid;
  v_email     text;
  v_profile   uuid;
  v_detail    text := left(nullif(trim(coalesce(p_detail, '')), ''), 500);
  v_at        timestamptz := coalesce(p_occurred_at, now());
begin
  if p_provider_message_id is null or length(trim(p_provider_message_id)) = 0 then
    return false;
  end if;

  select id, gym_id, campaign_id, email, profile_id
    into v_recipient, v_gym, v_campaign, v_email, v_profile
    from public.email_campaign_recipients
    where provider_message_id = p_provider_message_id
    limit 1;
  if v_recipient is null then
    return false;
  end if;

  update public.email_campaigns
    set delivery_tracked = true
    where id = v_campaign and delivery_tracked = false;

  if p_kind = 'delivered' then
    update public.email_campaign_recipients
      set delivered_at = coalesce(delivered_at, v_at),
          status       = case when status in ('queued', 'sent') then 'delivered'
                              else status end
      where id = v_recipient;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, occurred_at)
      values (v_gym, v_campaign, v_recipient, 'delivered', v_at);

  elsif p_kind = 'bounced' then
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, occurred_at, meta)
      values (v_gym, v_campaign, v_recipient, 'bounce', v_at,
              jsonb_build_object('hard', coalesce(p_hard, true), 'detail', v_detail));

    if coalesce(p_hard, true) then
      update public.email_campaign_recipients
        set status = 'bounced',
            error  = coalesce(v_detail, 'The address bounced')
        where id = v_recipient;

      insert into public.email_suppressions
        (gym_id, email, profile_id, reason, detail, campaign_id, first_seen_at, last_seen_at)
      values (v_gym, v_email, v_profile, 'hard_bounce', v_detail, v_campaign, v_at, v_at)
      on conflict (gym_id, lower(email)) do update
        set last_seen_at = greatest(email_suppressions.last_seen_at, excluded.last_seen_at),
            detail       = coalesce(excluded.detail, email_suppressions.detail),
            campaign_id  = coalesce(excluded.campaign_id, email_suppressions.campaign_id),
            profile_id   = coalesce(email_suppressions.profile_id, excluded.profile_id);
    end if;

  elsif p_kind = 'complained' then
    update public.email_campaign_recipients
      set complained_at = coalesce(complained_at, v_at)
      where id = v_recipient;
    insert into public.email_events (gym_id, campaign_id, recipient_id, kind, occurred_at)
      values (v_gym, v_campaign, v_recipient, 'complaint', v_at);

    insert into public.email_suppressions
      (gym_id, email, profile_id, reason, detail, campaign_id, first_seen_at, last_seen_at)
    values (v_gym, v_email, v_profile, 'complaint', v_detail, v_campaign, v_at, v_at)
    on conflict (gym_id, lower(email)) do update
      set reason       = 'complaint',
          last_seen_at = greatest(email_suppressions.last_seen_at, excluded.last_seen_at),
          detail       = coalesce(excluded.detail, email_suppressions.detail),
          campaign_id  = coalesce(excluded.campaign_id, email_suppressions.campaign_id),
          profile_id   = coalesce(email_suppressions.profile_id, excluded.profile_id);

  else
    raise exception 'Unknown delivery event kind: %', p_kind;
  end if;

  return true;
end;
$$;

revoke all on function public.comms_apply_delivery_event(text, text, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.comms_apply_delivery_event(text, text, boolean, text, timestamptz)
  to service_role;

-- ============================================================================
-- Can we reach this person
-- ============================================================================
--
-- One function for both shapes: the member profile passes a profile and
-- gets nothing or one row, the members list passes none and gets the set.
-- No email column in the return — the question is whether the address
-- works, and the address itself is a separate permission.

create or replace function public.gym_unreachable_emails(
  p_gym_id     uuid,
  p_profile_id uuid default null
) returns table (
  profile_id   uuid,
  reason       text,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_can(p_gym_id, 'can_access_staff_area') then
    raise exception 'Not authorised';
  end if;

  return query
  select es.profile_id, es.reason, es.last_seen_at
    from public.email_suppressions es
   where es.gym_id = p_gym_id
     and es.profile_id is not null
     and (p_profile_id is null or es.profile_id = p_profile_id);
end;
$$;

revoke all on function public.gym_unreachable_emails(uuid, uuid) from public, anon;
grant execute on function public.gym_unreachable_emails(uuid, uuid) to authenticated;

commit;
