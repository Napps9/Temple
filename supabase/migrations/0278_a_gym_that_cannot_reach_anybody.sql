-- A gym that cannot reach anybody
--
-- Temple has three public demo tenants. Anyone who loads the marketing
-- homepage is handed the owner password for one of them; the other two are
-- opened on sales calls with a prospect at the keyboard. Once signed in,
-- that visitor is an ordinary owner: effective_can short-circuits
-- owner -> true (0127) before consulting any override, so they hold all
-- forty-three capabilities. Press "Send" on the seeded campaign and Resend
-- delivers it. Type an address into a staff invite and that address gets
-- mail. Complete a checkout and money moves on a live connected account.
--
-- The only thing standing between a visitor and any of that today is a
-- sentence on the marketing site asking them not to, and one in
-- docs/demo-gym.md. That is not a safeguard.
--
-- Nothing in the system could enforce it even if it wanted to, because
-- nothing in the system knows which gyms are demos. There is no flag, no
-- policy, no CHECK. The only demo-ness signal that exists anywhere is a
-- slug regex inside two Node scripts (seed-demo-gym.ts,
-- publish-demo-credentials.ts), which the database has never seen.
--
-- This is that flag. It carries no behaviour on its own — the guards live
-- in the edge functions, at the point each one is about to call a vendor —
-- but every one of them asks this column.
--
-- Two properties worth stating, because both are deliberate:
--
--   * It defaults to false, so every gym that exists today and every gym
--     created tomorrow is a real gym unless something says otherwise. A
--     flag that could silently capture a paying customer would be worse
--     than no flag.
--
--   * The trigger is a floor, not a ceiling. A slug beginning `demo-` is
--     forced true and cannot be un-flagged, because the seeder already
--     refuses any other prefix and that prefix is the one thing the two
--     hosted sales tenants have in common — they exist nowhere in this
--     repo, so a backfill naming them was never an option. Flagging a gym
--     whose slug does not begin `demo-` is still allowed: an internal
--     tenant that wants the same protection should be able to have it.

begin;

alter table public.gyms
  add column is_demo boolean not null default false;

comment on column public.gyms.is_demo is
  'A demo tenant: real data, real screens, but no vendor call may leave the '
  'building on its behalf. Forced true for any slug beginning demo-. See '
  'supabase/functions/_shared/demo.ts for what each vendor does instead.';

-- The three that exist in the hosted database right now — demo-launchpad
-- (embedded on the marketing homepage, reseeded nightly) and the two sales
-- tenants. Named by prefix rather than by slug on purpose: two of the three
-- appear in no file in this repository, so there is nothing to name.
update public.gyms
   set is_demo = true
 where slug like 'demo-%';

create function public._force_is_demo_for_demo_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug like 'demo-%' then
    new.is_demo := true;
  end if;
  return new;
end;
$$;

-- Before insert AND update: the update half matters more than it looks. It
-- is what stops the flag being cleared on a live demo tenant by a settings
-- write that happens to carry the whole row.
create trigger gyms_force_is_demo
  before insert or update on public.gyms
  for each row execute function public._force_is_demo_for_demo_slug();

-- The predicate, for callers that hold a gym id rather than a gym row.
-- Security definer because the edge functions ask it with the service key,
-- and because a member of one gym has no select on another's row.
create function public.gym_is_demo(p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_demo from public.gyms where id = p_gym_id), false);
$$;

grant execute on function public.gym_is_demo(uuid) to authenticated, service_role;

commit;
