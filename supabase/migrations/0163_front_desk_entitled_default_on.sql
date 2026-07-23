-- Flip front_desk_entitled from an opt-in allowlist to an opt-out one.
--
-- 0152 built this as a billing-readiness placeholder: Temple had no
-- platform-billing model, so an owner couldn't be trusted to self-grant a
-- number that would cost real Twilio/Vapi money with nothing charging them
-- for it. That's no longer the situation — Temple charges a flat monthly
-- fee per gym via manual invoice, so every gym on the platform is already
-- a paying customer and the AI front desk needs no separate gate. Default
-- flips to true, and every existing gym is backfilled the same way.
--
-- The flag and set_gym_front_desk_entitled itself stay: still useful as a
-- manual off-switch for a specific gym (non-payment, abuse) without
-- touching the provisioning code path. provision-front-desk (the edge
-- function) and the two client read sites are updated in this same change
-- to treat a row with no explicit false the same way — entitled.

begin;

alter table public.gym_agent_settings
  alter column front_desk_entitled set default true;

update public.gym_agent_settings
  set front_desk_entitled = true, updated_at = now()
  where front_desk_entitled = false;

commit;
