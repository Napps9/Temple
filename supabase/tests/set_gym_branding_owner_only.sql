-- set_gym_branding (and the other set_gym_* RPCs) are gated on
-- user_is_owner_of. A non-owner is blocked with 'Not authorised'.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@brand.test');
  v_admin uuid := _test_mk_user('admin@brand.test');
  v_gym   uuid := _test_mk_gym('Brand Gym', 'brand-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_admin, 'admin');
  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.admin', v_admin::text, true);
end;
$$;

-- Admin cannot set branding.
do $$
begin
  perform _test_act_as(current_setting('test.admin')::uuid);
end;
$$;

select throws_like(
  $$ select public.set_gym_branding(
       current_setting('test.gym')::uuid,
       null, '#FF0000', '#00FF00', '#0000FF'
     )
  $$,
  '%Not authorised%',
  'admin cannot set gym branding'
);

-- Owner can.
do $$
begin
  perform _test_act_as(current_setting('test.owner')::uuid);
  perform public.set_gym_branding(
    current_setting('test.gym')::uuid,
    null, '#FF0000', '#00FF00', '#0000FF'
  );
end;
$$;

select is(
  (select primary_color from public.gyms
    where id = current_setting('test.gym')::uuid),
  '#FF0000',
  'owner can set the primary brand colour'
);

select * from finish();
rollback;
