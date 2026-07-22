import { describe, expect, it } from 'vitest';

import { toE164UK } from './phone';

describe('toE164UK', () => {
  it('converts a UK local number to E.164', () => {
    expect(toE164UK('07717503791')).toBe('+447717503791');
  });

  it('strips spaces and dashes from a local number', () => {
    expect(toE164UK('07717 503791')).toBe('+447717503791');
    expect(toE164UK('07717-503-791')).toBe('+447717503791');
  });

  it('leaves an already-international number unchanged', () => {
    expect(toE164UK('+447717503791')).toBe('+447717503791');
  });

  it('adds the plus to a bare country-code number', () => {
    expect(toE164UK('447717503791')).toBe('+447717503791');
  });

  it('passes through anything else unchanged', () => {
    expect(toE164UK('12345')).toBe('12345');
  });
});
