-- gym_announcements.closure_id (0257): a notice may point at the closure
-- it is about, but only its own gym's closure (composite FK tenant
-- guard); the member reading it sees their OWN cancelled-class rows for
-- that closure and nobody else's, plus the closure's dates.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner   uuid := _test_mk_user('owner@linked.test');
  v_member  uuid := _test_mk_user('member@linked.test');
  v_member2 uuid := _test_mk_user('member2@linked.test');
  v_out     uuid := _test_mk_user('outsider@linked.test');
  v_gym     uuid := _test_mk_gym('Linked Gym', 'linked-gym');
  v_gym_b   uuid := _test_mk_gym('Other Gym', 'other-gym-linked');
  v_cl      uuid;
  v_cl_b    uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_member, 'member');
  perform _test_mk_membership(v_gym, v_member2, 'member');
  perform _test_mk_membership(v_gym_b, v_out, 'owner');

  insert into public.gym_closures (gym_id, starts_on, ends_on, reason, created_by)
  values (v_gym, date '2026-08-31', date '2026-08-31', 'Bank holiday', v_owner)
  returning id into v_cl;
  insert into public.gym_closures (gym_id, starts_on, ends_on, reason, created_by)
  values (v_gym_b, date '2026-09-01', date '2026-09-01', 'Their closure', v_out)
  returning id into v_cl_b;

  -- The per-member impact rows the closure flow writes (0169), one each.
  insert into public.class_change_notifications
    (gym_id, closure_id, kind, channel, recipient_profile_id, body, status, idempotency_key)
  values
    (v_gym, v_cl, 'gym_closed', 'in_app', v_member,
     'Mon 31 Aug 06:00 Metcon was cancelled.', 'sent', 'linked-test-m1'),
    (v_gym, v_cl, 'gym_closed', 'in_app', v_member2,
     'Mon 31 Aug 07:00 Barbell Club was cancelled.', 'sent', 'linked-test-m2');

  perform set_config('test.gym',    v_gym::text,    false);
  perform set_config('test.owner',  v_owner::text,  false);
  perform set_config('test.member', v_member::text, false);
  perform set_config('test.out',    v_out::text,    false);
  perform set_config('test.cl',     v_cl::text,     false);
  perform set_config('test.cl_b',   v_cl_b::text,   false);
end $$;

-- 1. The owner posts the notice with the closure attached.
select _test_act_as(current_setting('test.owner')::uuid);
select lives_ok(
  $$insert into public.gym_announcements (gym_id, posted_by, title, body, pinned, closure_id)
    values (current_setting('test.gym')::uuid, current_setting('test.owner')::uuid,
            'Closed bank holiday Monday', 'The gym is closed Monday 31 August.',
            true, current_setting('test.cl')::uuid)$$,
  'an announcement can carry its own gym''s closure'
);

-- 2. Another gym's closure is refused by the composite FK, whoever asks.
select throws_ok(
  $$insert into public.gym_announcements (gym_id, posted_by, title, body, closure_id)
    values (current_setting('test.gym')::uuid, current_setting('test.owner')::uuid,
            'Sneaky', 'Wrong tenant', current_setting('test.cl_b')::uuid)$$,
  'insert or update on table "gym_announcements" violates foreign key constraint "gym_announcements_closure_fk"',
  'a cross-gym closure link is a constraint violation'
);

-- 3. The member sees the link on the notice.
select _test_act_as(current_setting('test.member')::uuid);
select results_eq(
  $$select closure_id from public.gym_announcements
     where gym_id = current_setting('test.gym')::uuid
       and closure_id is not null$$,
  $$select current_setting('test.cl')::uuid as closure_id$$,
  'the member reads which closure the notice is about'
);

-- 4. "What changed for you" is the member's own rows only: one, not two.
select results_eq(
  $$select count(*)::integer as n from public.class_change_notifications
     where closure_id = current_setting('test.cl')::uuid
       and recipient_profile_id = auth.uid()$$,
  $$select 1::integer as n$$,
  'the impact query returns only the reader''s own cancelled classes'
);

-- 5. The closure's dates are member-readable for the block's header.
select results_eq(
  $$select starts_on from public.gym_closures
     where id = current_setting('test.cl')::uuid$$,
  $$select date '2026-08-31' as starts_on$$,
  'the member reads the closure window'
);

-- 6. An outsider sees no such announcement at all.
select _test_act_as(current_setting('test.out')::uuid);
select results_eq(
  $$select count(*)::integer as n from public.gym_announcements
     where gym_id = current_setting('test.gym')::uuid$$,
  $$select 0::integer as n$$,
  'the notice stays inside its gym'
);

select * from finish();
rollback;
