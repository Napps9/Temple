-- gyms.is_demo (0278, rewritten by 0291) — the flag every egress guard asks.
--
-- The guards themselves live in the edge functions and are covered by
-- src/lib/edge-egress.test.ts, which fails when a new vendor call appears
-- unguarded. What that test cannot check is the thing underneath it: that
-- the flag is set on the tenant that needs it.
--
-- 0278 inferred it from the slug, because the two sales tenants existed
-- nowhere in this repository and the prefix was the only handle on them.
-- 0291 ties it to the exposure instead: the danger is not a naming
-- convention, it is an owner password sitting on jointemple.io, and
-- demo_marketing_credentials is the row that puts it there. So publishing
-- flags the gym, and a tenant one person signs into is an ordinary gym
-- whose front desk really texts people.

begin;
select plan(7);

\ir _helpers.psql

do $$
begin
  perform _test_mk_gym('Real Gym', 'real-barbell-club');
  perform _test_mk_gym('Sales Demo', 'demo-a-person-opens-this-one');
  perform _test_mk_gym('Published Demo', 'demo-on-the-marketing-site');
end $$;

-- 1. A gym created the ordinary way is a real gym.
select is(
  (select is_demo from public.gyms where slug = 'real-barbell-club'),
  false,
  'a gym with an ordinary slug is not a demo gym'
);

-- 2. The prefix no longer decides. This is the line 0291 changed, and it
--    is the whole point: a tenant whose password only one person holds is
--    a gym like any other, and its AI front desk can text a real handset.
select is(
  (select is_demo from public.gyms where slug = 'demo-a-person-opens-this-one'),
  false,
  'a demo- slug is not flagged on its name alone'
);

-- 3-4. Publishing the password is what flags it — the same row
--      api/demo-credentials.ts serves to anyone loading the marketing
--      site, so a tenant cannot become publicly passworded without
--      becoming a demo tenant in the same statement.
do $$
begin
  insert into public.demo_marketing_credentials
    (slug, gym_name, owner_email, owner_password, member_email, member_password)
  values ('demo-on-the-marketing-site', 'Published Demo',
          'owner@demo-on-the-marketing-site.temple.test', 'pw',
          'member01@demo-on-the-marketing-site.temple.test', 'pw');
end $$;
select is(
  (select is_demo from public.gyms where slug = 'demo-on-the-marketing-site'),
  true,
  'publishing a tenant password flags it as a demo gym'
);
select is(
  (select is_demo from public.gyms where slug = 'demo-a-person-opens-this-one'),
  false,
  'and flags only the tenant that was published'
);

-- 5. The nightly rotation re-publishes rather than inserting, so the
--    update half has to flag too — otherwise a reseeded tenant would come
--    back unguarded on whichever night somebody changed the write.
do $$
begin
  update public.gyms set is_demo = false where slug = 'demo-on-the-marketing-site';
  update public.demo_marketing_credentials
     set owner_password = 'rotated', rotated_at = now()
   where slug = 'demo-on-the-marketing-site';
end $$;
select is(
  (select is_demo from public.gyms where slug = 'demo-on-the-marketing-site'),
  true,
  'rotating a published password re-flags the tenant'
);

-- 6. The predicate the edge functions call agrees with the column.
select is(
  public.gym_is_demo(
    (select id from public.gyms where slug = 'demo-on-the-marketing-site')
  ),
  true,
  'gym_is_demo agrees with the column'
);

-- 7. An id that names no gym is not a demo gym. The helper coalesces rather
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
