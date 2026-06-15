-- The 0076 wizard's commit path uses effective_can(can_manage_staff) to
-- gate import_pending_members (owner-only by default). The sibling
-- record_import_corrections RPC was looser — user_can_assign_plan, which
-- also admits coaches and staff. Coaches don't see the import surface in
-- the UI but could write into the cross-gym learning store via direct
-- RPC, polluting other gyms' inference inputs.
--
-- Tighten the RPC to match the wizard. Same function body, just the
-- gate predicate is swapped.

begin;

create or replace function public.record_import_corrections(
  p_gym_id uuid,
  p_rows   jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_count   int := 0;
begin
  if not public.effective_can(p_gym_id, 'can_manage_staff') then
    raise exception 'Not authorised';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if (v_row->>'field_kind') not in ('plan', 'tag') then continue; end if;
    if v_row->'input_payload' is null or v_row->'final_value' is null then
      continue;
    end if;
    insert into public.import_inference_corrections
      (field_kind, input_payload, ai_suggestion, final_value,
       was_overridden, gym_id)
    values
      (v_row->>'field_kind',
       v_row->'input_payload',
       case when v_row->'ai_suggestion' is null then null
            else v_row->'ai_suggestion' end,
       v_row->'final_value',
       coalesce((v_row->>'was_overridden')::boolean, false),
       p_gym_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

commit;
