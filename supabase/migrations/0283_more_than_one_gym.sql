-- One gym per account was a v1 rule, and its migrations said so: "for
-- now" (0033, 0239, 0262). It existed because the app read the oldest
-- active membership at sign-in and could not show a second one, so the
-- four RPCs that mint a membership refused when the caller already held
-- one elsewhere. The app now lets an account choose which of its gyms
-- it is looking at (a per-device choice honoured by useGymMembership and
-- offered in the account menu), so the reason is gone and the rule goes
-- with it: an owner can be a member elsewhere, a coach can work two
-- locations, and a member can take a second gym's link.
--
-- Every other RPC and policy already anchors on a gym id. The one that
-- did not, report_client_error (0281), filed a crash under the oldest
-- gym; it now takes the gym whose screen broke and checks the caller is
-- in it, falling back to the oldest as before. Its arity changes, so it
-- is dropped and recreated.

begin;

create or replace function public.create_gym(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  v_slug := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]', '', 'gi'));
  if length(v_slug) = 0 then
    raise exception 'Slug must contain at least one letter or digit';
  end if;
  if exists (select 1 from public.gyms where slug = v_slug) then
    raise exception 'Slug already taken';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Gym name is required';
  end if;
  insert into public.gyms (name, slug)
    values (trim(p_name), v_slug)
    returning id into v_gym;
  insert into public.gym_memberships (gym_id, profile_id, role)
    values (v_gym, v_uid, 'owner');
  return v_gym;
end;
$$;

create or replace function public.join_gym_by_slug(p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gym uuid;
  v_enabled boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, public_signup_enabled
    into v_gym, v_enabled
    from public.gyms where slug = lower(p_slug);
  if v_gym is null then
    raise exception 'Gym not found';
  end if;
  if not v_enabled then
    raise exception 'Public signup is disabled for this gym';
  end if;
  -- An existing row for this gym (active or left) falls through to the
  -- upsert so rejoining keeps working.
  insert into public.gym_memberships (gym_id, profile_id, role)
    values (v_gym, v_uid, 'member')
    on conflict (gym_id, profile_id) do update
      set left_at = null;
  return v_gym;
end;
$$;

create or replace function public.accept_invite(invite_code text)
returns table(gym_id uuid, role gym_role)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_invite public.invite_codes;
  v_profile uuid;
begin
  v_profile := auth.uid();
  if v_profile is null then
    raise exception 'Not signed in';
  end if;

  select * into v_invite from public.invite_codes where code = invite_code;
  if v_invite is null then
    raise exception 'Invite code not found';
  end if;
  if v_invite.used_at is not null then
    raise exception 'Invite code already used';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite code expired';
  end if;

  insert into public.gym_memberships (gym_id, profile_id, role)
  values (v_invite.gym_id, v_profile, v_invite.role)
  on conflict (gym_id, profile_id) do update
    set role = excluded.role,
        left_at = null;

  update public.invite_codes
  set used_by = v_profile, used_at = now()
  where id = v_invite.id;

  return query select v_invite.gym_id, v_invite.role;
end;
$$;

create or replace function public.redeem_trial_pass(p_token text, p_session_id uuid default null)
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

drop function public.report_client_error(text, text, text, text, text, text);

create or replace function public.report_client_error(
  p_route           text,
  p_message         text,
  p_stack           text,
  p_component_stack text,
  p_platform        text,
  p_app_version     text,
  p_gym_id          uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_gym    uuid;
  v_recent integer;
  v_agent  text;
begin
  if p_message is null or length(btrim(p_message)) = 0 then
    return;
  end if;

  if v_uid is not null then
    select count(*) into v_recent from public.client_errors
      where profile_id = v_uid and created_at > now() - interval '1 hour';
    if v_recent >= 20 then
      return;
    end if;
    -- The gym whose screen broke, when the app says and the caller is
    -- in it; otherwise the oldest one they have not left, which is where
    -- the app lands them with no choice made.
    if p_gym_id is not null and exists (
      select 1 from public.gym_memberships
       where gym_id = p_gym_id and profile_id = v_uid and left_at is null
    ) then
      v_gym := p_gym_id;
    else
      select gym_id into v_gym from public.gym_memberships
        where profile_id = v_uid and left_at is null
        order by created_at
        limit 1;
    end if;
  else
    select count(*) into v_recent from public.client_errors
      where profile_id is null and created_at > now() - interval '1 hour';
    if v_recent >= 100 then
      return;
    end if;
  end if;

  v_agent := nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent';

  insert into public.client_errors
    (gym_id, profile_id, route, message, stack, component_stack,
     platform, app_version, user_agent)
  values
    (v_gym, v_uid,
     left(p_route, 200),
     left(p_message, 1000),
     left(p_stack, 4000),
     left(p_component_stack, 4000),
     left(p_platform, 40),
     left(p_app_version, 40),
     left(v_agent, 300));
end;
$$;

grant execute on function public.report_client_error(text, text, text, text, text, text, uuid)
  to anon, authenticated;

commit;
