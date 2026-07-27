import { describe, expect, it } from 'vitest';

// Mirrors originHost/hostAllowed in supabase/functions/_shared/caller.ts.
// Re-pasted rather than imported because that file is Deno-only (esm.sh
// imports vitest cannot resolve) — the same arrangement as
// src/lib/email/personalize.test.ts. Keep the two in sync.
function originHost(supplied: string | undefined, fallback: string): string | null {
  const clean = (supplied ?? '').replace(/\/+$/, '');
  if (!clean || clean === fallback) return null;
  try {
    const u = new URL(clean);
    if (u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostAllowed(host: string, domain: string | null): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

const APP = 'https://app.jointemple.io';

describe('originHost', () => {
  it('treats the configured app URL as needing no further checking', () => {
    expect(originHost(APP, APP)).toBeNull();
    expect(originHost(`${APP}/`, APP)).toBeNull();
  });

  it('rejects a non-https origin', () => {
    expect(originHost('http://evil.example', APP)).toBeNull();
  });

  it('rejects junk that is not a URL at all', () => {
    expect(originHost('not a url', APP)).toBeNull();
    expect(originHost(undefined, APP)).toBeNull();
  });

  it('lowercases the host so a mixed-case domain still matches', () => {
    expect(originHost('https://Gym.Example.COM', APP)).toBe('gym.example.com');
  });
});

describe('hostAllowed', () => {
  it('matches the gym own domain and its subdomains', () => {
    expect(hostAllowed('gym.example.com', 'gym.example.com')).toBe(true);
    expect(hostAllowed('www.gym.example.com', 'gym.example.com')).toBe(true);
  });

  // The attack this exists to stop: a payment email whose only link is the
  // caller's, sent from the gym's own verified domain to its members.
  it('does not match a lookalike that merely ends in the same letters', () => {
    expect(hostAllowed('evilgym.example.com', 'gym.example.com')).toBe(false);
    expect(hostAllowed('gym.example.com.evil.test', 'gym.example.com')).toBe(false);
  });

  it('matches nothing when the gym has no verified domain', () => {
    expect(hostAllowed('anything.test', null)).toBe(false);
  });
});
