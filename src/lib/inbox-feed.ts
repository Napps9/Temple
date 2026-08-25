// The one-feed inbox's pure core: merge the gym's three notice sources
// into a single ordered list and answer "what is new". Kept free of
// React Native so the ordering and filtering rules are unit-testable —
// the screen maps query rows into these shapes and renders what comes
// back.

export type InboxChip = 'new' | 'all' | 'gym' | 'direct' | 'alerts' | 'cover';

export type GymFeedItem = {
  kind: 'announcement' | 'broadcast' | 'class_change';
  id: string;
  ts: string;
  unread: boolean;
  pinned: boolean;
  title: string;
  body: string;
  // Broadcasts carry their class type's colour as the row dot; the other
  // kinds have no colour of their own.
  dotColor: string | null;
};

// One label per class-change kind. Falls back to the reschedule wording
// for a kind this client predates, never to silence.
export const NOTICE_TITLE: Record<string, string> = {
  gym_closed: 'Gym closed',
  classes_reopened: 'Classes are back on',
  classes_rescheduled: 'Class times changed',
  class_cancelled: 'Class cancelled',
  class_coach_changed: 'Different coach',
};

export function classChangeTitle(kind: string): string {
  return NOTICE_TITLE[kind] ?? 'Class times changed';
}

// A pin now carries a window (0261). Both bounds null is the original
// behaviour — pinned until somebody unpins it — so a row written before
// the window existed still reads as pinned.
export function isPinnedNow(
  a: { pinned: boolean; pinned_from?: string | null; pinned_until?: string | null },
  now: Date = new Date(),
): boolean {
  if (!a.pinned) return false;
  const t = now.getTime();
  if (a.pinned_from && new Date(a.pinned_from).getTime() > t) return false;
  if (a.pinned_until && new Date(a.pinned_until).getTime() <= t) return false;
  return true;
}

// Pinned announcements lead regardless of age — that is what pinning is
// for — then everything else by recency.
export function buildGymFeed(items: GymFeedItem[]): GymFeedItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.ts).getTime() - new Date(a.ts).getTime();
  });
}

export function unreadOnly<T extends { unread: boolean }>(items: T[]): T[] {
  return items.filter((i) => i.unread);
}
