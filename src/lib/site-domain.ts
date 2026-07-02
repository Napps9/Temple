// Pure helpers for the per-gym custom domain feature: domain
// normalization/validation and status display. Kept dependency-free
// (no @/lib/supabase import) so it's unit-tested in vitest directly,
// mirroring src/lib/sending-domain.ts's split from src/lib/comms.ts —
// that file can't be unit-tested as-is because importing it pulls in
// react-native-url-polyfill/AsyncStorage via @/lib/supabase.

export type CustomDomainStatus = 'pending' | 'verified' | 'error';

export type DnsRecord = { type: string; name: string; value: string; priority?: number };

// A conservative but standards-shaped FQDN check: 1-63 char labels of
// [a-z0-9-] (no leading/trailing hyphen), at least one dot, an alpha TLD.
// Deliberately does NOT strip a leading "www." — unlike an email sending
// domain (where www is just noise on the DNS host), "www.gym.com" and
// "gym.com" are two different values a visitor's browser actually hits.
const FQDN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

export type DomainValidation = { ok: true; domain: string } | { ok: false; error: string };

export function validateCustomDomain(input: string): DomainValidation {
  const domain = normalizeDomain(input);
  if (!domain) return { ok: false, error: 'Enter a domain.' };
  if (!FQDN_RE.test(domain)) {
    return { ok: false, error: 'That doesn’t look like a valid domain.' };
  }
  return { ok: true, domain };
}

export type StatusTone = 'gray' | 'amber' | 'green' | 'red';

export function domainStatusMeta(status: CustomDomainStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'pending':
      return { label: 'Pending verification', tone: 'amber' };
    case 'verified':
      return { label: 'Verified', tone: 'green' };
    case 'error':
      return { label: 'Verification failed', tone: 'red' };
  }
}

// Plain-language explanation of what each status means and what the gym
// should do next — the badge alone doesn't say whether to wait, act, or
// that they're done.
export function domainStatusDescription(status: CustomDomainStatus): string {
  switch (status) {
    case 'pending':
      return 'Your domain is registered. Add the DNS records below at your domain registrar to prove you own it, then hit Verify. This can take a few minutes — occasionally up to 48 hours.';
    case 'verified':
      return 'Your domain is connected — your site now serves directly from it, with SSL handled automatically.';
    case 'error':
      return 'We couldn’t confirm your DNS records. Double-check they match the values below exactly, give DNS time to propagate, then verify again.';
  }
}
