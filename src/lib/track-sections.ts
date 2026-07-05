// Types + per-format input descriptors for the member's workout-log
// entry form. The section_format tag from src/lib/programming.ts
// drives the entry UI here: which aggregates to prompt, what label to
// auto-generate per entry, and which optional metric columns the form
// should ask the member to fill.
//
// Aggregate invariant: aggregate-first formats populate
// tracked_workout_sections.total_* columns and (usually) no entries.
// Entries-only formats leave those columns NULL and rely on entries.
// `other` populates free_text_result only; `no_score` leaves
// everything except `notes` empty. See the plan's non-negotiable
// build constraints.

import type { SectionFormatKey } from './programming';
import { formatPace, formatSeconds, paceIntervalForText } from './track';

export type EntryMetric =
  | 'weight'
  | 'reps'
  | 'time'
  | 'distance'
  | 'calories'
  | 'done';

export type SectionFormatShape =
  // The form prompts the aggregate first; the member can optionally
  // expand into per-row entries (splits, warm-up sets).
  | { kind: 'aggregate_first'; aggregateFields: AggregateField[]; entryLabel?: string; entryMetrics?: EntryMetric[] }
  // The form is purely a table of entries; no top-line aggregate is
  // collected directly (a derived headline is rendered at read time).
  | { kind: 'entries_only'; entryLabel: string; entryMetrics: EntryMetric[]; defaultEntries: number }
  // The form has no entry rows at all — notes (and free_text_result
  // for `other`).
  | { kind: 'notes_only'; freeText: boolean };

export type AggregateField =
  | 'total_time_seconds'
  | 'total_rounds'
  | 'total_extra_reps'
  | 'total_distance_m'
  | 'total_calories'
  | 'did_not_finish';

export const FORMAT_SHAPES: Record<SectionFormatKey, SectionFormatShape> = {
  for_time: {
    kind: 'aggregate_first',
    aggregateFields: ['total_time_seconds', 'did_not_finish'],
    entryLabel: 'Split',
    entryMetrics: ['time', 'reps'],
  },
  amrap: {
    kind: 'aggregate_first',
    aggregateFields: ['total_rounds', 'total_extra_reps'],
    entryLabel: 'Round',
    entryMetrics: ['reps', 'time'],
  },
  emom: {
    kind: 'entries_only',
    entryLabel: 'Minute',
    entryMetrics: ['weight', 'reps', 'done'],
    defaultEntries: 5,
  },
  intervals: {
    kind: 'entries_only',
    entryLabel: 'Interval',
    entryMetrics: ['time', 'distance', 'calories', 'reps'],
    defaultEntries: 4,
  },
  max_distance: {
    kind: 'aggregate_first',
    // Distance is the score; time is the optional work window so the
    // journal / leaderboard can derive /500m or /km pace.
    aggregateFields: ['total_distance_m', 'total_time_seconds'],
    entryLabel: 'Split',
    entryMetrics: ['distance', 'time'],
  },
  max_calories: {
    kind: 'aggregate_first',
    aggregateFields: ['total_calories', 'total_time_seconds'],
    entryLabel: 'Split',
    entryMetrics: ['calories', 'time'],
  },
  strength_sets: {
    kind: 'entries_only',
    entryLabel: 'Set',
    entryMetrics: ['weight', 'reps'],
    defaultEntries: 3,
  },
  max_load: {
    kind: 'aggregate_first',
    // Heaviest single tracked via the entry-0 weight + reps. We keep
    // it in aggregate_first so the picker emphasises one headline
    // entry; warm-up sets are optional follow-up entries.
    aggregateFields: [],
    entryLabel: 'Set',
    entryMetrics: ['weight', 'reps'],
  },
  no_score: {
    kind: 'notes_only',
    freeText: false,
  },
  other: {
    kind: 'notes_only',
    freeText: true,
  },
};

// Convenience predicates the modal can use to decide what to render.
export function isEntriesOnly(format: SectionFormatKey): boolean {
  return FORMAT_SHAPES[format].kind === 'entries_only';
}

export function isAggregateFirst(format: SectionFormatKey): boolean {
  return FORMAT_SHAPES[format].kind === 'aggregate_first';
}

export function isNotesOnly(format: SectionFormatKey): boolean {
  return FORMAT_SHAPES[format].kind === 'notes_only';
}

export function entryLabelFor(
  format: SectionFormatKey,
  oneBasedIndex: number,
): string {
  const shape = FORMAT_SHAPES[format];
  const base =
    shape.kind === 'entries_only'
      ? shape.entryLabel
      : shape.kind === 'aggregate_first'
        ? (shape.entryLabel ?? 'Set')
        : 'Entry';
  return `${base} ${oneBasedIndex}`;
}

export type SectionEntryDraft = {
  weight: string;        // user text; parsed at save
  reps: string;
  time: string;          // MM:SS or HH:MM:SS
  distance: string;
  calories: string;
  done: boolean;
  notes: string;
};

export function emptyEntryDraft(): SectionEntryDraft {
  return {
    weight: '',
    reps: '',
    time: '',
    distance: '',
    calories: '',
    done: false,
    notes: '',
  };
}

// The headline result line for an aggregate-first section, shared by
// the journal preview and the workout-detail card. Returns null when
// nothing was recorded (or the format isn't aggregate-first).
export type SectionAggregates = {
  section_format: SectionFormatKey;
  title: string | null;
  body: string | null;
  total_time_seconds: number | null;
  total_rounds: number | null;
  total_extra_reps: number | null;
  total_distance_m: number | null;
  total_calories: number | null;
  did_not_finish: boolean | null;
};

export function aggregateHeadline(section: SectionAggregates): string | null {
  if (FORMAT_SHAPES[section.section_format].kind !== 'aggregate_first') {
    return null;
  }
  const parts: string[] = [];
  if (section.total_time_seconds != null) {
    parts.push(formatSeconds(section.total_time_seconds));
  }
  if (section.total_rounds != null) {
    const r = `${section.total_rounds} round${section.total_rounds === 1 ? '' : 's'}`;
    const e =
      section.total_extra_reps && section.total_extra_reps > 0
        ? ` + ${section.total_extra_reps} reps`
        : '';
    parts.push(r + e);
  }
  if (section.total_distance_m != null) {
    parts.push(`${section.total_distance_m} m`);
  }
  if (section.total_calories != null) {
    parts.push(`${section.total_calories} cal`);
  }
  const pace = formatPace(
    section.total_distance_m,
    section.total_time_seconds,
    paceIntervalForText(`${section.title ?? ''} ${section.body ?? ''}`),
  );
  if (pace) parts.push(pace);
  if (section.did_not_finish) parts.push('DNF');
  return parts.length > 0 ? parts.join(' · ') : null;
}

// True when the draft has any metric the format cares about.
// Used to skip persisting blank rows the member never touched.
export function entryDraftIsEmpty(
  draft: SectionEntryDraft,
  format: SectionFormatKey,
): boolean {
  const metrics =
    FORMAT_SHAPES[format].kind === 'entries_only'
      ? (FORMAT_SHAPES[format] as { entryMetrics: EntryMetric[] }).entryMetrics
      : (FORMAT_SHAPES[format] as { entryMetrics?: EntryMetric[] }).entryMetrics ??
        [];
  for (const m of metrics) {
    if (m === 'done') {
      if (draft.done) return false;
      continue;
    }
    const v = draft[m as keyof SectionEntryDraft];
    if (typeof v === 'string' && v.trim().length > 0) return false;
  }
  return draft.notes.trim().length === 0 ? true : false;
}
