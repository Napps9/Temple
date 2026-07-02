import { describe, expect, it } from 'vitest';

import {
  describeAudience,
  isAudienceEmptyByConstruction,
  normalizeAudience,
  type AudienceDefinition,
} from './audience';

describe('normalizeAudience', () => {
  it('defaults junk to all_members', () => {
    expect(normalizeAudience(null)).toEqual({ kind: 'all_members' });
    expect(normalizeAudience({ kind: 'nope' })).toEqual({ kind: 'all_members' });
    expect(normalizeAudience('all')).toEqual({ kind: 'all_members' });
  });

  it('keeps only valid cohort keys', () => {
    const def = normalizeAudience({
      kind: 'cohort',
      cohorts: ['intro', 'paying', 'made_up', 7],
    });
    expect(def).toEqual({ kind: 'cohort', cohorts: ['intro', 'paying'] });
  });

  it('keeps only string tags and profile ids', () => {
    expect(normalizeAudience({ kind: 'tags', tags: ['VIP', 3, null] })).toEqual({
      kind: 'tags',
      tags: ['VIP'],
    });
    expect(
      normalizeAudience({ kind: 'manual', profile_ids: ['a', 1, 'b'] }),
    ).toEqual({ kind: 'manual', profile_ids: ['a', 'b'] });
  });

  it('preserves pending_members instead of downgrading to all_members', () => {
    expect(normalizeAudience({ kind: 'pending_members' })).toEqual({
      kind: 'pending_members',
    });
  });
});

describe('isAudienceEmptyByConstruction', () => {
  it('is false for all_members and true for empty selections', () => {
    expect(isAudienceEmptyByConstruction({ kind: 'all_members' })).toBe(false);
    expect(isAudienceEmptyByConstruction({ kind: 'cohort', cohorts: [] })).toBe(true);
    expect(isAudienceEmptyByConstruction({ kind: 'tags', tags: [] })).toBe(true);
    expect(
      isAudienceEmptyByConstruction({ kind: 'manual', profile_ids: ['x'] }),
    ).toBe(false);
    expect(isAudienceEmptyByConstruction({ kind: 'pending_members' })).toBe(false);
  });
});

describe('describeAudience', () => {
  const cases: [AudienceDefinition, string][] = [
    [{ kind: 'all_members' }, 'All members'],
    [{ kind: 'cohort', cohorts: ['intro', 'expired'] }, 'Intro, Expired'],
    [{ kind: 'tags', tags: ['VIP'] }, 'Tagged "VIP"'],
    [{ kind: 'tags', tags: ['VIP', 'Risk'] }, 'Tagged with 2 tags'],
    [{ kind: 'manual', profile_ids: ['a', 'b', 'c'] }, '3 hand-picked members'],
    [{ kind: 'pending_members' }, 'Newly imported members'],
  ];
  it.each(cases)('describes %o', (def, expected) => {
    expect(describeAudience(def)).toBe(expected);
  });
});
