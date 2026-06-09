import { describe, expect, it } from 'vitest';

import {
  groupByDay,
  snippet,
  timeAgo,
  type DirectMessageRow,
} from './messaging';

function dm(partial: Partial<DirectMessageRow>): DirectMessageRow {
  return {
    id: 'm',
    gym_id: 'g',
    sender_id: 's',
    recipient_id: 'r',
    body: 'hello',
    created_at: '2026-06-01T12:00:00Z',
    read_at: null,
    ...partial,
  };
}

describe('timeAgo', () => {
  const now = new Date('2026-06-10T12:00:00Z');
  it('renders sub-minute as "just now"', () => {
    expect(timeAgo('2026-06-10T11:59:30Z', now)).toBe('just now');
  });
  it('renders minutes', () => {
    expect(timeAgo('2026-06-10T11:50:00Z', now)).toBe('10m');
  });
  it('renders hours', () => {
    expect(timeAgo('2026-06-10T08:00:00Z', now)).toBe('4h');
  });
  it('renders days', () => {
    expect(timeAgo('2026-06-08T12:00:00Z', now)).toBe('2d');
  });
  it('renders the date for older items', () => {
    expect(timeAgo('2026-05-15T12:00:00Z', now)).toMatch(/15/);
  });
});

describe('snippet', () => {
  it('returns short bodies unchanged', () => {
    expect(snippet('hello there')).toBe('hello there');
  });
  it('collapses newlines into spaces', () => {
    expect(snippet('hi\n\nthere')).toBe('hi there');
  });
  it('truncates long bodies with an ellipsis', () => {
    expect(snippet('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });
});

describe('groupByDay', () => {
  it('buckets messages from the same day into one group', () => {
    const rows = [
      dm({ id: '1', created_at: '2026-06-01T08:00:00Z' }),
      dm({ id: '2', created_at: '2026-06-01T18:00:00Z' }),
      dm({ id: '3', created_at: '2026-06-02T10:00:00Z' }),
    ];
    const groups = groupByDay(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['3']);
  });
  it('returns an empty array for no rows', () => {
    expect(groupByDay([])).toEqual([]);
  });
});
