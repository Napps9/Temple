// Pure helpers for the per-gym sending-domain feature: domain + local-part
// validation, the free-provider blocklist, status display, and the From
// address. Kept dependency-free so it's unit-tested in vitest and shared
// by the settings UI. The `sending-domain` edge function re-enforces the
// domain rules server-side (defence in depth — never trust the client),
// so the blocklist intentionally lives in both places.

import { FQDN_RE, type StatusTone } from './domain-utils';

export type { StatusTone };

export type DomainStatus = 'pending' | 'verified' | 'failed' | 'temporary_failure';

// One DNS record Resend asks the gym to add. We render whatever fields
// are present rather than assuming a fixed shape, so Resend can evolve
// its response without breaking us.
export type DnsRecord = {
  record?: string; // Resend's label, e.g. "DKIM" / "SPF" / "DMARC"
  type?: string; // "TXT" | "MX" | "CNAME"
  name?: string; // host
  value?: string;
  priority?: number;
  ttl?: string;
  status?: string;
};

export type SendingDomain = {
  gym_id: string;
  domain: string;
  from_local: string;
  resend_domain_id: string | null;
  status: DomainStatus;
  records: DnsRecord[];
  last_checked_at: string | null;
  verified_at: string | null;
};

// Free / public mailbox providers. You can't authenticate these as a
// sending domain — sending "as" them through an ESP fails their DMARC —
// so we reject them up front, the same as Mailchimp does post-2024.
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'fastmail.com',
  'pm.me',
]);

// Strip scheme / www / path / trailing dot and lower-case, so paste-y
// input ("https://www.IronTemple.com/") still validates cleanly.
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

export function isFreeEmailDomain(input: string): boolean {
  return FREE_EMAIL_DOMAINS.has(normalizeDomain(input));
}

// A registrable apex (one label + TLD, e.g. "gym.com") vs a subdomain
// ("mail.gym.com"). We don't block apex domains, but the UI nudges toward
// a subdomain — authenticating a subdomain keeps the apex's reputation /
// existing mail (MX, DMARC) untouched.
export function isApexDomain(input: string): boolean {
  return normalizeDomain(input).split('.').length === 2;
}

export type DomainValidation =
  | { ok: true; domain: string }
  | { ok: false; error: string };

export function validateSendingDomain(input: string): DomainValidation {
  const domain = normalizeDomain(input);
  if (!domain) return { ok: false, error: 'Enter a domain.' };
  if (!FQDN_RE.test(domain)) {
    return { ok: false, error: 'That doesn’t look like a valid domain.' };
  }
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return {
      ok: false,
      error:
        'You can’t send from a free email provider. Use a domain you own — a subdomain like mail.yourgym.com is ideal.',
    };
  }
  return { ok: true, domain };
}

export type LocalPartValidation =
  | { ok: true; local: string }
  | { ok: false; error: string };

export function validateLocalPart(input: string): LocalPartValidation {
  const local = input.trim().toLowerCase();
  if (!local) return { ok: false, error: 'Enter a sender name.' };
  if (!/^[a-z0-9._-]{1,64}$/.test(local)) {
    return {
      ok: false,
      error: 'Use only letters, numbers, dots, dashes or underscores.',
    };
  }
  return { ok: true, local };
}

export function fromAddress(d: Pick<SendingDomain, 'from_local' | 'domain'>): string {
  return `${d.from_local}@${d.domain}`;
}

export function domainStatusMeta(status: DomainStatus): {
  label: string;
  tone: StatusTone;
} {
  switch (status) {
    case 'pending':
      return { label: 'Pending verification', tone: 'amber' };
    case 'verified':
      return { label: 'Verified', tone: 'green' };
    case 'temporary_failure':
      return { label: 'Checking…', tone: 'amber' };
    case 'failed':
      return { label: 'Verification failed', tone: 'red' };
  }
}

// Plain-language explanation of what each status means and what the gym
// should do next — the badge alone doesn't tell them whether to wait, act,
// or that they're done.
export function domainStatusDescription(status: DomainStatus): string {
  switch (status) {
    case 'pending':
      return 'Your domain is registered with our email provider. Add the DNS records below at your DNS host to prove you own it, then hit Verify. Until it’s verified, emails still send as a simulation.';
    case 'verified':
      return 'Your domain is authenticated — campaigns and invites now send from your own address.';
    case 'temporary_failure':
      return 'We’re re-checking your DNS with our email provider. This usually clears on its own — check back in a few minutes and verify again.';
    case 'failed':
      return 'We couldn’t confirm your DNS records. Double-check they match the values below exactly, give DNS time to propagate, then verify again.';
  }
}

// Map Resend's domain status strings onto our enum (Resend uses
// not_started / pending / verified / failed / temporary_failure).
export function mapResendStatus(raw: unknown): DomainStatus {
  switch (raw) {
    case 'verified':
      return 'verified';
    case 'failed':
    case 'failure':
      return 'failed';
    case 'temporary_failure':
      return 'temporary_failure';
    case 'pending':
    case 'not_started':
    case 'verifying':
    default:
      return 'pending';
  }
}
