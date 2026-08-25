-- A link that books a free class
--
-- The owner meets somebody — at a competition, in the DMs, outside the
-- coffee shop — and wants to send one link that puts them in Saturday's
-- 9am. Today the nearest thing is /lead/<slug>, which captures a name
-- and starts a phone-tag conversation, and /join/<slug>, which signs
-- somebody up as a member of a gym they have never trained at.
--
-- A trial pass is one object with two shapes. A PUBLIC pass is a link
-- the gym posts — on a poster, in a story, under a video — that anyone
-- can claim until it expires or runs out. A PERSONAL pass is minted for
-- one named prospect, single-use, and only redeemable from the address
-- it was sent to. Same table, same redemption path, one check apart.
--
-- Three things this deliberately does NOT do.
--
-- It does not book the class. _book_class_for refuses an unsigned
-- person — 'Waiver required', 'PAR-Q required' — and that refusal is
-- correct: a waiver is signed by the member's own hand or it is worth
-- nothing. So redemption HOLDS the seat and records the intent, the
-- root gate walks them through consent, waiver and PAR-Q, and the
-- booking then goes through book_class as them, with every gate
-- applying. This is 0149's principle, which said it first: staging only
-- records intent.
--
-- It does not invent an entitlement. comp_grants has existed since 0009
-- for exactly this case — its header says "free trials, foundation
-- courses, ex-member tasters" — it is already preferred over plans by
-- _select_default_entitlement_unchecked, it already burns a credit in
-- _book_class_for, and its class_type_allowlist already says "this one
-- is Foundations only". A new entitlement kind would fork the model
-- that exists across 0011, 0050 and 0216 for nothing.
--
-- And it does not add a notification channel. A redemption writes a
-- leads row and calls assign_lead, which already emails the assigned
-- coach and already writes the in-app row. The gym learns.
--
-- The hold is why _book_class_for is restated below. A seat somebody
-- claimed and has not taken yet — because they are twenty seconds into
-- a PAR-Q — has to count against capacity, or the class quietly
-- oversells while they sign. Holds expire by predicate rather than by
-- sweep: every reader tests held_until > now(), so an abandoned hold
-- releases itself with nothing scheduled and nothing to go wrong. A
-- hold also stops counting the moment its holder actually books —
-- otherwise the seat is charged twice, to the same person, until some
-- client remembers to tidy up. mark_trial_class_booked is bookkeeping;
-- it is deliberately not what makes the arithmetic right.
--
-- The window trap, recorded because it is invisible and it bites:
-- list_booking_entitlements tests a comp grant against the SESSION's
-- start time, not the booking time (0050: cs.starts_at >= cg.starts_at
-- and cs.starts_at < cg.ends_at). A pass minted for a class five weeks
-- out with a fortnight's validity would produce a grant that does not
-- cover the class it was minted for. Hence the greatest() below.

begin;

-- ============================================================================
-- 1. trial_passes
-- ============================================================================

create table public.trial_passes (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  token           text not null unique,
  kind            text not null check (kind in ('public', 'personal')),
  -- Exactly one of these: a pass is either for one named class, or for
  -- any session of a class type the claimant picks.
  class_type_id   uuid references public.class_types(id) on delete cascade,
  session_id      uuid references public.class_sessions(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete set null,
  invited_email   text,
  invited_name    text,
  passes          integer not null default 1 check (passes between 1 and 20),
  valid_days      integer not null default 14 check (valid_days between 1 and 180),
  max_redemptions integer check (max_redemptions >= 1),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  note            text,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (num_nonnulls(class_type_id, session_id) = 1),
  -- A personal pass is addressed, and being addressed is what earns it
  -- the right to a pre-confirmed account. Single-use follows.
  check (
    kind = 'public'
    or (max_redemptions = 1 and invited_email is not null)
  )
);

create index trial_passes_gym_created_idx
  on public.trial_passes (gym_id, created_at desc);
create index trial_passes_lead_idx
  on public.trial_passes (lead_id) where lead_id is not null;

-- One live personal pass per prospect: a coach who mints five for the
-- same person has made four ways to be confused about which was used.
create unique index trial_passes_personal_email_idx
  on public.trial_passes (gym_id, lower(invited_email))
  where kind = 'personal' and revoked_at is null;

comment on column public.trial_passes.passes is
  'Free classes the grant carries on redemption. Written only by create_trial_pass.';
comment on column public.trial_passes.invited_email is
  'Personal passes only: the address the link was sent to, and the only one that may redeem it.';

-- ============================================================================
-- 2. trial_pass_redemptions
-- ============================================================================

create table public.trial_pass_redemptions (
  id            uuid primary key default gen_random_uuid(),
  trial_pass_id uuid not null references public.trial_passes(id) on delete cascade,
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  comp_grant_id uuid references public.comp_grants(grant_id) on delete set null,
  -- The seat: which class, held until when, and the booking it became.
  session_id    uuid references public.class_sessions(id) on delete set null,
  held_until    timestamptz,
  booking_id    uuid references public.class_bookings(id) on delete set null,
  booked_at     timestamptz,
  redeemed_at   timestamptz not null default now(),
  unique (trial_pass_id, profile_id)
);

create index trial_pass_redemptions_gym_idx
  on public.trial_pass_redemptions (gym_id, redeemed_at desc);
-- The capacity read in _book_class_for, and the only one on the hot path.
create index trial_pass_redemptions_hold_idx
  on public.trial_pass_redemptions (session_id, held_until)
  where booking_id is null;

comment on column public.trial_pass_redemptions.held_until is
  'The seat is spoken for until this moment. Expiry is a predicate, not a sweep: readers test held_until > now().';

-- There is deliberately no redemption_count on trial_passes. The count
-- is derived under a row lock at redemption time, where it has to be
-- correct anyway; a cached copy would be a second source of truth whose
-- only job is to be wrong.

-- ============================================================================
-- 3. RLS — read for the staff who mint them, write for nobody
-- ============================================================================

alter table public.trial_passes           enable row level security;
alter table public.trial_pass_redemptions enable row level security;

-- Minting a trial pass IS issuing a comp grant, just deferred and to a
-- stranger, so it carries the capability that already governs that.
create policy trial_passes_staff_select on public.trial_passes
  for select using (public.effective_can(gym_id, 'can_issue_comp_grant'));

create policy trial_pass_redemptions_staff_select on public.trial_pass_redemptions
  for select using (public.effective_can(gym_id, 'can_work_leads'));

create policy trial_pass_redemptions_self_select on public.trial_pass_redemptions
  for select using (profile_id = auth.uid());

-- No write policy on either table, and the grants revoked to match:
-- every write goes through the functions below. This is 0195's
-- argument, applied at birth rather than retrofitted.
revoke insert, update, delete on public.trial_passes           from anon, authenticated;
revoke insert, update, delete on public.trial_pass_redemptions from anon, authenticated;

-- ============================================================================
-- 4. Minting and revoking
-- ============================================================================

create function public.create_trial_pass(
  p_gym_id          uuid,
  p_class_type_id   uuid    default null,
  p_session_id      uuid    default null,
  p_passes          integer default 1,
  p_valid_days      integer default 14,
  p_max_redemptions integer default null,
  p_expires_at      timestamptz default null,
  p_lead_id         uuid    default null,
  p_invited_email   text    default null,
  p_invited_name    text    default null,
  p_note            text    default null
)
returns table (pass_id uuid, token text, kind text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_kind       text;
  v_email      text := nullif(btrim(lower(coalesce(p_invited_email, ''))), '');
  v_expires    timestamptz;
  v_token      text;
  v_id         uuid;
  v_starts_at  timestamptz;
  v_ok         boolean;
  v_attempt    integer := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.effective_can(p_gym_id, 'can_issue_comp_grant') then
    raise exception 'Not authorised';
  end if;

  v_kind := case
    when p_lead_id is not null or v_email is not null then 'personal'
    else 'public'
  end;

  -- A pass addressed to a prospect writes to the lead pipeline when it
  -- is redeemed, so minting one needs the pipeline's own capability as
  -- well. A public poster link does not.
  if v_kind = 'personal'
     and not public.effective_can(p_gym_id, 'can_work_leads') then
    raise exception 'Not authorised';
  end if;

  if num_nonnulls(p_class_type_id, p_session_id) <> 1 then
    raise exception 'Pick a class type or a single class, not both';
  end if;

  if p_class_type_id is not null then
    select archived_at is null into v_ok
      from public.class_types
      where id = p_class_type_id and gym_id = p_gym_id;
    if v_ok is null then
      raise exception 'Class not found';
    end if;
    if not v_ok then
      raise exception 'This class type is no longer running';
    end if;
  end if;

  if p_session_id is not null then
    select starts_at into v_starts_at
      from public.class_sessions
      where id = p_session_id and gym_id = p_gym_id;
    if v_starts_at is null then
      raise exception 'Class not found';
    end if;
    if v_starts_at <= now() then
      raise exception 'Class has already started';
    end if;
  end if;

  if p_lead_id is not null
     and not exists (
       select 1 from public.leads
       where id = p_lead_id and gym_id = p_gym_id
     ) then
    raise exception 'Lead not found';
  end if;

  if v_email is not null
     and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if v_kind = 'personal' and v_email is null then
    -- A lead with no address on file cannot be sent a personal link.
    select nullif(btrim(lower(coalesce(email, ''))), '') into v_email
      from public.leads where id = p_lead_id;
    if v_email is null then
      raise exception 'This lead has no email address on file';
    end if;
  end if;

  -- One live personal link per prospect (the partial unique index). A
  -- coach asking twice wants the link, not an error about an index, so
  -- hand back the one that already exists.
  -- Every column is alias-qualified on purpose: this function's OUT
  -- parameters are named token and kind, so a bare `kind` in the WHERE
  -- reads the (null) output variable instead of the column and the
  -- lookup silently finds nothing.
  if v_kind = 'personal' then
    select tp.id, tp.token into v_id, v_token
      from public.trial_passes tp
      where tp.gym_id = p_gym_id
        and tp.kind = 'personal'
        and tp.revoked_at is null
        and lower(tp.invited_email) = v_email
        and tp.expires_at > now()
      limit 1;
    if v_id is not null then
      return query select v_id, v_token, 'personal'::text;
      return;
    end if;
  end if;

  v_expires := coalesce(p_expires_at, now() + interval '30 days');
  if v_expires <= now() or v_expires > now() + interval '365 days' then
    raise exception 'Trial link window out of range';
  end if;

  -- Schema-qualified for the same reason create_invite (0014) is: the
  -- function's search_path is public, and gen_random_bytes lives in
  -- extensions.
  loop
    v_attempt := v_attempt + 1;
    v_token := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    begin
      insert into public.trial_passes
        (gym_id, token, kind, class_type_id, session_id, lead_id,
         invited_email, invited_name, passes, valid_days,
         max_redemptions, expires_at, note, created_by)
      values
        (p_gym_id, v_token, v_kind, p_class_type_id, p_session_id, p_lead_id,
         v_email, nullif(btrim(coalesce(p_invited_name, '')), ''),
         p_passes, p_valid_days,
         case when v_kind = 'personal' then 1 else p_max_redemptions end,
         v_expires, nullif(btrim(coalesce(p_note, '')), ''), v_uid)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  return query select v_id, v_token, v_kind;
end;
$$;

revoke all on function public.create_trial_pass(
  uuid, uuid, uuid, integer, integer, integer, timestamptz, uuid, text, text, text
) from public, anon;
grant execute on function public.create_trial_pass(
  uuid, uuid, uuid, integer, integer, integer, timestamptz, uuid, text, text, text
) to authenticated;

create function public.revoke_trial_pass(p_pass_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.trial_passes where id = p_pass_id;
  if v_gym is null then
    raise exception 'Trial link not found';
  end if;
  if not public.effective_can(v_gym, 'can_issue_comp_grant') then
    raise exception 'Not authorised';
  end if;
  update public.trial_passes
     set revoked_at = coalesce(revoked_at, now())
   where id = p_pass_id;
end;
$$;

revoke all on function public.revoke_trial_pass(uuid) from public, anon;
grant execute on function public.revoke_trial_pass(uuid) to authenticated;

-- ============================================================================
-- 5. What the link shows before anyone signs up
-- ============================================================================

-- Granted to anon, and returns NOTHING rather than an error for a token
-- that is unknown, revoked, expired, spent or in the past — 0093's rule
-- for invite_code_gym, for the same reason: a link that distinguishes
-- "wrong" from "used" is a link that answers questions about the gym to
-- anyone who guesses.
--
-- It never returns invited_email. A URL is a bearer credential and the
-- person holding it is not necessarily the person it was sent to;
-- echoing the address back would turn a forwarded link into a way to
-- read a prospect's contact details. The first name is enough to greet
-- somebody by.
create function public.trial_pass_offer(p_token text)
returns table (
  gym_id             uuid,
  gym_name           text,
  gym_slug           text,
  kind               text,
  class_type_id      uuid,
  class_type_name    text,
  session_id         uuid,
  session_name       text,
  starts_at          timestamptz,
  duration_minutes   integer,
  coach_name         text,
  passes             integer,
  invited_first_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.gym_id,
    g.name,
    g.slug,
    t.kind,
    coalesce(t.class_type_id, s.class_type_id),
    ct.name,
    t.session_id,
    s.name,
    s.starts_at,
    s.duration_minutes,
    p.full_name,
    t.passes,
    nullif(split_part(coalesce(t.invited_name, ''), ' ', 1), '')
  from public.trial_passes t
  join public.gyms g on g.id = t.gym_id
  left join public.class_sessions s on s.id = t.session_id
  left join public.class_types ct
    on ct.id = coalesce(t.class_type_id, s.class_type_id)
  left join public.profiles p on p.id = s.coach_id
  where t.token = upper(btrim(p_token))
    and t.revoked_at is null
    and t.expires_at > now()
    and (t.session_id is null or s.starts_at > now())
    and (
      t.max_redemptions is null
      or (
        select count(*) from public.trial_pass_redemptions r
        where r.trial_pass_id = t.id
      ) < t.max_redemptions
    )
  limit 1;
$$;

revoke all on function public.trial_pass_offer(text) from public;
grant execute on function public.trial_pass_offer(text) to anon, authenticated;

-- The sessions a class-type pass can be spent on. Bounded by the gym's
-- own booking window, because a link that lets somebody pick a class
-- book_class will later refuse ('Booking not yet open for this class')
-- is a link that fails at the last step instead of the first.
create function public.trial_pass_sessions(p_token text)
returns table (
  session_id       uuid,
  session_name     text,
  starts_at        timestamptz,
  duration_minutes integer,
  coach_name       text,
  spaces_left      integer
)
language sql
stable
security definer
set search_path = public
as $$
  with pass as (
    select t.*
      from public.trial_passes t
     where t.token = upper(btrim(p_token))
       and t.revoked_at is null
       and t.expires_at > now()
     limit 1
  )
  select
    s.id,
    s.name,
    s.starts_at,
    s.duration_minutes,
    p.full_name,
    greatest(
      0,
      s.capacity
        - (select count(*) from public.class_bookings b
            where b.class_session_id = s.id)
        - (select count(*) from public.trial_pass_redemptions r
            where r.session_id = s.id
              and r.booking_id is null
              and r.held_until > now()
              and not exists (
                select 1 from public.class_bookings b
                where b.class_session_id = r.session_id
                  and b.profile_id = r.profile_id))
    )::integer
  from pass
  join public.class_sessions s
    on s.gym_id = pass.gym_id
   and (
     (pass.session_id is not null and s.id = pass.session_id)
     or (pass.class_type_id is not null and s.class_type_id = pass.class_type_id)
   )
  join public.class_types ct on ct.id = s.class_type_id and ct.archived_at is null
  join public.gyms g on g.id = s.gym_id
  left join public.profiles p on p.id = s.coach_id
  where s.starts_at > now()
    and s.starts_at < now() + interval '21 days'
    and (
      coalesce(ct.booking_window_hours_ahead, g.booking_window_hours_ahead) is null
      or s.starts_at <= now() + make_interval(
           hours => coalesce(ct.booking_window_hours_ahead,
                             g.booking_window_hours_ahead))
    )
  order by s.starts_at
  limit 40;
$$;

revoke all on function public.trial_pass_sessions(text) from public;
grant execute on function public.trial_pass_sessions(text) to anon, authenticated;

-- ============================================================================
-- 6. Redemption — a membership, a comp grant, a lead, and a held seat
-- ============================================================================

create function public.redeem_trial_pass(p_token text, p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text := nullif(btrim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  t            public.trial_passes;
  v_used       integer;
  v_existing   public.trial_pass_redemptions;
  v_session    public.class_sessions;
  v_taken      integer;
  v_class_type uuid;
  v_grant      uuid;
  v_lead       uuid;
  v_hold       timestamptz;
  v_redemption uuid;
  v_name       text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into t
    from public.trial_passes
    where token = upper(btrim(p_token))
    for update;
  if t.id is null then
    raise exception 'This trial link isn''t valid';
  end if;
  if t.revoked_at is not null or t.expires_at <= now() then
    raise exception 'This trial link has expired';
  end if;

  -- Idempotent on a second tap: signing up, confirming an email and
  -- landing back on the link is a normal path, and dead-ending somebody
  -- on their own redemption would be the worst possible moment to.
  select * into v_existing
    from public.trial_pass_redemptions
    where trial_pass_id = t.id and profile_id = v_uid;
  if v_existing.id is not null then
    return jsonb_build_object(
      'redemption_id', v_existing.id,
      'gym_id',        v_existing.gym_id,
      'session_id',    v_existing.session_id,
      'held_until',    v_existing.held_until,
      'comp_grant_id', v_existing.comp_grant_id,
      'already',       true
    );
  end if;

  select count(*) into v_used
    from public.trial_pass_redemptions where trial_pass_id = t.id;
  if t.max_redemptions is not null and v_used >= t.max_redemptions then
    raise exception 'This trial link has been fully claimed';
  end if;

  if t.kind = 'personal'
     and (v_email is null or v_email <> lower(t.invited_email)) then
    raise exception 'This trial link was sent to a different email address';
  end if;

  select * into v_session
    from public.class_sessions
    where id = coalesce(t.session_id, p_session_id)
      and gym_id = t.gym_id;
  if v_session.id is null then
    raise exception 'Pick a class from this gym';
  end if;
  -- A class-type pass may only be spent on its own class type.
  if t.class_type_id is not null
     and v_session.class_type_id <> t.class_type_id then
    raise exception 'Pick a class from this gym';
  end if;
  if v_session.starts_at <= now() then
    raise exception 'Class has already started';
  end if;

  select (
    (select count(*) from public.class_bookings b
      where b.class_session_id = v_session.id)
    + (select count(*) from public.trial_pass_redemptions r
        where r.session_id = v_session.id
          and r.booking_id is null
          and r.held_until > now()
          and not exists (
            select 1 from public.class_bookings b
            where b.class_session_id = r.session_id
              and b.profile_id = r.profile_id))
  ) into v_taken;
  if v_taken >= v_session.capacity then
    raise exception 'That class is full — pick another';
  end if;

  -- The one-gym rule, in the words 0033 and 0239 already use. A third
  -- wording here would be a third thing to keep in step with the
  -- oldest-active-membership lookup the app does at sign-in.
  if exists (
    select 1 from public.gym_memberships
    where profile_id = v_uid and left_at is null and gym_id <> t.gym_id
  ) then
    raise exception 'You already belong to a gym — one gym per account for now';
  end if;

  -- Reopen a membership without touching the role: 0239's lesson is
  -- that this upsert has to let somebody back in, and this one adds
  -- that it must not demote a returning coach to a member on the way.
  insert into public.gym_memberships (gym_id, profile_id, role)
  values (t.gym_id, v_uid, 'member')
  on conflict (gym_id, profile_id) do update set left_at = null;

  v_class_type := v_session.class_type_id;

  -- The window has to cover the class, not merely the fortnight after
  -- redemption: list_booking_entitlements (0050) tests a grant against
  -- the SESSION's start. A pass for a class beyond valid_days would
  -- otherwise mint a grant that cannot pay for it.
  insert into public.comp_grants
    (gym_id, profile_id, starts_at, ends_at,
     credits_total, credits_remaining, class_type_allowlist,
     granted_by, reason)
  values
    (t.gym_id, v_uid, now(),
     greatest(now() + make_interval(days => t.valid_days),
              v_session.starts_at + interval '1 day'),
     t.passes, t.passes, array[v_class_type],
     t.created_by, 'Free trial link')
  returning grant_id into v_grant;

  -- The lead. Reuse the one the pass was minted for; otherwise the same
  -- 30-day dedup capture_public_lead (0114) uses, so a prospect who
  -- enquired last week and takes a trial today is one lead, not two.
  select full_name into v_name from public.profiles where id = v_uid;
  v_lead := t.lead_id;
  if v_lead is null and v_email is not null then
    select id into v_lead
      from public.leads
      where gym_id = t.gym_id
        and lower(email) = v_email
        and status not in ('converted'::public.lead_status, 'lost'::public.lead_status)
        and captured_at >= now() - interval '30 days'
      order by captured_at desc
      limit 1;
  end if;

  if v_lead is null then
    insert into public.leads
      (gym_id, full_name, email, status, captured_by, lawful_basis)
    values
      (t.gym_id, coalesce(nullif(btrim(coalesce(v_name, '')), ''), 'Trial guest'),
       v_email, 'intro_booked'::public.lead_status, null, 'legitimate_interest')
    returning id into v_lead;
  else
    -- Only ever forward. A lead already at 'committed' has gone further
    -- than booking a trial, and a status ladder that walks backwards is
    -- a pipeline nobody can trust.
    update public.leads
       set status = 'intro_booked'::public.lead_status,
           updated_at = now()
     where id = v_lead
       and status in ('cold'::public.lead_status, 'contacted'::public.lead_status);
  end if;
  perform public.assign_lead(v_lead);

  -- Hold the seat while they sign. Long enough to finish consent, the
  -- waiver and a PAR-Q without hurrying; never past the hour before the
  -- class, because a seat held to the last minute is a seat nobody else
  -- could have taken.
  v_hold := least(now() + interval '24 hours',
                  v_session.starts_at - interval '1 hour');

  insert into public.trial_pass_redemptions
    (trial_pass_id, gym_id, profile_id, lead_id, comp_grant_id,
     session_id, held_until)
  values
    (t.id, t.gym_id, v_uid, v_lead, v_grant, v_session.id, v_hold)
  returning id into v_redemption;

  return jsonb_build_object(
    'redemption_id', v_redemption,
    'gym_id',        t.gym_id,
    'session_id',    v_session.id,
    'session_name',  v_session.name,
    'starts_at',     v_session.starts_at,
    'held_until',    v_hold,
    'comp_grant_id', v_grant,
    'already',       false
  );
end;
$$;

revoke all on function public.redeem_trial_pass(text, uuid) from public, anon;
grant execute on function public.redeem_trial_pass(text, uuid) to authenticated;

-- ============================================================================
-- 7. The held seat, from the member's side
-- ============================================================================

create function public.my_pending_trial_class(p_gym_id uuid)
returns table (
  redemption_id uuid,
  session_id    uuid,
  session_name  text,
  starts_at     timestamptz,
  held_until    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, s.id, s.name, s.starts_at, r.held_until
  from public.trial_pass_redemptions r
  join public.class_sessions s on s.id = r.session_id
  where r.gym_id = p_gym_id
    and r.profile_id = auth.uid()
    and r.booking_id is null
    and s.starts_at > now()
    and not exists (
      select 1 from public.class_bookings b
      where b.class_session_id = s.id and b.profile_id = auth.uid()
    )
  order by s.starts_at
  limit 1;
$$;

revoke all on function public.my_pending_trial_class(uuid) from public, anon;
grant execute on function public.my_pending_trial_class(uuid) to authenticated;

-- Retire the hold. Called with the booking on success, and without one
-- on failure — where clearing session_id is the point: a trialist whose
-- auto-book was refused should be picking a class, not re-running the
-- same refusal on every visit.
create function public.mark_trial_class_booked(
  p_redemption_id uuid,
  p_booking_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner
    from public.trial_pass_redemptions where id = p_redemption_id;
  if v_owner is null then
    raise exception 'Trial booking not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  update public.trial_pass_redemptions
     set booking_id = p_booking_id,
         booked_at  = case when p_booking_id is not null then now() else booked_at end,
         session_id = case when p_booking_id is null then null else session_id end,
         held_until = null
   where id = p_redemption_id;
end;
$$;

revoke all on function public.mark_trial_class_booked(uuid, uuid) from public, anon;
grant execute on function public.mark_trial_class_booked(uuid, uuid) to authenticated;

-- The calendar counts class_bookings rows directly to show spots left,
-- which would show a seat that is already spoken for. This is the same
-- number _book_class_for enforces, exposed for the day's sessions.
create function public.class_session_hold_counts(p_session_ids uuid[])
returns table (session_id uuid, holds integer)
language sql
stable
security definer
set search_path = public
as $$
  select r.session_id, count(*)::integer
  from public.trial_pass_redemptions r
  join public.class_sessions s on s.id = r.session_id
  where r.session_id = any(p_session_ids)
    and r.booking_id is null
    and r.held_until > now()
    and public.user_belongs_to(s.gym_id)
    and not exists (
      select 1 from public.class_bookings b
      where b.class_session_id = r.session_id and b.profile_id = r.profile_id
    )
  group by r.session_id;
$$;

revoke all on function public.class_session_hold_counts(uuid[]) from public, anon;
grant execute on function public.class_session_hold_counts(uuid[]) to authenticated;

-- ============================================================================
-- 8. A held seat is an occupied seat
-- ============================================================================

create or replace function public._book_class_for(
  p_session_id              uuid,
  p_profile_id              uuid,
  p_entitlement_kind        text default null,
  p_entitlement_id          uuid default null,
  p_booked_by_profile_id    uuid default null,
  p_enforce_windows         boolean default true,
  p_no_charge               boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sess           public.class_sessions;
  current_count  int;
  v_booking_id   uuid;
  v_archived_at  timestamptz;
  v_active_q     uuid;
  v_last_resp    public.parq_responses%rowtype;
  v_active_w     uuid;
  v_has_sig      boolean;
  v_parq_days    integer;
  v_kind         text;
  v_id           uuid;
  v_eligible     boolean;
  v_window_hrs   integer;
  v_book_cutoff  integer;
  v_ct_window    integer;
  v_ct_book      integer;
  v_role         public.gym_role;
  v_override     boolean;
  v_gym_requires boolean;
  v_requires     boolean;
  v_holds_plan   boolean;
begin
  if p_profile_id is null then
    raise exception 'No profile to book for';
  end if;

  select * into sess
    from public.class_sessions
    where id = p_session_id
    for update;
  if sess is null then
    raise exception 'Class not found';
  end if;

  if not exists (
    select 1 from public.gym_memberships
    where gym_id = sess.gym_id
      and profile_id = p_profile_id
      and left_at is null
  ) then
    raise exception 'Not authorised';
  end if;

  if sess.starts_at < now() then
    raise exception 'Class has already started';
  end if;

  select archived_at,
         booking_window_hours_ahead,
         booking_cutoff_minutes_before
    into v_archived_at, v_ct_window, v_ct_book
    from public.class_types
    where id = sess.class_type_id;
  if v_archived_at is not null then
    raise exception 'This class type is no longer running';
  end if;

  select parq_expiry_days,
         booking_window_hours_ahead,
         booking_cutoff_minutes_before
    into v_parq_days, v_window_hrs, v_book_cutoff
    from public.gyms
    where id = sess.gym_id;
  v_parq_days   := coalesce(v_parq_days, 365);
  v_window_hrs  := coalesce(v_ct_window, v_window_hrs);
  v_book_cutoff := coalesce(v_ct_book,   coalesce(v_book_cutoff, 0));

  if p_enforce_windows and not public.user_can_assign_plan(sess.gym_id) then
    if v_window_hrs is not null
       and sess.starts_at > now() + make_interval(hours => v_window_hrs)
    then
      raise exception 'Booking not yet open for this class';
    end if;
    if v_book_cutoff > 0
       and sess.starts_at <= now() + make_interval(mins => v_book_cutoff)
    then
      raise exception 'Booking closed for this class';
    end if;
  end if;

  select id into v_active_q
    from public.parq_questionnaires
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_q is not null then
    select * into v_last_resp
      from public.parq_responses
      where gym_id = sess.gym_id and profile_id = p_profile_id
      order by completed_at desc
      limit 1;
    if v_last_resp.id is null
       or v_last_resp.questionnaire_id <> v_active_q
       or v_last_resp.completed_at < (now() - make_interval(days => v_parq_days))
    then
      raise exception
        'PAR-Q required: complete the health screening before booking';
    end if;
  end if;

  select id into v_active_w
    from public.waiver_documents
    where gym_id = sess.gym_id and is_active
    limit 1;
  if v_active_w is not null then
    select exists (
      select 1 from public.waiver_signatures
      where gym_id = sess.gym_id
        and profile_id = p_profile_id
        and waiver_id = v_active_w
    ) into v_has_sig;
    if not v_has_sig then
      raise exception
        'Waiver required: sign the waiver before booking';
    end if;
  end if;

  if p_no_charge then
    v_kind := null;
    v_id   := null;
  elsif p_entitlement_kind is not null and p_entitlement_id is not null then
    select exists (
      select 1 from public.list_booking_entitlements(p_session_id, p_profile_id) e
      where e.kind::text = p_entitlement_kind and e.id = p_entitlement_id
    ) into v_eligible;
    if not v_eligible then
      raise exception 'Chosen entitlement is not eligible for this class';
    end if;
    v_kind := p_entitlement_kind;
    v_id   := p_entitlement_id;
  else
    select kind::text, id into v_kind, v_id
      from public._select_default_entitlement_unchecked(
        p_profile_id, sess.gym_id, p_session_id);
  end if;

  -- Booking entitlement requirement. A self-booking that resolves no
  -- eligible entitlement (v_id is null) is refused when either:
  --   1. an active membership is required — for members via
  --      gyms.require_membership_to_book, for anyone via the per-person
  --      gym_memberships.require_membership_to_book override (staff are
  --      exempt by default); or
  --   2. the booker already holds a plan_subscription here that just
  --      isn't covering this class (lapsed / out of credits) — the
  --      original "no free booking past your credits" protection.
  -- Staff on-behalf bookings and waitlist promotion (p_enforce_windows =
  -- false) bypass both — that's also what lets p_no_charge through for
  -- a member who does hold a plan.
  if p_enforce_windows and v_id is null then
    select gm.role, gm.require_membership_to_book
      into v_role, v_override
      from public.gym_memberships gm
      where gm.gym_id = sess.gym_id and gm.profile_id = p_profile_id;
    select g.require_membership_to_book
      into v_gym_requires
      from public.gyms g where g.id = sess.gym_id;
    v_requires := coalesce(
      v_override,
      case when v_role = 'member' then v_gym_requires else false end
    );
    -- A subscription that has lapsed or been cancelled is not a
    -- membership they still hold: it is one they used to. Testing for
    -- the mere existence of a row punished a former member for ever
    -- having paid, while a stranger with no history walked in. The
    -- protection this is actually for — no free booking past your
    -- credits — is untouched, because a credit plan at zero balance is
    -- still 'active' and still not terminal.
    v_holds_plan := v_role = 'member' and exists (
      select 1 from public.plan_subscriptions ps
      where ps.profile_id = p_profile_id and ps.gym_id = sess.gym_id
        and not public.is_terminal_subscription_status(ps.status)
    );
    if v_requires or v_holds_plan then
      raise exception 'Membership required: no active plan or credits cover this class';
    end if;
  end if;

  -- Capacity counts confirmed bookings plus live trial holds (0262).
  -- A hold is a seat somebody claimed from a trial link and has not
  -- taken yet because they are still signing the waiver; counting it
  -- is the whole point of holding it. The holder's own hold is
  -- excluded, or the trialist would be locked out of the seat they
  -- are holding.
  select (
    (select count(*)
       from public.class_bookings
      where class_session_id = p_session_id)
    +
    (select count(*)
       from public.trial_pass_redemptions r
      where r.session_id = p_session_id
        and r.booking_id is null
        and r.held_until > now()
        and r.profile_id <> p_profile_id
        and not exists (
          select 1 from public.class_bookings b
          where b.class_session_id = r.session_id
            and b.profile_id = r.profile_id))
  ) into current_count;

  if current_count >= sess.capacity
     and coalesce(current_setting('temple.allow_over_capacity', true), 'off') <> 'on'
  then
    raise exception 'Class is full';
  end if;

  insert into public.class_bookings
    (gym_id, class_session_id, profile_id,
     used_entitlement_kind, used_entitlement_id, booked_by_profile_id)
  values (sess.gym_id, p_session_id, p_profile_id,
          v_kind, v_id, p_booked_by_profile_id)
  on conflict (class_session_id, profile_id) do nothing
  returning id into v_booking_id;

  if v_booking_id is not null then
    if v_kind = 'comp_grant' then
      update public.comp_grants
        set credits_remaining = credits_remaining - 1
        where grant_id = v_id
          and credits_remaining is not null;
    elsif v_kind = 'plan_subscription' then
      update public.plan_subscriptions ps
        set credit_balance = credit_balance - 1
        from public.membership_plans mp
        where mp.plan_id = ps.plan_id
          and ps.id = v_id
          and ps.credit_balance is not null
          and mp.kind in ('credit_pack', 'credit_period');
    end if;
  end if;

  return v_booking_id;
end;
$$;

commit;
