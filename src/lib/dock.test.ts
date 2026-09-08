// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  holdComposerOpen,
  reportDockScroll,
  reportThreadScroll,
  setComposerExpanded,
  setDockExpanded,
  useComposerExpanded,
  useDockExpanded,
} from './dock';

// The two pieces of floating chrome size themselves off scrolling, and a
// PAGE and a THREAD mean opposite things by it. A page reads top to bottom,
// so its chrome clears out of the way going down. The Timeline's stream is
// pinned to its end, so going down is coming back to NOW — where the
// composer is and where somebody is about to type — and going up is reading
// history they cannot act on.
//
// Reusing the page rule on the thread was the first cut, and it shrank the
// chrome at the moment it was most wanted. Nothing caught that but the
// owner noticing, so it is asserted here.

// The module pushes to React setters from its own listener set, outside
// React's knowledge, so every change has to be wrapped or the hook's
// result stays stale and every assertion below reads the value before it.
function change(fn: () => void) {
  act(() => {
    fn();
  });
}

function read() {
  const dock = renderHook(() => useDockExpanded());
  const composer = renderHook(() => useComposerExpanded());
  return {
    get dock() {
      return dock.result.current;
    },
    get composer() {
      return composer.result.current;
    },
  };
}

beforeEach(() => {
  holdComposerOpen(false);
  setDockExpanded(true);
  setComposerExpanded(true);
});

describe('a thread sizes its chrome the opposite way to a page', () => {
  it('shrinks going back through the thread, and grows coming forward', () => {
    const state = read();

    // Scrolling up, into the day's history: both get out of the way.
    change(() => reportThreadScroll(900, -30, false));
    expect(state.dock).toBe(false);
    expect(state.composer).toBe(false);

    // Back down towards now: both come up.
    change(() => reportThreadScroll(1200, 30, false));
    expect(state.dock).toBe(true);
    expect(state.composer).toBe(true);
  });

  it('is full at the live end however the reader got there', () => {
    const state = read();
    change(() => reportThreadScroll(900, -30, false));
    expect(state.composer).toBe(false);
    // atEnd wins over the direction, so arriving at now by any route — a
    // fling, a scrollToEnd after sending — leaves the chrome up.
    change(() => reportThreadScroll(1400, -30, true));
    expect(state.dock).toBe(true);
    expect(state.composer).toBe(true);
  });

  it('shrinks a page going DOWN, which is the other way round', () => {
    const state = read();
    change(() => reportDockScroll(400, 30));
    expect(state.dock).toBe(false);
    expect(state.composer).toBe(false);
    change(() => reportDockScroll(300, -30));
    expect(state.dock).toBe(true);
  });

  it('treats the top of a page as full, including overscroll', () => {
    const state = read();
    change(() => reportDockScroll(400, 30));
    expect(state.dock).toBe(false);
    change(() => reportDockScroll(0, 0));
    expect(state.dock).toBe(true);
  });
});

describe('the two sizes are independent', () => {
  // The reason they are two flags: typing has to hold the composer open
  // while the dock carries on getting out of the way.
  it('holds the composer open while the dock still shrinks', () => {
    const state = read();
    change(() => holdComposerOpen(true));

    change(() => reportThreadScroll(900, -60, false));
    expect(state.composer).toBe(true);
    expect(state.dock).toBe(false);

    // Released on blur, and then the scroll owns it again.
    change(() => holdComposerOpen(false));
    change(() => reportThreadScroll(800, -60, false));
    expect(state.composer).toBe(false);
  });

  it('does not grow a composer nobody asked for when the dock is set', () => {
    const state = read();
    change(() => reportThreadScroll(900, -60, false));
    expect(state.composer).toBe(false);
    // What a dock section press does.
    change(() => setDockExpanded(true));
    expect(state.dock).toBe(true);
    expect(state.composer).toBe(false);
  });
});
