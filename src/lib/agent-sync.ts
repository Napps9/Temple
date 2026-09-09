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
export function provisionErrorMessage(
  reason: string | undefined,
  detail?: string | null,
): string {
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
  if (reason === 'bundle_not_approved') {
    return "Temple's UK number paperwork with Twilio isn't approved yet — contact Temple.";
  }
  const said = detail ? ` The provider said: "${detail.replace(/\.$/, '')}".` : '';
  return `Something went wrong setting up your number.${said} No number was bought twice — it's safe to try again.`;
}

// supabase-js throws a FunctionsHttpError for any non-2xx and its message
// is the literal "Edge Function returned a non-2xx status code" — the body,
// which is where the function put the reason, is on error.context and is
// otherwise thrown away. That cost an afternoon: a 409 saying "this is a
// demo gym" was rendered to an owner as that generic sentence.
async function edgeErrorBody(
  error: unknown,
): Promise<{ error?: string; reason?: string; detail?: string } | null> {
  const res = (error as { context?: unknown })?.context;
  if (!(res instanceof Response)) return null;
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

// Unlike syncVapiAssistant, this DOES throw — the caller needs to know
// whether a number/assistant actually got created, not fire-and-forget.
export async function provisionFrontDesk(gymId: string): Promise<{ number: string }> {
  const { data, error } = await supabase.functions.invoke('provision-front-desk', {
    body: { gym_id: gymId },
  });
  if (error) {
    const body = await edgeErrorBody(error);
    throw new Error(body?.error ?? provisionErrorMessage(body?.reason, body?.detail));
  }
  if (!data?.provisioned) throw new Error(provisionErrorMessage(data?.reason, data?.detail));
  return { number: data.number as string };
}

export async function deprovisionFrontDesk(gymId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('deprovision-front-desk', {
    body: { gym_id: gymId },
  });
  if (error) {
    const body = await edgeErrorBody(error);
    throw new Error(body?.error ?? "Couldn't turn off the AI front desk. Try again.");
  }
  if (!data?.released) throw new Error("Couldn't turn off the AI front desk. Try again.");
}
