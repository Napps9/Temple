-- Invariant: a comms manager edits a campaign, they do not move it
-- between states.
--
-- email_campaigns_update restricts which ROWS are writable and says
-- nothing about which COLUMNS, so a table-wide UPDATE grant let the same
-- `.update()` the editor autosaves with set status directly — scheduling
-- without comms_schedule_campaign's subject and future-time checks (and,
-- since 0193, without the snapshot the send reads), or marking a draft
-- 'sent' so it reports as delivered to an audience it never reached.
--
-- Column-level grants are invisible in the policy, so they need a test
-- that names the columns; nothing else in the suite would notice them
-- being widened back.

begin;
select plan(5);

\ir _helpers.psql

do $$
declare
  v_owner uuid := _test_mk_user('owner@campcol.test');
  v_gym   uuid := _test_mk_gym('Campaign Columns', 'campcol');
  v_camp  uuid;
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  insert into public.email_campaigns
    (gym_id, created_by, title, subject, status, design, audience)
  values (v_gym, v_owner, 'Draft', 'Subject', 'draft', '{}'::jsonb,
          '{"kind":"all_members"}'::jsonb)
  returning id into v_camp;
  perform set_config('test.owner', v_owner::text, true);
  perform set_config('test.camp',  v_camp::text,  true);
end;
$$;

select _test_act_as(current_setting('test.owner')::uuid);

-- Verbatim the autosave payload from communications/[id].tsx, so this
-- fails if the grant list and the editor ever disagree — which is the
-- whole risk of column-level grants.
select lives_ok(
  format($$ update public.email_campaigns
              set title            = 'Edited',
                  subject          = 'Edited',
                  subject_variants = '["B"]'::jsonb,
                  preheader        = 'Edited',
                  from_name        = 'Coach',
                  design           = '{}'::jsonb,
                  audience         = '{"kind":"staff"}'::jsonb,
                  topic_id         = null,
                  updated_at       = now()
            where id = %L::uuid $$, current_setting('test.camp')),
  'the editor still writes every field it autosaves'
);

select throws_ok(
  format($$ update public.email_campaigns set status = 'sent'
            where id = %L::uuid $$, current_setting('test.camp')),
  '42501',
  null,
  'but cannot mark a draft sent'
);

select throws_ok(
  format($$ update public.email_campaigns
              set status = 'scheduled', scheduled_for = now() + interval '1 day'
            where id = %L::uuid $$, current_setting('test.camp')),
  '42501',
  null,
  'nor schedule one around comms_schedule_campaign'
);

select throws_ok(
  format($$ update public.email_campaigns set recipient_count = 9999
            where id = %L::uuid $$, current_setting('test.camp')),
  '42501',
  null,
  'nor invent a recipient count for the report'
);

-- The RPC is the way through, and it does the checks the direct write
-- skipped.
select lives_ok(
  format($$ select public.comms_schedule_campaign(%L::uuid,
              now() + interval '1 day', '<p>hi</p>', 'hi') $$,
    current_setting('test.camp')),
  'and the RPC still schedules it'
);

select * from finish();
rollback;
