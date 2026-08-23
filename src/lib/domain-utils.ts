// Shared primitives for the two domain-connection features (email
// sending domains via Resend).
// Pure and dependency-free. The two edge functions keep their own Deno
// copies of FQDN_RE (they can't import src/) — keep them in sync:
// supabase/functions/sending-domain/index.ts,
// supabase/functions/custom-domain/index.ts.

// A conservative but standards-shaped FQDN check: 1-63 char labels of
// [a-z0-9-] (no leading/trailing hyphen), at least one dot, an alpha TLD.
export const FQDN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type StatusTone = 'amber' | 'green' | 'red';

// The loosest record shape either provider returns; the UI renders
// whatever fields are present rather than assuming a fixed schema.
export type DnsRecordDisplay = {
  record?: string; // provider label, e.g. Resend's "DKIM" / "SPF"
  type?: string;
  name?: string;
  value?: string;
  priority?: number;
  note?: string; // server-authored guidance rendered under the record
};
