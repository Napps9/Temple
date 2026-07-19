import { supabase } from '@/lib/supabase';

// Push the saved agent config to the gym's Vapi assistant so phone calls
// pick it up. Never throws: the underlying save has already committed, and
// a Vapi outage must not make it look failed.
export async function syncVapiAssistant(gymId: string): Promise<void> {
  try {
    await supabase.functions.invoke('sync-vapi-assistant', {
      body: { gym_id: gymId },
    });
  } catch {
    // best-effort; the next save retries
  }
}
