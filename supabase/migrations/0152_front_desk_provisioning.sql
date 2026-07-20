-- Self-serve AI front-desk provisioning (design: docs/ai-front-desk-provisioning.md).
--
-- Today phone_number + vapi_assistant_id are hand-written by an operator with
-- the service key (0136). This adds the columns a provisioning worker needs to
-- own a gym's number end to end — the Twilio number SID and the Vapi
-- phone-number id, so it can tear both down on churn — plus a lifecycle status
-- and an entitlement gate.
--
-- Temple has no platform-billing model yet (all Stripe code is gyms charging
-- their own members via Connect), so front_desk_entitled is an operator-set
-- flag: an owner cannot grant themselves a billed number. When platform billing
-- lands, its webhook flips the same flag with the service key — no rework.
-- provision_status lets the wizard show live state instead of a static
-- "Provisioning" placeholder.

begin;

alter table public.gym_agent_settings
  add column if not exists twilio_number_sid    text,
  add column if not exists vapi_phone_number_id text,
  add column if not exists provisioned_at       timestamptz,
  add column if not exists front_desk_entitled  boolean not null default false,
  add column if not exists provision_status     text not null default 'none'
    check (provision_status in ('none', 'provisioning', 'live', 'failed', 'released'));

-- Operator-set entitlement gate. Service-role only — an owner cannot self-grant
-- a (billed) number. A future platform-billing webhook calls this with the
-- service key to flip entitlement on payment / off on churn.
create or replace function public.set_gym_front_desk_entitled(
  p_gym_id   uuid,
  p_entitled boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.gym_agent_settings (gym_id, front_desk_entitled, updated_at)
  values (p_gym_id, coalesce(p_entitled, false), now())
  on conflict (gym_id) do update
    set front_desk_entitled = excluded.front_desk_entitled,
        updated_at = now();
end;
$$;
revoke execute on function public.set_gym_front_desk_entitled(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_gym_front_desk_entitled(uuid, boolean)
  to service_role;

commit;
