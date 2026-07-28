import { describe, expect, it } from 'vitest';

import {
  applyAiTag,
  computeLoadMix,
  computeTimeDomainMix,
  correlateAiTags,
  dedupeSections,
  fingerprintDigest,
  movementVocab,
  parseAiTag,
  sectionFingerprint,
  type AiSectionTag,
  type TaggedSection,
} from './programming-ai-tags';
import { classifyProgrammedSection } from './programming-balance';
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

function tag(partial: Partial<AiSectionTag>): AiSectionTag {
  return {
    movement_keys: [],
    duration_minutes: null,
    load_level: null,
    confidence: 'high',
    ...partial,
  };
}

function tagged(
  partial: Partial<Section>,
  aiTag: AiSectionTag | undefined,
): TaggedSection {
  const s = section(partial);
  return applyAiTag(classifyProgrammedSection(s, '2026-06-01', null), s, aiTag);
}

// ---------- sectionFingerprint ----------

describe('sectionFingerprint', () => {
  it('normalises case and whitespace so cosmetic edits share a fingerprint', () => {
    const a = sectionFingerprint(
      section({ title: 'Heavy Day', body: '5x5  Back Squat' }),
    );
    const b = sectionFingerprint(
      section({ title: '  heavy day ', body: '5x5 back   squat' }),
    );
    expect(a).toBe(b);
  });

  it('keeps different formats distinct even with identical text', () => {
    const a = sectionFingerprint(
      section({ section_format: 'amrap', body: '10 wall balls' }),
    );
    const b = sectionFingerprint(
      section({ section_format: 'emom', body: '10 wall balls' }),
    );
    expect(a).not.toBe(b);
  });
});

// ---------- parseAiTag ----------

describe('parseAiTag', () => {
  it('keeps only movement keys the classifier recognises', () => {
    const parsed = parseAiTag(
      tag({ movement_keys: ['back_squat', 'made_up_lift', 'hyrox_row'] }),
    );
    expect(parsed?.movement_keys).toEqual(['back_squat']);
  });

  it('drops out-of-range durations and unknown load levels', () => {
    const parsed = parseAiTag({
      movement_keys: [],
      duration_minutes: 100000,
      load_level: 'crushing',
      confidence: 'high',
    });
    expect(parsed?.duration_minutes).toBeNull();
    expect(parsed?.load_level).toBeNull();
    expect(parseAiTag(tag({ duration_minutes: 0 }))?.duration_minutes).toBeNull();
    expect(parseAiTag(tag({ duration_minutes: 0.4 }))?.duration_minutes).toBeNull();
    expect(parseAiTag(tag({ duration_minutes: -5 }))?.duration_minutes).toBeNull();
  });

  it('range-checks before rounding, then rounds in-range fractions', () => {
    expect(parseAiTag(tag({ duration_minutes: 12.6 }))?.duration_minutes).toBe(13);
  });

  it('rejects prototype-chain keys that are not real movements', () => {
    const parsed = parseAiTag(
      tag({ movement_keys: ['toString', 'constructor', 'back_squat'] }),
    );
    expect(parsed?.movement_keys).toEqual(['back_squat']);
  });

  it('returns null for non-objects and defaults confidence to low', () => {
    expect(parseAiTag(null)).toBeNull();
    expect(parseAiTag('x')).toBeNull();
    expect(parseAiTag({})?.confidence).toBe('low');
  });
});

// ---------- applyAiTag ----------

describe('applyAiTag', () => {
  it('prefers the AI duration over the regex read', () => {
    const s = tagged(
      { body: '12 min amrap of stuff' },
      tag({ duration_minutes: 25 }),
    );
    expect(s.duration_minutes).toBe(25);
  });

  it('falls back to the body regex when there is no AI duration', () => {
    const s = tagged({ body: '12 min amrap of stuff' }, undefined);
    expect(s.duration_minutes).toBe(12);
    expect(s.load_level).toBeNull();
    expect(s.ai_matched).toBe(false);
  });

  it('flips an unmatched section to matched when the AI finds movements', () => {
    const base = classifyProgrammedSection(
      section({ body: 'C&J singles, build over 7 sets' }),
      '2026-06-01',
      null,
    );
    expect(base.matched).toBe(false);
    const s = tagged(
      { body: 'C&J singles, build over 7 sets' },
      tag({ movement_keys: ['power_clean'], load_level: 'heavy' }),
    );
    expect(s.matched).toBe(true);
    expect(s.ai_matched).toBe(true);
    expect(s.movement_keys).toContain('power_clean');
    expect(s.patterns.length).toBeGreaterThan(0);
    expect(s.load_level).toBe('heavy');
  });

  it('unions AI movements into an already-matched section without flagging it', () => {
    const body = '21-15-9 thrusters and mystery pulls';
    const s = tagged(
      { body },
      tag({ movement_keys: ['kipping_pull_up'] }),
    );
    expect(s.movement_keys).toEqual(
      expect.arrayContaining(['thruster', 'kipping_pull_up']),
    );
    expect(s.ai_matched).toBe(false);
  });

  it('upgrades a long AI-estimated for_time to oxidative like the regex path does', () => {
    const s = tagged(
      { section_format: 'for_time', body: '5 rounds of grind' },
      tag({ movement_keys: ['back_squat'], duration_minutes: 25 }),
    );
    expect(s.energy_systems).toContain('oxidative');
  });

  it('applies the oxidative upgrade even when AI adds a duration but no movements', () => {
    const s = tagged(
      { section_format: 'amrap', body: 'thrusters and burpees, no clock written' },
      tag({ duration_minutes: 20 }),
    );
    expect(s.energy_systems).toContain('oxidative');
  });

  it('never reads metre distances as fallback durations', () => {
    const run = tagged(
      { section_format: 'for_time', body: '800m run, then 21-15-9' },
      undefined,
    );
    expect(run.duration_minutes).toBeNull();
    const row = tagged(
      { section_format: 'for_time', body: 'Row 2000m for time' },
      undefined,
    );
    expect(row.duration_minutes).toBeNull();
  });

  it('survives a tag carrying prototype-chain movement keys', () => {
    const s = tagged(
      { body: 'mystery work' },
      tag({ movement_keys: ['toString'] }),
    );
    expect(s.matched).toBe(false);
    expect(s.movement_keys).toEqual([]);
  });
});

// ---------- computeTimeDomainMix ----------

describe('computeTimeDomainMix', () => {
  it('buckets conditioning durations with inclusive lower bounds', () => {
    const sections = [
      tagged({ section_format: 'amrap' }, tag({ duration_minutes: 4 })),
      tagged({ section_format: 'amrap' }, tag({ duration_minutes: 5 })),
      tagged({ section_format: 'for_time' }, tag({ duration_minutes: 15 })),
      tagged({ section_format: 'emom' }, tag({ duration_minutes: 20 })),
    ];
    const mix = computeTimeDomainMix(sections);
    expect(mix.find((m) => m.key === 'under5')?.count).toBe(1);
    expect(mix.find((m) => m.key === '5to10')?.count).toBe(1);
    expect(mix.find((m) => m.key === '15to20')?.count).toBe(1);
    expect(mix.find((m) => m.key === 'over20')?.count).toBe(1);
    expect(mix.find((m) => m.key === '10to15')?.count).toBe(0);
  });

  it('ignores strength work and sections with no duration', () => {
    const sections = [
      tagged(
        { section_format: 'strength_sets', body: '20 min to build' },
        tag({ duration_minutes: 20 }),
      ),
      tagged({ section_format: 'amrap' }, undefined),
    ];
    const mix = computeTimeDomainMix(sections);
    expect(mix.every((m) => m.count === 0)).toBe(true);
  });

  it('computes shares over bucketed sections only', () => {
    const sections = [
      tagged({ section_format: 'amrap' }, tag({ duration_minutes: 8 })),
      tagged({ section_format: 'amrap' }, tag({ duration_minutes: 9 })),
      tagged({ section_format: 'for_time' }, tag({ duration_minutes: 22 })),
    ];
    const mix = computeTimeDomainMix(sections);
    expect(mix.find((m) => m.key === '5to10')?.pct).toBe(67);
    expect(mix.find((m) => m.key === 'over20')?.pct).toBe(33);
  });
});

// ---------- computeLoadMix ----------

describe('computeLoadMix', () => {
  it('counts every level and shares over tagged sections only', () => {
    const sections = [
      tagged({}, tag({ load_level: 'heavy' })),
      tagged({}, tag({ load_level: 'heavy' })),
      tagged({}, tag({ load_level: 'bodyweight' })),
      tagged({}, undefined),
    ];
    const mix = computeLoadMix(sections);
    expect(mix.find((m) => m.level === 'heavy')?.count).toBe(2);
    expect(mix.find((m) => m.level === 'heavy')?.pct).toBe(67);
    expect(mix.find((m) => m.level === 'bodyweight')?.pct).toBe(33);
    expect(mix.find((m) => m.level === 'moderate')?.count).toBe(0);
  });

  it('returns a stable all-levels shape when nothing is tagged', () => {
    const mix = computeLoadMix([tagged({}, undefined)]);
    expect(mix).toHaveLength(4);
    expect(mix.every((m) => m.count === 0 && m.pct === 0)).toBe(true);
  });
});

// ---------- fingerprintDigest ----------

describe('fingerprintDigest', () => {
  it('changes when any fingerprint changes and when the count changes', () => {
    const base = fingerprintDigest(['fp-a', 'fp-b']);
    expect(fingerprintDigest(['fp-a', 'fp-b'])).toBe(base);
    expect(fingerprintDigest(['fp-a', 'fp-c'])).not.toBe(base);
    expect(fingerprintDigest(['fp-a'])).not.toBe(base);
  });
});

// ---------- dedupeSections / correlateAiTags ----------

describe('dedupeSections', () => {
  it('collapses repeated sections and keeps fingerprints aligned with unique', () => {
    const warmUp = section({ section_format: 'other', body: '3 min row' });
    const wod = section({ body: 'Fran' });
    const { fingerprints, unique } = dedupeSections([warmUp, wod, warmUp]);
    expect(unique).toEqual([warmUp, wod]);
    expect(fingerprints).toEqual([
      sectionFingerprint(warmUp),
      sectionFingerprint(wod),
    ]);
  });
});

describe('correlateAiTags', () => {
  it('maps response entries back to fingerprints by position, skipping nulls', () => {
    const fps = ['fp-a', 'fp-b', 'fp-c'];
    const map = correlateAiTags(fps, [
      tag({ load_level: 'heavy' }),
      null,
      tag({ duration_minutes: 8 }),
    ]);
    expect(map.get('fp-a')?.load_level).toBe('heavy');
    expect(map.has('fp-b')).toBe(false);
    expect(map.get('fp-c')?.duration_minutes).toBe(8);
  });

  it('ignores a non-array payload and extra entries', () => {
    expect(correlateAiTags(['fp-a'], { nope: true }).size).toBe(0);
    expect(correlateAiTags(['fp-a'], [tag({}), tag({})]).size).toBe(1);
  });
});

// ---------- movementVocab ----------

describe('movementVocab', () => {
  it('exposes the CrossFit catalog as key/name pairs the classifier covers', () => {
    const vocab = movementVocab();
    expect(vocab.length).toBeGreaterThan(40);
    expect(vocab).toEqual(
      expect.arrayContaining([{ key: 'back_squat', name: 'Back Squat' }]),
    );
  });
});
