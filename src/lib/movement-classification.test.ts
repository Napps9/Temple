import { describe, expect, it } from 'vitest';

import {
  BODY_REGIONS,
} from './injuries';
import {
  classifyMovement,
  MOVEMENT_CLASSIFICATIONS,
  patternsOf,
  type MovementClassification,
} from './movement-classification';
import { HYROX_GROUPS } from './hyrox';
import { MOVEMENT_GROUPS } from './movements';

const VALID_REGION_KEYS = new Set(BODY_REGIONS.map((r) => r.key));

function everyCatalogMovementKey(): string[] {
  const keys: string[] = [];
  for (const g of [...MOVEMENT_GROUPS, ...HYROX_GROUPS])
    for (const m of g.movements) keys.push(m.key);
  return keys;
}

describe('MOVEMENT_CLASSIFICATIONS — completeness', () => {
  it('has an entry for every movement in the catalog', () => {
    const missing = everyCatalogMovementKey().filter(
      (k) => !MOVEMENT_CLASSIFICATIONS[k],
    );
    expect(missing).toEqual([]);
  });

  it('every classification has a pattern, at least one energy system, and at least one region', () => {
    for (const [k, c] of Object.entries(MOVEMENT_CLASSIFICATIONS)) {
      expect(c.pattern, `${k} pattern`).toBeTruthy();
      expect(c.energy_systems.length, `${k} energy_systems`).toBeGreaterThan(0);
      expect(c.primary_regions.length, `${k} primary_regions`).toBeGreaterThan(0);
    }
  });

  it('every primary_region key references a real BODY_REGIONS key', () => {
    for (const [k, c] of Object.entries(MOVEMENT_CLASSIFICATIONS)) {
      for (const r of c.primary_regions) {
        expect(VALID_REGION_KEYS.has(r), `${k} → ${r}`).toBe(true);
      }
    }
  });

  it('does not double-list the same pattern as both primary and secondary', () => {
    for (const [k, c] of Object.entries(MOVEMENT_CLASSIFICATIONS)) {
      if (c.secondary) expect(c.pattern, k).not.toBe(c.secondary);
    }
  });
});

describe('classifyMovement spot checks', () => {
  function expectClass(
    key: string,
    expected: Partial<MovementClassification>,
  ) {
    const c = classifyMovement(key);
    expect(c, `${key} missing`).toBeDefined();
    if (!c) return;
    for (const [k, v] of Object.entries(expected)) {
      expect(c[k as keyof MovementClassification], `${key}.${k}`).toEqual(v);
    }
  }

  it('classifies foundational lifts the way a coach would', () => {
    expectClass('back_squat', {
      pattern: 'squat',
      energy_systems: ['phosphagen'],
      primary_regions: ['quad', 'glute', 'lower_back'],
      dominance: 'anterior',
    });
    expectClass('deadlift', {
      pattern: 'hinge',
      dominance: 'posterior',
    });
    expectClass('bench_press', {
      pattern: 'horizontal_push',
      dominance: 'anterior',
    });
    expectClass('strict_press', { pattern: 'vertical_push' });
  });

  it('flags double-pattern movements with a secondary', () => {
    expectClass('thruster', {
      pattern: 'squat',
      secondary: 'vertical_push',
    });
    expectClass('wall_ball', {
      pattern: 'squat',
      secondary: 'vertical_push',
    });
    expectClass('burpee', { pattern: 'core', secondary: 'horizontal_push' });
    expect(patternsOf('thruster')).toEqual(['squat', 'vertical_push']);
  });

  it('classifies the Hyrox stations the way the race trains them', () => {
    expectClass('hyrox_sled_push', {
      pattern: 'gait',
      secondary: 'horizontal_push',
      dominance: 'anterior',
    });
    expectClass('hyrox_farmers_carry', { pattern: 'carry' });
    expectClass('hyrox_wall_balls', {
      pattern: 'squat',
      secondary: 'vertical_push',
    });
    expectClass('hyrox_sim', {
      pattern: 'gait',
      energy_systems: ['oxidative'],
    });
  });

  it('classifies aerobic and gait work', () => {
    expectClass('running', {
      pattern: 'gait',
      energy_systems: ['oxidative'],
      primary_regions: ['quad', 'hamstring', 'calf'],
    });
    expectClass('rowing', {
      pattern: 'monostructural',
      dominance: 'posterior',
    });
    expect(patternsOf('running')).toEqual(['gait']);
  });

  it('classifies KB swing as a posterior-chain hinge with metcon bias', () => {
    expectClass('kettlebell_swing', {
      pattern: 'hinge',
      dominance: 'posterior',
    });
    expect(
      classifyMovement('kettlebell_swing')?.energy_systems,
    ).toContain('glycolytic');
  });

  it('classifies olympic lifts with a hinge secondary', () => {
    for (const k of ['power_clean', 'squat_clean', 'power_snatch']) {
      const c = classifyMovement(k);
      expect(c?.pattern, k).toBe('olympic');
      expect(c?.secondary, k).toBe('hinge');
    }
  });
});
