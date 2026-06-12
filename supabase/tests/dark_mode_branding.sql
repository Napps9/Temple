-- Dark-mode branding columns: set_gym_branding writes both the light
-- and dark variants, gym_by_slug returns both, and the dark columns
-- remain nullable so "auto-derive from light" stays available.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@dark.test');
  v_gym   uuid := _test_mk_gym('Dark Gym', 'dark-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform _test_act_as(v_owner);
end $$;

-- 1. set_gym_branding accepts the 4 new dark args and writes them.
do $$
begin
  perform public.set_gym_branding(
    current_setting('test.gym')::uuid,
    'https://logos.test/light.png',
    '#000000', '#EBE925', '#2563EB',
    'https://logos.test/dark.png',
    '#E5E7EB', '#FBBF24', '#60A5FA');
end $$;

select is(
  (select primary_color_dark from public.gyms
   where id = current_setting('test.gym')::uuid),
  '#E5E7EB',
  'set_gym_branding writes primary_color_dark'
);

select is(
  (select logo_url_dark from public.gyms
   where id = current_setting('test.gym')::uuid),
  'https://logos.test/dark.png',
  'set_gym_branding writes logo_url_dark'
);

-- 2. The four-arg legacy signature still works AND nulls out the dark
--    columns (no dark args = "auto-derive on read").
do $$
begin
  perform public.set_gym_branding(
    current_setting('test.gym')::uuid,
    'https://logos.test/light.png',
    '#000000', '#EBE925', '#2563EB');
end $$;

select is(
  (select primary_color_dark from public.gyms
   where id = current_setting('test.gym')::uuid),
  null,
  'omitting the dark args nulls the dark columns (auto-derive sentinel)'
);

-- 3. The CHECK constraint rejects a malformed dark hex.
select throws_ok(
  $sql$
    update public.gyms
      set primary_color_dark = 'not-a-hex'
      where id = current_setting('test.gym')::uuid
  $sql$,
  '23514',
  null,
  'primary_color_dark check rejects a malformed hex'
);

-- 4. gym_by_slug returns the dark columns alongside the light ones.
do $$
begin
  perform public.set_gym_branding(
    current_setting('test.gym')::uuid,
    'https://logos.test/light.png',
    '#000000', '#EBE925', '#2563EB',
    null,
    '#A3A3A3', null, null);
end $$;

select is(
  (select primary_color_dark from public.gym_by_slug('dark-gym')),
  '#A3A3A3',
  'gym_by_slug returns primary_color_dark'
);

select is(
  (select secondary_color_dark from public.gym_by_slug('dark-gym')),
  null,
  'gym_by_slug returns null for a dark column the gym left blank'
);

select * from finish();
rollback;
