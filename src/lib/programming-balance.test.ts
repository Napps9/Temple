import { describe, expect, it } from 'vitest';

import {
  classifyProgrammedSection,
  computeBalance,
  computeEnergyMix,
  computePatternEnergyMatrix,
  computePatternMix,
  computeRegionVolume,
  inferDuration,
  untaggedSections,
  type ClassifiedSection,
} from './programming-balance';
import type { Section } from './programming';

// ---------- helpers ----------

function section(partial: Partial<Section>): Section {
  return {
    section_category: 'wod',
    section_format: 'for_time',
    title: '',
    body: '',
    leaderboard_enabled: false,
    ...partial,
  };
}

function classify(
  partial: Partial<Section>,
  date = '2026-06-01',
  classTypeId: string | null = null,
): ClassifiedSection {
  return classifyProgrammedSection(section(partial), date, classTypeId);
}

// ---------- inferDuration ----------

describe('inferDuration', () => {
  it('extracts minute counts from common phrasings', () => {
    expect(inferDuration('20 min amrap')).toBe(20);
    expect(inferDuration('30 minute for time')).toBe(30);
    expect(inferDuration('AMRAP 8 minutes')).toBe(8);
  });

  it('returns null when no duration is present', () => {
    expect(inferDuration('21-15-9 thrusters and pull ups')).toBeNull();
    expect(inferDuration('')).toBeNull();
    expect(inferDuration(undefined)).toBeNull();
  });

  it('never reads metre distances as minutes', () => {
    expect(inferDuration('800m run, then 21-15-9')).toBeNull();
    expect(inferDuration('3 rounds: 400m run + 15 wall balls')).toBeNull();
    expect(inferDuration('Row 2000m')).toBeNull();
  });
});

// ---------- classifyProgrammedSection ----------

describe('classifyProgrammedSection', () => {
  it('merges format energy bias with the movements it detects', () => {
    const c = classify({
      section_format: 'strength_sets',
      body: 'Bench press 5x5',
    });
    expect(c.matched).toBe(true);
    expect(c.movement_keys).toContain('bench_press');
    expect(c.energy_systems).toEqual(['phosphagen']);
    expect(c.patterns).toEqual(['horizontal_push']);
  });

  it('classifies Fran (21-15-9 thrusters + pull ups) as glycolytic squat + vertical pull', () => {
    const c = classify({
      section_format: 'for_time',
      body: '21-15-9 thrusters and pull ups',
    });
    expect(c.movement_keys).toEqual(
      expect.arrayContaining(['thruster', 'kipping_pull_up']),
    );
    expect(c.patterns).toEqual(
      expect.arrayContaining(['squat', 'vertical_push', 'vertical_pull']),
    );
    expect(c.energy_systems).toContain('glycolytic');
  });

  it('upgrades long for_time to oxidative', () => {
    const c = classify({
      section_format: 'for_time',
      body: '30 min for time — 5K run',
    });
    expect(c.energy_systems).toContain('oxidative');
  });

  it('leaves short for_time as glycolytic', () => {
    const c = classify({
      section_format: 'for_time',
      body: '5 min for time — Fran',
    });
    expect(c.energy_systems).toContain('glycolytic');
    expect(c.energy_systems).not.toContain('oxidative');
  });

  it('flags an unmatched body as matched=false', () => {
    const c = classify({
      section_format: 'other',
      body: 'feel out the body and breathe',
    });
    expect(c.matched).toBe(false);
    expect(c.movement_keys).toEqual([]);
  });

  it('classifies a 5K run as gait + oxidative', () => {
    const c = classify({
      section_format: 'for_time',
      body: '5K run for time',
    });
    expect(c.patterns).toContain('gait');
    expect(c.energy_systems).toContain('oxidative');
  });
});

// ---------- aggregations ----------

function fixtureWeek(): ClassifiedSection[] {
  return [
    classify({
      section_format: 'strength_sets',
      body: 'Back squat 5x5',
    }),
    classify({
      section_format: 'for_time',
      body: '21-15-9 thrusters and pull ups',
    }),
    classify({
      section_format: 'for_time',
      body: '30 min for time — 5K run',
    }),
    classify({
      section_format: 'max_load',
      body: 'Deadlift 1RM',
    }),
    classify({
      section_format: 'emom',
      body: 'EMOM 12 — 5 kettlebell swings + 5 wall ball',
    }),
  ];
}

describe('computeEnergyMix', () => {
  it('percentages sum to 100 for a non-empty input', () => {
    const mix = computeEnergyMix(fixtureWeek());
    const sum = mix.reduce((a, m) => a + m.pct, 0);
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
    expect(mix.find((m) => m.system === 'phosphagen')!.count).toBeGreaterThan(0);
    expect(mix.find((m) => m.system === 'glycolytic')!.count).toBeGreaterThan(0);
    expect(mix.find((m) => m.system === 'oxidative')!.count).toBeGreaterThan(0);
  });

  it('returns zeroed buckets for an empty input', () => {
    const mix = computeEnergyMix([]);
    expect(mix.every((m) => m.count === 0 && m.pct === 0)).toBe(true);
    expect(mix.map((m) => m.system)).toEqual([
      'phosphagen',
      'glycolytic',
      'oxidative',
    ]);
  });
});

describe('computePatternMix', () => {
  it('orders by volume descending', () => {
    const mix = computePatternMix(fixtureWeek());
    for (let i = 1; i < mix.length; i++) {
      expect(mix[i].count).toBeLessThanOrEqual(mix[i - 1].count);
    }
  });

  it('surfaces squat, hinge, vertical pull, gait for the fixture week', () => {
    const mix = computePatternMix(fixtureWeek());
    const nonzero = mix.filter((m) => m.count > 0).map((m) => m.pattern);
    expect(nonzero).toEqual(
      expect.arrayContaining(['squat', 'hinge', 'vertical_pull', 'gait']),
    );
  });
});

describe('computeRegionVolume', () => {
  it('counts how many sections touched each region', () => {
    const volume = computeRegionVolume(fixtureWeek());
    expect(volume['quad'] ?? 0).toBeGreaterThan(0);
    expect(volume['glute'] ?? 0).toBeGreaterThan(0);
    expect(volume['hamstring'] ?? 0).toBeGreaterThan(0);
    expect(volume['lower_back'] ?? 0).toBeGreaterThan(0);
  });
});

describe('computeBalance', () => {
  it('captures push:pull and anterior:posterior for the fixture week', () => {
    const balance = computeBalance(fixtureWeek());
    // Mon back squat, Tue thrusters, Fri wall ball + KB swing add push;
    // Tue pull-ups adds pull. Push should outweigh pull.
    expect(balance.push).toBeGreaterThan(0);
    expect(balance.pull).toBeGreaterThan(0);
    expect(balance.posterior).toBeGreaterThan(0);
    expect(balance.anterior).toBeGreaterThan(0);
  });
});

describe('computePatternEnergyMatrix', () => {
  it('cross-tabulates the fixture week into the expected cells', () => {
    const m = computePatternEnergyMatrix(fixtureWeek());
    expect(m.squat.phosphagen).toBeGreaterThan(0); // back squat
    expect(m.hinge.phosphagen).toBeGreaterThan(0); // deadlift 1RM
    expect(m.hinge.glycolytic).toBeGreaterThan(0); // KB swings in EMOM
    expect(m.vertical_pull.glycolytic).toBeGreaterThan(0); // Fran pull ups
    expect(m.gait.oxidative).toBeGreaterThan(0); // 5K run
  });

  it('returns a fully-zeroed grid for empty input', () => {
    const m = computePatternEnergyMatrix([]);
    expect(m.squat.phosphagen).toBe(0);
    expect(m.olympic.glycolytic).toBe(0);
    expect(m.gait.oxidative).toBe(0);
  });
});

describe('untaggedSections', () => {
  it('surfaces sections whose body did not match any movement', () => {
    const sections = [
      classify({ section_format: 'no_score', body: '' }),
      classify({ section_format: 'mobility' as never, body: 'foam rolling' }),
      classify({ section_format: 'strength_sets', body: 'Back squat 5x5' }),
    ];
    const untagged = untaggedSections(sections);
    expect(untagged.length).toBeGreaterThanOrEqual(1);
    expect(untagged.every((s) => !s.matched)).toBe(true);
  });
});
