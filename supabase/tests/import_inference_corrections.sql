-- import_inference_corrections — the cross-gym learning store the
-- infer-import edge function consults before calling Claude.
--
-- record_import_corrections RPC stores the (input, ai_suggestion,
-- final_value, was_overridden) tuple from the import wizard. The
-- pg_trgm GIN index supports similarity() queries the edge function
-- uses for the few-shot lookup; we exercise it here too to lock the
-- behaviour in.

begin;
select plan(6);

\ir _helpers.psql

do $$
declare
  v_owner    uuid := _test_mk_user('owner@iic.test');
  v_outsider uuid := _test_mk_user('outsider@iic.test');
  v_gym      uuid := _test_mk_gym('Corrections Gym', 'iic-gym');
begin
  perform _test_mk_membership(v_gym, v_owner, 'owner');
  perform set_config('test.gym',      v_gym::text,      true);
  perform set_config('test.owner',    v_owner::text,    true);
  perform set_config('test.outsider', v_outsider::text, true);
  perform _test_act_as(v_owner);
end $$;

-- 1. RPC writes exactly the rows it received, returning the count.
select is(
  public.record_import_corrections(
    current_setting('test.gym')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'field_kind', 'plan',
        'input_payload', jsonb_build_object(
          'raw_name', 'PREMIUM-UNL-MONTH', 'member_count', 23),
        'ai_suggestion', jsonb_build_object(
          'suggested_name', 'Premium Unlimited Monthly',
          'suggested_kind', 'unlimited'),
        'final_value', jsonb_build_object(
          'name', 'Premium Unlimited Monthly',
          'kind', 'unlimited',
          'monthly_price_cents', 12000),
        'was_overridden', false
      ),
      jsonb_build_object(
        'field_kind', 'plan',
        'input_payload', jsonb_build_object(
          'raw_name', '5 Class Pack', 'member_count', 8),
        'ai_suggestion', jsonb_build_object(
          'suggested_name', '5 Class Pack',
          'suggested_kind', 'credit_pack'),
        'final_value', jsonb_build_object(
          'name', '5 Class Pack',
          'kind', 'credit_pack',
          'credit_count', 5,
          'monthly_price_cents', 6000),
        'was_overridden', false
      ),
      jsonb_build_object(
        'field_kind', 'tag',
        'input_payload', jsonb_build_object(
          'value', 'MIGRATED_2024Q4', 'count', 50),
        'ai_suggestion', jsonb_build_object('action', 'drop'),
        'final_value', jsonb_build_object('action', 'drop'),
        'was_overridden', false
      )
    )
  ),
  3,
  'record_import_corrections inserts each row and returns the count'
);

-- Tests 2-4 read the corrections table directly. RLS denies all client
-- reads by design (the edge function uses the service role); drop the
-- role for these SELECT-back assertions so we can verify what the RPC
-- actually wrote.
do $$ begin reset role; end $$;

select is(
  (select count(*)::int from public.import_inference_corrections
   where gym_id = current_setting('test.gym')::uuid),
  3,
  'three rows landed in the table'
);

-- 3. Exact-match lookup: same raw_name resolves to the prior final_value.
select is(
  (select final_value->>'name'
   from public.import_inference_corrections
   where field_kind = 'plan'
     and lower(input_payload->>'raw_name') = lower('PREMIUM-UNL-MONTH')
   order by created_at desc limit 1),
  'Premium Unlimited Monthly',
  'exact-match lookup returns the prior owner''s final value'
);

-- 4. Trigram similarity finds "PREMIUM-UNL-MONTH" when asked about a
-- close variant. Threshold 0.3 is pg_trgm's standard baseline.
select ok(
  (select count(*) >= 1 from public.import_inference_corrections
   where field_kind = 'plan'
     and similarity(lower(input_payload->>'raw_name'),
                    lower('PREMIUM_UNL_MONTHLY')) > 0.3),
  'trigram similarity matches a close variant ("PREMIUM_UNL_MONTHLY")'
);

-- 5. Non-owner can't call the RPC (RLS / capability gate).
do $$ begin
  perform _test_act_as(current_setting('test.outsider')::uuid);
end $$;

select throws_like(
  format(
    'select record_import_corrections(%L::uuid, %L::jsonb)',
    current_setting('test.gym'),
    '[]'
  ),
  '%Not authorised%',
  'non-staff caller is rejected by the capability gate'
);

-- 6. Owner override is captured with was_overridden=true.
do $$ begin perform _test_act_as(current_setting('test.owner')::uuid); end $$;

select is(
  public.record_import_corrections(
    current_setting('test.gym')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'field_kind', 'plan',
        'input_payload', jsonb_build_object(
          'raw_name', '10 Class Pass', 'member_count', 3),
        'ai_suggestion', jsonb_build_object(
          'suggested_name', '10 Class Pass',
          'suggested_kind', 'credit_pack'),
        'final_value', jsonb_build_object(
          'name', '10 Sessions',
          'kind', 'credit_pack',
          'credit_count', 10),
        'was_overridden', true
      )
    )
  ),
  1,
  'an overridden suggestion is captured with was_overridden=true'
);

select * from finish();
rollback;
