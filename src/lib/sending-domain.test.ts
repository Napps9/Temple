import { describe, expect, it } from 'vitest';

import {
  domainStatusDescription,
  domainStatusMeta,
  fromAddress,
  isApexDomain,
  isFreeEmailDomain,
  mapResendStatus,
  normalizeDomain,
  validateLocalPart,
  validateSendingDomain,
} from './sending-domain';

describe('normalizeDomain', () => {
  it('strips scheme, www, path, trailing dot and lower-cases', () => {
    expect(normalizeDomain('https://www.IronTemple.com/path?x=1')).toBe('irontemple.com');
    expect(normalizeDomain('  MAIL.Gym.CO.UK.  ')).toBe('mail.gym.co.uk');
  });
});

describe('validateSendingDomain', () => {
  it('accepts a normal domain / subdomain', () => {
    expect(validateSendingDomain('mail.irontemple.com')).toEqual({
      ok: true,
      domain: 'mail.irontemple.com',
    });
    expect(validateSendingDomain('Iron-Temple.io')).toEqual({
      ok: true,
      domain: 'iron-temple.io',
    });
  });

  it('rejects empty / malformed input', () => {
    expect(validateSendingDomain('').ok).toBe(false);
    expect(validateSendingDomain('not a domain').ok).toBe(false);
    expect(validateSendingDomain('nodot').ok).toBe(false);
    expect(validateSendingDomain('-bad.com').ok).toBe(false);
    expect(validateSendingDomain('bad-.com').ok).toBe(false);
  });

  it('rejects free email providers with a helpful message', () => {
    const r = validateSendingDomain('gmail.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/free email/i);
    expect(validateSendingDomain('YourName@outlook.com'.replace(/^[^@]*@/, '')).ok).toBe(false);
  });
});

describe('isFreeEmailDomain / isApexDomain', () => {
  it('detects free providers', () => {
    expect(isFreeEmailDomain('gmail.com')).toBe(true);
    expect(isFreeEmailDomain('mail.irontemple.com')).toBe(false);
  });
  it('distinguishes apex from subdomain', () => {
    expect(isApexDomain('irontemple.com')).toBe(true);
    expect(isApexDomain('mail.irontemple.com')).toBe(false);
  });
});

describe('validateLocalPart', () => {
  it('accepts safe local parts and rejects junk', () => {
    expect(validateLocalPart('news')).toEqual({ ok: true, local: 'news' });
    expect(validateLocalPart('Hello.Team_1')).toEqual({ ok: true, local: 'hello.team_1' });
    expect(validateLocalPart('').ok).toBe(false);
    expect(validateLocalPart('has space').ok).toBe(false);
    expect(validateLocalPart('bad@local').ok).toBe(false);
  });
});

describe('fromAddress', () => {
  it('joins local part and domain', () => {
    expect(fromAddress({ from_local: 'news', domain: 'mail.gym.com' })).toBe(
      'news@mail.gym.com',
    );
  });
});

describe('domainStatusMeta', () => {
  it('maps each status to a label + tone', () => {
    expect(domainStatusMeta('verified')).toEqual({ label: 'Verified', tone: 'green' });
    expect(domainStatusMeta('pending').tone).toBe('amber');
    expect(domainStatusMeta('failed').tone).toBe('red');
  });
});

describe('domainStatusDescription', () => {
  it('gives a distinct, non-empty explanation for every status', () => {
    const statuses = ['pending', 'verified', 'failed', 'temporary_failure'] as const;
    const texts = statuses.map(domainStatusDescription);
    for (const t of texts) expect(t.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(statuses.length);
  });
});

describe('mapResendStatus', () => {
  it('normalises Resend statuses onto our enum', () => {
    expect(mapResendStatus('verified')).toBe('verified');
    expect(mapResendStatus('not_started')).toBe('pending');
    expect(mapResendStatus('pending')).toBe('pending');
    expect(mapResendStatus('failed')).toBe('failed');
    expect(mapResendStatus('failure')).toBe('failed');
    expect(mapResendStatus('verifying')).toBe('pending');
    expect(mapResendStatus('temporary_failure')).toBe('temporary_failure');
    expect(mapResendStatus(undefined)).toBe('pending');
    expect(mapResendStatus('weird-new-value')).toBe('pending');
  });
});
