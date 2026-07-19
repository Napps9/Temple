-- Voice-channel parity for the AI front desk: the app now pushes prompt,
-- tools, voice and greeting to the gym's Vapi assistant from code
-- (sync-vapi-assistant edge function) instead of a hand-mirrored dashboard
-- config that silently drifted (coaching corrections and owner notes never
-- reached phone calls; the voice picker saved a column Vapi never read).
--
-- recording_notice_at records WHEN the sync last pushed a greeting that
-- includes the "this call is recorded" notice. call_recordings.consent_state
-- is only written as 'notice_played' when this is set — before, the voice
-- webhook fabricated 'notice_played' whether or not any notice existed.
-- Platform-provisioned column (service-role writes only, like phone_number).

begin;

alter table public.gym_agent_settings
  add column if not exists recording_notice_at timestamptz;

commit;
