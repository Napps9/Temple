// Owners naturally type their mobile in local UK format (07...) — the
// interview call and other Vapi-facing flows require E.164 (+44...).
// Converts the common local shape so "07717503791" works without the
// owner knowing to add "+44"; anything else passes through unchanged so
// the server's own validation can explain what's actually wrong with it.
export function toE164UK(input: string): string {
  const trimmed = input.trim().replace(/[\s()-]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('0')) return `+44${trimmed.slice(1)}`;
  if (trimmed.startsWith('44')) return `+${trimmed}`;
  return trimmed;
}
