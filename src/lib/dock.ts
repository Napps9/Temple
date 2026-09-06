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

// Where the dock's top edge sits, measured up from the bottom of the
// window, for the popovers that hang above it. Measured rather than
// summed from constants so a change to the pill's padding cannot leave
// a menu floating short of it or overlapping it. Zero until the first
// layout; readers fall back to a constant then.
let dockTop = 0;
const dockTopListeners = new Set<(top: number) => void>();

export function setDockTop(top: number) {
  if (top === dockTop) return;
  dockTop = top;
  dockTopListeners.forEach((l) => l(top));
}

export function useDockTop() {
  const [value, setValue] = useState(dockTop);
  useEffect(() => {
    dockTopListeners.add(setValue);
    setValue(dockTop);
    return () => {
      dockTopListeners.delete(setValue);
    };
  }, []);
  return value;
}
