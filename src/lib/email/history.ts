import { useCallback, useState } from 'react';

import type { EmailDocument } from './blocks';

// Undo/redo for the email builder. The document is a plain immutable value
// (every op in blocks.ts returns a fresh one), so history is just a stack of
// snapshots. Lives in the campaign screen — above EmailEditor — so it
// survives the editor unmounting on the Preview toggle or a hop back to
// Setup.
//
// Coalescing: a run of edits to the same field (typing) carries a
// `coalesceKey`, and consecutive same-key edits collapse into a single undo
// step instead of one-per-keystroke. Any keyless (structural) edit, an undo,
// or a redo breaks the run.
//
// The transitions are pure functions (tested in history.test.ts); the hook
// is a thin wrapper so React state stays out of the logic.

const HISTORY_LIMIT = 50;

export type EmailChangeOptions = { coalesceKey?: string };

export type HistoryState = {
  past: EmailDocument[];
  present: EmailDocument;
  future: EmailDocument[];
  lastKey: string | null;
};

export function initHistory(present: EmailDocument): HistoryState {
  return { past: [], present, future: [], lastKey: null };
}

export function pushHistory(
  state: HistoryState,
  next: EmailDocument,
  key: string | null,
): HistoryState {
  // Fold consecutive same-field edits into the current step — but never
  // across a redo boundary, so the first edit after an undo starts a fresh
  // entry and drops the redo stack.
  if (key && key === state.lastKey && state.future.length === 0) {
    return { ...state, present: next, lastKey: key };
  }
  const past = [...state.past, state.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: next, future: [], lastKey: key };
}

export function undoHistory(state: HistoryState): HistoryState {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
    lastKey: null,
  };
}

export function redoHistory(state: HistoryState): HistoryState {
  if (state.future.length === 0) return state;
  const [next, ...rest] = state.future;
  return {
    past: [...state.past, state.present],
    present: next,
    future: rest,
    lastKey: null,
  };
}

export type EmailHistory = {
  document: EmailDocument;
  set: (next: EmailDocument, opts?: EmailChangeOptions) => void;
  undo: () => void;
  redo: () => void;
  reset: (doc: EmailDocument) => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useEmailHistory(
  initial: EmailDocument | (() => EmailDocument),
): EmailHistory {
  const [state, setState] = useState<HistoryState>(() =>
    initHistory(
      typeof initial === 'function'
        ? (initial as () => EmailDocument)()
        : initial,
    ),
  );

  const set = useCallback((next: EmailDocument, opts?: EmailChangeOptions) => {
    setState((s) => pushHistory(s, next, opts?.coalesceKey ?? null));
  }, []);
  const undo = useCallback(() => setState(undoHistory), []);
  const redo = useCallback(() => setState(redoHistory), []);
  const reset = useCallback((doc: EmailDocument) => setState(initHistory(doc)), []);

  return {
    document: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
