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

// provision-front-desk's failure reasons, mapped to owner-facing copy. Falls
// back to a generic message for anything not listed (network blips, a
// Twilio/Vapi status code we haven't seen).
export function provisionErrorMessage(reason: string | undefined): string {
  if (!reason) return "Couldn't set up your number. It's safe to try again.";
  if (reason === 'not_entitled') {
    return "Phone & text isn't on your plan yet — contact Temple to turn it on.";
  }
  if (reason === 'no_numbers_available') {
    return 'No UK numbers were available just then — try again in a moment.';
  }
  if (reason === 'not_configured') {
    return "Number provisioning isn't set up on Temple's side yet — contact Temple.";
  }
  return "Something went wrong setting up your number. No number was bought twice — it's safe to try again.";
}

// Unlike syncVapiAssistant, this DOES throw — the caller needs to know
// whether a number/assistant actually got created, not fire-and-forget.
export async function provisionFrontDesk(gymId: string): Promise<{ number: string }> {
  const { data, error } = await supabase.functions.invoke('provision-front-desk', {
    body: { gym_id: gymId },
  });
  if (error) throw error;
  if (!data?.provisioned) throw new Error(provisionErrorMessage(data?.reason));
  return { number: data.number as string };
}

export async function deprovisionFrontDesk(gymId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('deprovision-front-desk', {
    body: { gym_id: gymId },
  });
  if (error) throw error;
  if (!data?.released) throw new Error("Couldn't turn off the AI front desk. Try again.");
}
