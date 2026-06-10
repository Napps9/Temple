-- One active gym per account (v1 invariant), enforced at the RPCs.
--
-- The client models membership as a single row (`.maybeSingle()` /
-- single-gym routing), but create_gym and join_gym_by_slug happily
-- minted second memberships. The failure mode is nasty: with two
-- rows, the membership lookup errors, the app treats the user as
-- gym-less, and they're stuck on /welcome — where the only obvious
-- action ("Start a new gym") makes a THIRD membership.
--
-- create_gym: refuse when the caller holds any active membership.
-- join_gym_by_slug: same, except re-joining the gym you previously
-- left (left_at set) stays allowed; only cross-gym joins are blocked.

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
  if exists (
    select 1 from public.gym_memberships
    where profile_id = v_uid and left_at is null
  ) then
    raise exception 'You already belong to a gym — one gym per account for now';
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
  -- Active membership in a DIFFERENT gym blocks the join. An existing
  -- row for THIS gym (active or left) falls through to the upsert so
  -- rejoining keeps working.
  if exists (
    select 1 from public.gym_memberships
    where profile_id = v_uid and left_at is null and gym_id <> v_gym
  ) then
    raise exception 'You already belong to a gym — one gym per account for now';
  end if;
  insert into public.gym_memberships (gym_id, profile_id, role)
    values (v_gym, v_uid, 'member')
    on conflict (gym_id, profile_id) do update
      set left_at = null;
  return v_gym;
end;
$$;

commit;
