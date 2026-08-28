-- gyms.is_demo (0278) — the flag every egress guard asks.
--
-- The guards themselves live in the edge functions and are covered by
-- src/lib/edge-egress.test.ts, which fails when a new vendor call appears
-- unguarded. What that test cannot check is the thing underneath it: that
-- the flag is actually set on the tenants that need it, and that it cannot
-- come off one.
--
-- It matters because the two sales demo tenants exist nowhere in this
-- repository — they were created by hand against the hosted database and
-- are named only in a line of prose in docs/gym-outreach-checklist.md. The
-- prefix is the only thing that finds them, so the prefix has to be
-- load-bearing rather than a convention.

begin;
select plan(6);

\ir _helpers.psql

do $$
begin
  perform _test_mk_gym('Real Gym', 'real-barbell-club');
  perform _test_mk_gym('Demo Gym', 'demo-a-gym-that-cannot-reach-anybody');
end $$;

-- 1. A gym created the ordinary way is a real gym. The column defaults to
--    false, so nothing that exists today is caught by the guards.
select is(
  (select is_demo from public.gyms where slug = 'real-barbell-club'),
  false,
  'a gym with an ordinary slug is not a demo gym'
);

-- 2. The prefix is the flag. _test_mk_gym does not pass is_demo at all, so
--    this is the trigger doing it rather than a default.
select is(
  (select is_demo from public.gyms where slug = 'demo-a-gym-that-cannot-reach-anybody'),
  true,
  'a demo- slug is flagged on insert without anybody asking'
);

-- 3. Asking for false explicitly does not get you false. This is the case
--    that matters: the seeder creates these gyms and could be changed by
--    somebody who has never read 0278.
do $$
begin
  insert into public.gyms (name, slug, is_demo)
  values ('Insistent Demo', 'demo-insists-it-is-real', false);
end $$;
select is(
  (select is_demo from public.gyms where slug = 'demo-insists-it-is-real'),
  true,
  'a demo- slug cannot be inserted unflagged'
);

-- 4. And it cannot be cleared afterwards. Every gym settings write in the
--    product sends a whole row; without the update half of the trigger, one
--    of them carrying a stale is_demo would silently unguard a live demo
--    tenant.
do $$
begin
  update public.gyms
     set is_demo = false
   where slug = 'demo-a-gym-that-cannot-reach-anybody';
end $$;
select is(
  (select is_demo from public.gyms where slug = 'demo-a-gym-that-cannot-reach-anybody'),
  true,
  'a demo gym cannot be un-flagged by an update'
);

-- 5. The predicate the edge functions call agrees with the column.
select is(
  public.gym_is_demo(
    (select id from public.gyms where slug = 'demo-a-gym-that-cannot-reach-anybody')
  ),
  true,
  'gym_is_demo agrees with the column'
);

-- 6. An id that names no gym is not a demo gym. The helper coalesces rather
--    than returning null, because every caller uses it in a boolean test and
--    a null there reads as "not a demo gym" by accident instead of on
--    purpose. (The edge-function helper in _shared/demo.ts fails the other
--    way, closed, because there a missing gym means a lookup that failed
--    rather than a gym that does not exist.)
select is(
  public.gym_is_demo('00000000-0000-0000-0000-000000000000'::uuid),
  false,
  'an unknown gym id is not a demo gym'
);

select * from finish();
rollback;
