-- Invariant: staff can read SOP documents.
--
-- can_view_sops is true for owner/admin/coach/staff. The SQL policy
-- on sop_documents gates SELECT via user_can_access_staff_area,
-- which includes staff. If the gate were user_can_admin_or_coach
-- (the bug the plan called out), staff would be locked out of the
-- documents they're meant to follow.

begin;
select plan(2);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@sops.test');
  v_staff uuid := _test_mk_user('staff@sops.test');
  v_gym   uuid := _test_mk_gym('SOP Gym', 'sop');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_staff, 'staff');

  insert into public.sop_documents (gym_id, title, body_markdown, author_id)
  values (v_gym, 'Door procedure', '1. Open door.', v_owner);

  -- Act as staff for the SELECTs below.
  -- (SET LOCAL …jwt.claim.sub TO (subquery) is invalid SQL — SET LOCAL
  -- only accepts literals. _test_act_as wraps set_config, which accepts
  -- arbitrary expressions and survives the GUC transaction scope.)
  perform _test_act_as(v_staff);
end;
$$;

select is(
  (select count(*) from public.sop_documents),
  1::bigint,
  'staff can read SOP documents for their gym'
);

select is(
  (select title from public.sop_documents limit 1),
  'Door procedure',
  'staff sees the document content'
);

select * from finish();
rollback;
