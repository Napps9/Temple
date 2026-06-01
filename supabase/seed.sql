-- Local development seed.
--
-- Prerequisites (one-time):
--   1. supabase start
--   2. In Studio (http://127.0.0.1:54323) add two users with Auto Confirm on:
--        owner@temple.test  / temple1234
--        member@temple.test / temple1234
-- Then any subsequent `supabase db reset` will rewire them into the demo gym.

do $$
declare
  v_owner_id  uuid;
  v_member_id uuid;
  v_gym_id    uuid;
begin
  select id into v_owner_id from auth.users where email = 'owner@temple.test';
  select id into v_member_id from auth.users where email = 'member@temple.test';

  if v_owner_id is null or v_member_id is null then
    raise notice
      'Seed skipped: create owner@temple.test and member@temple.test in Supabase Studio first.';
    return;
  end if;

  insert into public.gyms (name, slug)
  values ('Iron Temple', 'iron-temple')
  returning id into v_gym_id;

  insert into public.profiles (id, full_name) values
    (v_owner_id,  'Iron Temple Owner'),
    (v_member_id, 'Demo Member');

  insert into public.gym_memberships (gym_id, profile_id, role) values
    (v_gym_id, v_owner_id,  'owner'),
    (v_gym_id, v_member_id, 'member');

  raise notice 'Seed applied: gym % with owner & member.', v_gym_id;
end;
$$;
