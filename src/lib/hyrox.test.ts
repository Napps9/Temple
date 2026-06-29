import { describe, expect, it } from 'vitest';

import {
  HYROX_BENCHMARKS,
  HYROX_GROUPS,
  HYROX_SIM,
  HYROX_STATIONS,
} from './hyrox';
import {
  allSchemeOptions,
  catalogGroups,
  findMovement,
  findScheme,
  MOVEMENT_GROUPS,
} from './movements';

describe('hyrox catalog', () => {
  it('covers the eight stations plus the 1 km run', () => {
    // 8 stations + the run split = 9 station benchmarks.
    expect(HYROX_STATIONS).toHaveLength(9);
    const keys = HYROX_STATIONS.map((s) => s.key);
    expect(keys).toContain('hyrox_run');
    expect(keys).toContain('hyrox_wall_balls');
    // No duplicate station keys.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every station benchmark is a lower-is-better time', () => {
    for (const s of HYROX_STATIONS) {
      expect(s.scheme.metric).toBe('time');
      expect(s.scheme.better).toBe('lower');
    }
  });

  it('namespaces every hyrox key so it never collides with a crossfit key', () => {
    const crossfitKeys = new Set(
      MOVEMENT_GROUPS.flatMap((g) => g.movements.map((m) => m.key)),
    );
    const hyroxKeys = HYROX_GROUPS.flatMap((g) => g.movements.map((m) => m.key));
    for (const k of hyroxKeys) {
      expect(k.startsWith('hyrox_')).toBe(true);
      expect(crossfitKeys.has(k)).toBe(false);
    }
  });
});

describe('discipline-aware finders', () => {
  it('catalogGroups returns the right catalog per discipline', () => {
    expect(catalogGroups('crossfit')).toBe(MOVEMENT_GROUPS);
    expect(catalogGroups('hyrox')).toBe(HYROX_GROUPS);
  });

  it('resolves a hyrox station through the shared finders', () => {
    const found = findMovement('hyrox_ski_erg');
    expect(found?.movement.name).toBe('SkiErg');
    expect(findScheme('hyrox_ski_erg', '1000m')?.metric).toBe('time');
  });

  it('still resolves a crossfit movement through the shared finders', () => {
    expect(findMovement('back_squat')?.movement.name).toBe('Back Squat');
  });

  it('allSchemeOptions is scoped to the discipline', () => {
    const hyrox = allSchemeOptions('hyrox');
    expect(hyrox.every((o) => o.movementKey.startsWith('hyrox_'))).toBe(true);
    // Full + half sim are both offered.
    expect(hyrox.filter((o) => o.movementKey === 'hyrox_sim')).toHaveLength(
      HYROX_SIM.schemes.length,
    );

    const crossfit = allSchemeOptions('crossfit');
    expect(crossfit.some((o) => o.movementKey === 'back_squat')).toBe(true);
    expect(crossfit.some((o) => o.movementKey.startsWith('hyrox_'))).toBe(false);
  });

  it('every headline benchmark resolves to a real scheme', () => {
    for (const b of HYROX_BENCHMARKS) {
      expect(findScheme(b.movementKey, b.schemeKey)).toBeDefined();
    }
  });
});
