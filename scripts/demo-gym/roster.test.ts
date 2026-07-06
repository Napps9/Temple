import { describe, expect, it } from 'vitest';

import { MAX_MEMBERS, demoUuid, memberNames, mulberry32 } from './roster';

describe('mulberry32', () => {
  it('is deterministic for a given seed and varies across seeds', () => {
    const a1 = mulberry32(42);
    const a2 = mulberry32(42);
    const b = mulberry32(7);
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const v of seqA1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('demoUuid', () => {
  it('produces valid, deterministic v4-shaped uuids', () => {
    const rng = mulberry32(1);
    const u1 = demoUuid(rng);
    const u2 = demoUuid(rng);
    expect(u1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(u2).not.toBe(u1);
    const rngAgain = mulberry32(1);
    expect(demoUuid(rngAgain)).toBe(u1);
  });
});

describe('memberNames', () => {
  it('covers the maximum roster with distinct full names', () => {
    const names = memberNames(MAX_MEMBERS);
    const fullNames = names.map((n) => `${n.first} ${n.last}`);
    expect(new Set(fullNames).size).toBe(MAX_MEMBERS);
    expect(MAX_MEMBERS).toBeGreaterThanOrEqual(40);
  });
});
