import { describe, expect, it } from 'vitest';

import {
  buildGymFeed,
  classChangeTitle,
  unreadOnly,
  type GymFeedItem,
} from './inbox-feed';

function mk(
  id: string,
  ts: string,
  extras: Partial<GymFeedItem> = {},
): GymFeedItem {
  return {
    kind: 'announcement',
    id,
    ts,
    unread: false,
    pinned: false,
    title: id,
    body: 'body',
    dotColor: null,
    ...extras,
  };
}

describe('buildGymFeed', () => {
  it('orders by recency, newest first', () => {
    const feed = buildGymFeed([
      mk('old', '2026-08-01T09:00:00Z'),
      mk('new', '2026-08-20T09:00:00Z'),
      mk('mid', '2026-08-10T09:00:00Z'),
    ]);
    expect(feed.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
  });

  it('puts pinned announcements first regardless of age', () => {
    const feed = buildGymFeed([
      mk('new', '2026-08-20T09:00:00Z'),
      mk('pinned-old', '2026-07-01T09:00:00Z', { pinned: true }),
      mk('mid', '2026-08-10T09:00:00Z'),
    ]);
    expect(feed.map((i) => i.id)).toEqual(['pinned-old', 'new', 'mid']);
  });

  it('interleaves kinds purely by time', () => {
    const feed = buildGymFeed([
      mk('a1', '2026-08-05T09:00:00Z', { kind: 'announcement' }),
      mk('c1', '2026-08-07T09:00:00Z', { kind: 'class_change' }),
      mk('b1', '2026-08-06T09:00:00Z', { kind: 'broadcast' }),
    ]);
    expect(feed.map((i) => i.id)).toEqual(['c1', 'b1', 'a1']);
  });

  it('does not mutate its input', () => {
    const input = [
      mk('b', '2026-08-01T09:00:00Z'),
      mk('a', '2026-08-20T09:00:00Z'),
    ];
    buildGymFeed(input);
    expect(input.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('unreadOnly', () => {
  it('keeps only unread items', () => {
    const items = [
      mk('read', '2026-08-01T09:00:00Z'),
      mk('unread', '2026-08-02T09:00:00Z', { unread: true }),
    ];
    expect(unreadOnly(items).map((i) => i.id)).toEqual(['unread']);
  });
});

describe('classChangeTitle', () => {
  it('maps every known kind', () => {
    expect(classChangeTitle('gym_closed')).toBe('Gym closed');
    expect(classChangeTitle('class_cancelled')).toBe('Class cancelled');
    expect(classChangeTitle('class_coach_changed')).toBe('Different coach');
    expect(classChangeTitle('classes_reopened')).toBe('Classes are back on');
  });

  it('falls back to the reschedule wording for unknown kinds', () => {
    expect(classChangeTitle('something_new')).toBe('Class times changed');
  });
});
