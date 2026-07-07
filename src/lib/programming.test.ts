import { describe, expect, it } from 'vitest';

import {
  categoryToTitle,
  parseSection,
  parseSections,
  titleMatchesAnyCategory,
  SECTION_CATEGORIES,
  SECTION_FORMATS,
} from './programming';

describe('parseSection', () => {
  it('passes through a fresh section unchanged', () => {
    const fresh = {
      section_category: 'strength_and_skill',
      section_format: 'strength_sets',
      title: 'Strength & Skill',
      body: 'Back squat 5×5 @ 75%',
    };
    expect(parseSection(fresh)).toEqual({ ...fresh, leaderboard_enabled: false });
  });

  it('preserves leaderboard_enabled when set', () => {
    const fresh = {
      section_category: 'wod',
      section_format: 'for_time',
      title: 'Fran',
      body: '21-15-9 thrusters + pull ups',
      leaderboard_enabled: true,
    };
    expect(parseSection(fresh).leaderboard_enabled).toBe(true);
  });

  it('coerces a legacy {title, body} row to miscellaneous / other', () => {
    const legacy = { title: 'Old', body: 'x' };
    expect(parseSection(legacy)).toEqual({
      section_category: 'miscellaneous',
      section_format: 'other',
      title: 'Old',
      body: 'x',
      leaderboard_enabled: false,
    });
  });

  it('coerces an unknown category / format to the safe default', () => {
    const ahead = {
      section_category: 'new_thing_we_added_later',
      section_format: 'tabata',
      title: 'Future',
      body: 'y',
    };
    expect(parseSection(ahead)).toEqual({
      section_category: 'miscellaneous',
      section_format: 'other',
      title: 'Future',
      body: 'y',
      leaderboard_enabled: false,
    });
  });

  it('handles non-string title / body fields', () => {
    const malformed = {
      section_category: 'wod',
      section_format: 'for_time',
      title: 42,
      body: null,
    };
    expect(parseSection(malformed)).toEqual({
      section_category: 'wod',
      section_format: 'for_time',
      title: '',
      body: '',
      leaderboard_enabled: false,
    });
  });

  it('handles non-object input', () => {
    expect(parseSection(null)).toEqual({
      section_category: 'miscellaneous',
      section_format: 'other',
      title: '',
      body: '',
      leaderboard_enabled: false,
    });
    expect(parseSection('not an object')).toEqual({
      section_category: 'miscellaneous',
      section_format: 'other',
      title: '',
      body: '',
      leaderboard_enabled: false,
    });
  });
});

describe('parseSections', () => {
  it('parses an array of mixed shapes', () => {
    const raw = [
      { title: 'Legacy', body: 'a' },
      {
        section_category: 'mobility',
        section_format: 'no_score',
        title: 'Mobility',
        body: 'shoulder routine',
      },
    ];
    expect(parseSections(raw)).toEqual([
      {
        section_category: 'miscellaneous',
        section_format: 'other',
        title: 'Legacy',
        body: 'a',
        leaderboard_enabled: false,
      },
      {
        section_category: 'mobility',
        section_format: 'no_score',
        title: 'Mobility',
        body: 'shoulder routine',
        leaderboard_enabled: false,
      },
    ]);
  });

  it('returns empty array for non-array input', () => {
    expect(parseSections(null)).toEqual([]);
    expect(parseSections('nope')).toEqual([]);
    expect(parseSections({})).toEqual([]);
  });
});

describe('categoryToTitle', () => {
  it('returns the display label for every category key', () => {
    for (const c of SECTION_CATEGORIES) {
      expect(categoryToTitle(c.key)).toBe(c.label);
    }
  });
});

describe('titleMatchesAnyCategory', () => {
  it('returns true for every category label', () => {
    for (const c of SECTION_CATEGORIES) {
      expect(titleMatchesAnyCategory(c.label)).toBe(true);
    }
  });

  it('returns true for the empty / whitespace title (first pick fills it)', () => {
    expect(titleMatchesAnyCategory('')).toBe(true);
    expect(titleMatchesAnyCategory('   ')).toBe(true);
  });

  it('returns false for a manually edited title', () => {
    expect(titleMatchesAnyCategory('Primer — shoulders')).toBe(false);
    expect(titleMatchesAnyCategory('Fran')).toBe(false);
  });
});

describe('catalog shape', () => {
  it('exposes 7 categories', () => {
    expect(SECTION_CATEGORIES).toHaveLength(7);
  });
  it('exposes 10 formats including no_score and the cardio pair', () => {
    expect(SECTION_FORMATS).toHaveLength(10);
    expect(SECTION_FORMATS.find((f) => f.key === 'no_score')).toBeDefined();
    expect(SECTION_FORMATS.find((f) => f.key === 'max_distance')).toBeDefined();
    expect(SECTION_FORMATS.find((f) => f.key === 'max_calories')).toBeDefined();
  });
});
