import { describe, expect, it } from 'vitest';

import {
  initHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from './history';
import type { EmailDocument } from './blocks';

// Minimal stand-in docs — the history transitions treat the document as an
// opaque value, so a tagged object is enough to assert identity.
function doc(tag: string): EmailDocument {
  return { version: 1, settings: { tag }, blocks: [] } as unknown as EmailDocument;
}
const tagOf = (d: EmailDocument) =>
  (d as unknown as { settings: { tag: string } }).settings.tag;

function seq(state: HistoryState) {
  return {
    present: tagOf(state.present),
    past: state.past.map(tagOf),
    future: state.future.map(tagOf),
  };
}

describe('email history transitions', () => {
  it('pushes the prior present onto the past and clears redo', () => {
    let s = initHistory(doc('a'));
    s = pushHistory(s, doc('b'), null);
    expect(seq(s)).toEqual({ present: 'b', past: ['a'], future: [] });
  });

  it('undo then redo round-trips', () => {
    let s = initHistory(doc('a'));
    s = pushHistory(s, doc('b'), null);
    s = undoHistory(s);
    expect(seq(s)).toEqual({ present: 'a', past: [], future: ['b'] });
    s = redoHistory(s);
    expect(seq(s)).toEqual({ present: 'b', past: ['a'], future: [] });
  });

  it('coalesces consecutive edits sharing a key into one step', () => {
    let s = initHistory(doc('a'));
    s = pushHistory(s, doc('b'), 'text:1');
    s = pushHistory(s, doc('c'), 'text:1');
    s = pushHistory(s, doc('d'), 'text:1');
    // One undo jumps all the way back past the whole typing run.
    expect(seq(s)).toEqual({ present: 'd', past: ['a'], future: [] });
    s = undoHistory(s);
    expect(tagOf(s.present)).toBe('a');
  });

  it('a different key starts a new step', () => {
    let s = initHistory(doc('a'));
    s = pushHistory(s, doc('b'), 'text:1');
    s = pushHistory(s, doc('c'), 'text:2');
    expect(seq(s)).toEqual({ present: 'c', past: ['a', 'b'], future: [] });
  });

  it('a keyless (structural) edit never coalesces', () => {
    let s = initHistory(doc('a'));
    s = pushHistory(s, doc('b'), null);
    s = pushHistory(s, doc('c'), null);
    expect(seq(s)).toEqual({ present: 'c', past: ['a', 'b'], future: [] });
  });

  it('does not coalesce across a redo boundary', () => {
    let s = initHistory(doc('a'));
    s = pushHistory(s, doc('b'), 'text:1');
    s = undoHistory(s); // present a, future [b]
    // Same key as before the undo, but the redo stack must be dropped and a
    // fresh entry pushed rather than silently merged.
    s = pushHistory(s, doc('c'), 'text:1');
    expect(seq(s)).toEqual({ present: 'c', past: ['a'], future: [] });
  });

  it('new edit after an undo clears the redo stack', () => {
    let s = initHistory(doc('a'));
    s = pushHistory(s, doc('b'), null);
    s = pushHistory(s, doc('c'), null);
    s = undoHistory(s); // present b, future [c]
    s = pushHistory(s, doc('d'), null);
    expect(s.future).toEqual([]);
    expect(seq(s)).toEqual({ present: 'd', past: ['a', 'b'], future: [] });
  });

  it('undo/redo are no-ops at the ends of the stack', () => {
    let s = initHistory(doc('a'));
    expect(undoHistory(s)).toBe(s);
    s = pushHistory(s, doc('b'), null);
    s = redoHistory(s); // nothing to redo
    expect(seq(s)).toEqual({ present: 'b', past: ['a'], future: [] });
  });

  it('caps the past at the history limit', () => {
    let s = initHistory(doc('0'));
    for (let i = 1; i <= 60; i += 1) s = pushHistory(s, doc(String(i)), null);
    expect(s.past.length).toBe(50);
    // Oldest snapshots fall off the back; the window ends at the latest.
    expect(s.past[0]).not.toBeUndefined();
    expect(tagOf(s.present)).toBe('60');
    expect(tagOf(s.past[s.past.length - 1])).toBe('59');
  });
});
