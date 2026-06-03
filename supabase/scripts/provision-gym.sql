-- Sales-led provisioning helper.
--
-- Usage:
--   1. Invite the owner via Supabase Studio (Auth > Users > Add user, with
--      Auto Confirm so they can sign in immediately).
--   2. Edit the four variables at the top of the DO block below.
--   3. Run against the target database:
--        supabase db execute --file supabase/scripts/provision-gym.sql
--      (or paste into the SQL editor in Studio).

do $$
declare
  v_gym_name    text := 'Iron Temple';
  v_gym_slug    text := 'iron-temple';
  v_owner_email text := 'owner@example.com';
  v_owner_name  text := 'Owner Name';
  v_gym_id      uuid;
  v_owner_id    uuid;
begin
  select id into v_owner_id from auth.users where email = v_owner_email;
  if v_owner_id is null then
    raise exception
      'No auth.users row for %. Invite the owner via Supabase Studio first.',
      v_owner_email;
  end if;

  insert into public.gyms (name, slug)
  values (v_gym_name, v_gym_slug)
  returning id into v_gym_id;

  insert into public.profiles (id, full_name)
  values (v_owner_id, v_owner_name)
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.gym_memberships (gym_id, profile_id, role)
  values (v_gym_id, v_owner_id, 'owner');

  raise notice 'Provisioned gym % (%) with owner % (%)',
    v_gym_name, v_gym_id, v_owner_name, v_owner_email;
end;
$$;
