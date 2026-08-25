import { describe, expect, it } from 'vitest';

import { firstClassStep } from './first-class';

describe('firstClassStep', () => {
  const base = { staged: true, ready: true, tried: false, pending: false };

  it('books once everything lines up', () => {
    expect(firstClassStep(base)).toBe('book');
  });

  it('waits while nothing is staged', () => {
    expect(firstClassStep({ ...base, staged: false })).toBe('idle');
  });

  // The gates would refuse a booking before the member is ready, and a
  // refused attempt retires the staging — so an early attempt doesn't
  // just fail, it loses the class.
  it('waits until the member is ready', () => {
    expect(firstClassStep({ ...base, ready: false })).toBe('idle');
  });

  it('never books twice', () => {
    expect(firstClassStep({ ...base, tried: true })).toBe('idle');
    expect(firstClassStep({ ...base, pending: true })).toBe('idle');
  });
});
