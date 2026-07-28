import { describe, expect, it } from 'vitest';

import {
  membersFilterStorageKey,
  parseMembersFilter,
  serializeMembersFilter,
} from './members-filter';

describe('membersFilterStorageKey', () => {
  it('namespaces the key per gym', () => {
    expect(membersFilterStorageKey('gym-a')).toBe('temple.members-filter.gym-a');
    expect(membersFilterStorageKey('gym-b')).toBe('temple.members-filter.gym-b');
  });
});

describe('parseMembersFilter', () => {
  it('returns the default state for null/undefined/empty', () => {
    expect(parseMembersFilter(null)).toEqual({ filter: 'all', tag: null, search: '' });
    expect(parseMembersFilter(undefined)).toEqual({ filter: 'all', tag: null, search: '' });
    expect(parseMembersFilter('')).toEqual({ filter: 'all', tag: null, search: '' });
  });

  it('round-trips a serialised state', () => {
    const state = { filter: 'expiring' as const, tag: 'VIP', search: 'jane' };
    expect(parseMembersFilter(serializeMembersFilter(state))).toEqual(state);
  });

  it('coerces unknown filter values to "all"', () => {
    const raw = JSON.stringify({ filter: 'banana', search: 'x' });
    expect(parseMembersFilter(raw)).toEqual({ filter: 'all', tag: null, search: 'x' });
  });

  it('coerces non-string search to empty string', () => {
    const raw = JSON.stringify({ filter: 'intro', search: 42 });
    expect(parseMembersFilter(raw)).toEqual({ filter: 'intro', tag: null, search: '' });
  });

  it('treats a missing, empty or non-string tag as no tag filter', () => {
    // Pre-tag persisted states have no tag key at all.
    expect(parseMembersFilter(JSON.stringify({ filter: 'active', search: '' })).tag).toBe(null);
    expect(parseMembersFilter(JSON.stringify({ filter: 'active', tag: '', search: '' })).tag).toBe(null);
    expect(parseMembersFilter(JSON.stringify({ filter: 'active', tag: 7, search: '' })).tag).toBe(null);
  });

  it('returns default state when JSON is malformed', () => {
    expect(parseMembersFilter('{not json')).toEqual({ filter: 'all', tag: null, search: '' });
  });
});

describe('serialize/parse', () => {
  it('preserves each valid filter value', () => {
    for (const filter of ['all', 'intro', 'expiring', 'expired', 'active'] as const) {
      const raw = serializeMembersFilter({ filter, tag: null, search: '' });
      expect(parseMembersFilter(raw).filter).toBe(filter);
    }
  });
});
