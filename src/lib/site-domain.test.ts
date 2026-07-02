import { describe, expect, it } from 'vitest';

import {
  domainStatusDescription,
  domainStatusMeta,
  normalizeDomain,
  validateCustomDomain,
} from './site-domain';

describe('normalizeDomain', () => {
  it('strips scheme, path, trailing dot and lower-cases, but keeps www', () => {
    expect(normalizeDomain('https://www.IronTemple.com/path?x=1')).toBe('www.irontemple.com');
    expect(normalizeDomain('  Gym.CO.UK.  ')).toBe('gym.co.uk');
  });
});

describe('validateCustomDomain', () => {
  it('accepts an apex domain, a subdomain, and a www domain distinctly', () => {
    expect(validateCustomDomain('irontemple.com')).toEqual({
      ok: true,
      domain: 'irontemple.com',
    });
    expect(validateCustomDomain('www.irontemple.com')).toEqual({
      ok: true,
      domain: 'www.irontemple.com',
    });
    expect(validateCustomDomain('Iron-Temple.io')).toEqual({
      ok: true,
      domain: 'iron-temple.io',
    });
  });

  it('rejects empty / malformed input', () => {
    expect(validateCustomDomain('').ok).toBe(false);
    expect(validateCustomDomain('not a domain').ok).toBe(false);
    expect(validateCustomDomain('nodot').ok).toBe(false);
    expect(validateCustomDomain('-bad.com').ok).toBe(false);
    expect(validateCustomDomain('bad-.com').ok).toBe(false);
  });
});

describe('domainStatusMeta', () => {
  it('maps each status to a label + tone', () => {
    expect(domainStatusMeta('verified')).toEqual({ label: 'Verified', tone: 'green' });
    expect(domainStatusMeta('pending').tone).toBe('amber');
    expect(domainStatusMeta('error').tone).toBe('red');
  });
});

describe('domainStatusDescription', () => {
  it('gives a distinct, non-empty explanation for every status', () => {
    const statuses = ['pending', 'verified', 'error'] as const;
    const texts = statuses.map(domainStatusDescription);
    for (const t of texts) expect(t.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(statuses.length);
  });
});
