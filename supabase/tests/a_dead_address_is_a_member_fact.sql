-- An address that bounces is a fact about a member (0230)
--
-- The line this pins: a coach may learn that a member cannot be emailed,
-- and may not learn what their email address is. Those are two different
-- permissions and 0178 separated them on purpose.

begin;
select plan(9);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@deadaddr.test');
  v_coach uuid := _test_mk_user('coach@deadaddr.test');
  v_gone  uuid := _test_mk_user('gone@deadaddr.test');
  v_fine  uuid := _test_mk_user('fine@deadaddr.test');
  v_other uuid := _test_mk_user('other@deadaddr.test');
  v_gym   uuid := _test_mk_gym('Dead Address Gym', 'deadaddr');
  v_gym2  uuid := _test_mk_gym('Other Gym', 'deadaddr2');
  v_camp  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform _test_mk_membership(v_gym, v_coach, 'coach');
  perform _test_mk_membership(v_gym, v_gone, 'member');
  perform _test_mk_membership(v_gym, v_fine, 'member');
  perform _test_mk_membership(v_gym2, v_other, 'owner');

  insert into public.email_campaigns (gym_id, created_by, title, subject, status, sent_at)
  values (v_gym, v_owner, 'Christmas hours', 'Christmas hours', 'sent', now())
  returning id into v_camp;

  insert into public.email_campaign_recipients
    (campaign_id, gym_id, profile_id, email, status, sent_at, provider_message_id)
  values
    (v_camp, v_gym, v_gone, 'gone@deadaddr.test', 'sent', now(), 'msg-gone'),
    (v_camp, v_gym, v_fine, 'fine@deadaddr.test', 'sent', now(), 'msg-fine'),
    -- Imported, never signed up: suppressed, but no member to show it on.
    (v_camp, v_gym, null,   'ghost@deadaddr.test', 'sent', now(), 'msg-ghost');

  perform set_config('test.gym',   v_gym::text,   true);
  perform set_config('test.gym2',  v_gym2::text,  true);
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.coach', v_coach::text, true);
  perform set_config('test.other', v_other::text, true);
  perform set_config('test.gone',  v_gone::text,  true);
  perform set_config('test.fine',  v_fine::text,  true);
end $$;

select public.comms_apply_delivery_event('msg-gone', 'bounced', true, 'NoEmail: no such mailbox');
select public.comms_apply_delivery_event('msg-ghost', 'bounced', true, 'NoEmail: no such mailbox');
select public.comms_apply_delivery_event('msg-fine', 'delivered');

-- ---------------------------------------------------------------------------
-- The suppression knows whose it is
-- ---------------------------------------------------------------------------

select is(
  (select profile_id from public.email_suppressions
     where gym_id = current_setting('test.gym')::uuid
       and lower(email) = 'gone@deadaddr.test'),
  current_setting('test.gone')::uuid,
  'a bounce is recorded against the member it belonged to'
);

select is(
  (select profile_id from public.email_suppressions
     where gym_id = current_setting('test.gym')::uuid
       and lower(email) = 'ghost@deadaddr.test'),
  null,
  'and an imported address that never became a member has nobody to belong to'
);

-- ---------------------------------------------------------------------------
-- A coach may know, without knowing the address
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.coach')::uuid);

select is(
  (select reason from public.gym_unreachable_emails(
     current_setting('test.gym')::uuid, current_setting('test.gone')::uuid)),
  'hard_bounce',
  'a coach chasing an absent member learns the email will not land'
);

select is(
  (select count(*)::int from public.gym_unreachable_emails(
     current_setting('test.gym')::uuid, current_setting('test.fine')::uuid)),
  0,
  'and gets nothing back for a member whose address works'
);

select throws_ok(
  format('select * from public.gym_member_contact(%L::uuid, %L::uuid)',
         current_setting('test.gym'), current_setting('test.gone')),
  null, 'Not authorised',
  'while the address itself is still a permission they do not have'
);

select is(
  (select count(*)::int from public.gym_unreachable_emails(
     current_setting('test.gym')::uuid)),
  1,
  'the list form returns only the ones with a member behind them'
);

-- ---------------------------------------------------------------------------
-- Somebody else's gym
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.other')::uuid);

select throws_ok(
  format('select * from public.gym_unreachable_emails(%L::uuid)', current_setting('test.gym')),
  null, 'Not authorised',
  'an owner of another gym is refused outright'
);

-- ---------------------------------------------------------------------------
-- Clearing it
-- ---------------------------------------------------------------------------

select _test_act_as(current_setting('test.owner')::uuid);

select lives_ok(
  format(
    'delete from public.email_suppressions where gym_id = %L::uuid and profile_id = %L::uuid',
    current_setting('test.gym'), current_setting('test.gone')
  ),
  'an owner who knows the address was a typo can clear it'
);

select is(
  (select count(*)::int from public.gym_unreachable_emails(
     current_setting('test.gym')::uuid, current_setting('test.gone')::uuid)),
  0,
  'and the member stops looking unreachable'
);

select * from finish();
rollback;
