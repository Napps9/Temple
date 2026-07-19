-- Voice previews for the AI front desk's voice picker. Sample clips are
-- synthesised once per voice by the voice-sample edge function (Azure TTS)
-- and cached here; the bucket is public because the clips are generic
-- marketing audio with zero tenant data, and a public URL lets the picker
-- play them with no signing round-trip.

begin;

insert into storage.buckets (id, name, public)
  values ('agent-voice-samples', 'agent-voice-samples', true)
  on conflict (id) do nothing;

drop policy if exists agent_voice_samples_public_read on storage.objects;
create policy agent_voice_samples_public_read on storage.objects
  for select using (bucket_id = 'agent-voice-samples');

commit;
