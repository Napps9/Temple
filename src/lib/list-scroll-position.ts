// In-memory scroll offsets keyed by screen, so navigating to a detail
// screen and back (a full unmount/remount via router.replace, not a
// stack pop) restores the list to where the user left it. Deliberately
// not persisted to AsyncStorage — this only needs to survive within the
// same JS session, not across app restarts.
const positions = new Map<string, number>();

export function getScrollPosition(key: string): number {
  return positions.get(key) ?? 0;
}

export function setScrollPosition(key: string, y: number): void {
  positions.set(key, y);
}
