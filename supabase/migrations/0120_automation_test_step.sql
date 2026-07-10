-- Let "send a test" target a follow-up step, not just the primary email.
--
-- send_automation_test (0116) enqueued a test run for the automation's primary
-- email only. With sequences (0119) an owner also wants to preview a specific
-- follow-up. Add an optional p_step_id: null keeps the primary behaviour, a
-- step id enqueues a test whose content the worker reads from that step (via
-- email_automation_runs.step_id).
--
-- Arity changes, so drop the 1-arg form first (CREATE OR REPLACE can't, and
-- keeping both would make send_automation_test(uuid) ambiguous against the new
-- default arg).

begin;

drop function if exists public.send_automation_test(uuid);

create function public.send_automation_test(p_automation_id uuid, p_step_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym   uuid;
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  select gym_id into v_gym from public.email_automations where id = p_automation_id;
  if v_gym is null then
    raise exception 'Automation not found';
  end if;
  if not public.effective_can(v_gym, 'can_manage_comms') then
    raise exception 'Not authorised';
  end if;
  if p_step_id is not null and not exists (
    select 1 from public.email_automation_steps
    where id = p_step_id and automation_id = p_automation_id
  ) then
    raise exception 'Step does not belong to this automation';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'Your account has no email address';
  end if;

  insert into public.email_automation_runs
    (gym_id, automation_id, step_id, subject_profile_id, recipient_email, recipient_name,
     status, idempotency_key, scheduled_at)
  values
    (v_gym, p_automation_id, p_step_id, v_uid, v_email, null, 'queued',
     'auto:' || p_automation_id || ':test:' || gen_random_uuid(),
     now());
end;
$$;
grant execute on function public.send_automation_test(uuid, uuid) to authenticated;

commit;
