import { useEffect, useState } from 'react';

// The phone dock's size, shared between the scrollers that drive it and
// the dock that draws it. Full at the top of a page, compact once the
// reader is scrolling down through it, full again on the first scroll
// back up — the page is what they are looking at, the dock only needs to
// stay reachable. A drag on the dock itself sets it either way (see
// BottomDock), and a section press restores it: a new page starts full.

let expanded = true;
const listeners = new Set<(expanded: boolean) => void>();

export function setDockExpanded(next: boolean) {
  if (next === expanded) return;
  expanded = next;
  listeners.forEach((l) => l(next));
}

export function useDockExpanded() {
  const [value, setValue] = useState(expanded);
  useEffect(() => {
    listeners.add(setValue);
    setValue(expanded);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

// Offsets under the top threshold always mean full, including iOS
// overscroll; the direction thresholds keep a resting finger from
// flickering it.
export function reportDockScroll(y: number, dy: number) {
  if (y <= 16) setDockExpanded(true);
  else if (dy > 4) setDockExpanded(false);
  else if (dy < -8) setDockExpanded(true);
}
