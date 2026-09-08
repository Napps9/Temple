import { useEffect, useState } from 'react';

// The sizes of the two pieces of floating chrome, shared between the
// scrollers that drive them and the components that draw them: the phone
// dock, and the Timeline's talk bar.
//
// Both are full at the top of a page and compact once the reader is
// scrolling down through them, full again on the first scroll back up —
// the page is what they are looking at, the chrome only needs to stay
// reachable. A drag on the dock sets it either way (see BottomDock), and
// a section press restores it: a new page starts full.
//
// They are two flags rather than one because using one has nothing to do
// with using the other: typing in the talk bar has to hold IT open while
// the dock keeps shrinking out of the way, and pressing a dock section
// must not grow a composer nobody asked for. Scrolling is the one signal
// they share.

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

// The talk bar, sized the same way and held open while it is in use.
let composerExpanded = true;
let composerHeld = false;
const composerListeners = new Set<(expanded: boolean) => void>();

export function setComposerExpanded(next: boolean) {
  // A composer somebody is typing into does not shrink under them, however
  // far the page scrolls.
  if (!next && composerHeld) return;
  if (next === composerExpanded) return;
  composerExpanded = next;
  composerListeners.forEach((l) => l(next));
}

// Focus holds it open; blur releases it to the scroll again.
export function holdComposerOpen(held: boolean) {
  composerHeld = held;
  if (held) setComposerExpanded(true);
}

export function useComposerExpanded() {
  const [value, setValue] = useState(composerExpanded);
  useEffect(() => {
    composerListeners.add(setValue);
    setValue(composerExpanded);
    return () => {
      composerListeners.delete(setValue);
    };
  }, []);
  return value;
}

// Offsets under the top threshold always mean full, including iOS
// overscroll; the direction thresholds keep a resting finger from
// flickering it. One signal, both pieces of chrome — what they do with it
// afterwards is their own business.
export function reportDockScroll(y: number, dy: number) {
  if (y <= 16) {
    setDockExpanded(true);
    setComposerExpanded(true);
  } else if (dy > 4) {
    setDockExpanded(false);
    setComposerExpanded(false);
  } else if (dy < -8) {
    setDockExpanded(true);
    setComposerExpanded(true);
  }
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
