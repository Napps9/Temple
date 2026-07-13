-- demo_marketing_credentials (0122): the base table has zero policies —
-- nothing should be able to select it directly, not even an authenticated
-- user. The RPC is the only path, is SECURITY DEFINER, and takes no
-- parameters — it always returns the single most-recently-rotated row,
-- so there's no argument surface to fish for a different tenant's data
-- (there's only ever one row's worth of "different tenant" possible here,
-- but the shape still matters: no p_slug, no enumeration).

begin;
select plan(3);

\ir _helpers.psql

do $$
declare
  v_member uuid := _test_mk_user('member@dmc.test');
begin
  insert into public.demo_marketing_credentials
    (slug, gym_name, owner_email, owner_password, member_email, member_password)
    values (
      'demo-launchpad', 'Launchpad CrossFit',
      'owner@demo-launchpad.temple.test', 'placeholder',
      'member@demo-launchpad.temple.test', 'placeholder'
    );
  perform set_config('test.member', v_member::text, true);
end $$;

-- An authenticated user cannot select the base table directly.
do $$ begin perform _test_act_as(current_setting('test.member')::uuid); end $$;
select is(
  (select count(*)::int from public.demo_marketing_credentials),
  0,
  'an authenticated user cannot read the base table directly'
);

-- Neither can an anonymous visitor.
do $$ begin perform set_config('role', 'anon', true); end $$;
select is(
  (select count(*)::int from public.demo_marketing_credentials),
  0,
  'an anonymous visitor cannot read the base table directly'
);

-- But the RPC — the only sanctioned path — works for anon.
select is(
  (select slug from public.demo_marketing_credentials()),
  'demo-launchpad',
  'anon can execute the demo_marketing_credentials() RPC'
);

select * from finish();
rollback;
