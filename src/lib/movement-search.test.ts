import { describe, expect, it } from 'vitest';

import {
  allGroupsDisciplineFirst,
  catalogGroups,
  searchMovements,
} from './movements';

describe('searchMovements', () => {
  it('returns nothing for an empty query', () => {
    expect(searchMovements('')).toEqual([]);
    expect(searchMovements('   ')).toEqual([]);
  });

  it('matches on movement name, case-insensitively', () => {
    const hits = searchMovements('BACK squat');
    expect(hits.some((h) => h.movement.name.toLowerCase() === 'back squat')).toBe(
      true,
    );
  });

  it('matches on aliases', () => {
    // "single under" is registered as an alias of Double Unders.
    const hits = searchMovements('single under');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('spans disciplines (finds Hyrox movements regardless of gym flavour)', () => {
    const hits = searchMovements('skierg');
    expect(hits.some((h) => h.movement.key.startsWith('hyrox_'))).toBe(true);
  });
});

describe('allGroupsDisciplineFirst', () => {
  it('pins the gym discipline groups first, then the rest, with no dupes', () => {
    const ordered = allGroupsDisciplineFirst('hyrox');
    const own = catalogGroups('hyrox');
    expect(ordered.slice(0, own.length).map((g) => g.key)).toEqual(
      own.map((g) => g.key),
    );
    const keys = ordered.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Includes at least one CrossFit group too.
    expect(ordered.length).toBeGreaterThan(own.length);
  });
});
