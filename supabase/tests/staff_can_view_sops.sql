-- Invariant: staff can read SOP documents.
--
-- can_view_sops is true for owner/admin/coach/staff. The SQL policy
-- on sop_documents gates SELECT via user_can_access_staff_area,
-- which includes staff. If the gate were user_can_admin_or_coach
-- (the bug the plan called out), staff would be locked out of the
-- documents they're meant to follow.

begin;
select plan(2);

\i tests/_helpers.sql

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
end;
$$;

-- Staff selects: should see the row.
set local request.jwt.claim.sub to (
  select id::text from auth.users where email = 'staff@sops.test'
);
set local role to 'authenticated';

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
