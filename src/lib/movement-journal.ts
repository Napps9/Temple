// Movement journal union: merges direct PR rows from
// tracked_movement_results and section-tag rows from
// tracked_section_movement_tags into a single chronological list with
// per-scheme best-of selection.
//
// Both sources are kept visible — neither overrides the other — and a
// row carries its `source` so the renderer can distinguish them. A
// member who logs the same physical set both ways (e.g. one-off PR
// AND tags a programmed Strength & Skill section with the same
// weight) will see two rows; we document that rather than try to
// auto-resolve, because the deduplication signal is unreliable.
//
// Best-of uses MAX (for `higher` better) or MIN (for `lower` better)
// across the union per scheme metric — the higher weight / lower
// time wins regardless of source.

import { bestOf, type TrackedResultRow } from './track';
import type { Metric, Scheme } from './movements';
import type { SectionFormatKey } from './programming';

export type JournalSource = 'direct' | 'tag';

export type JournalRow = {
  id: string;
  source: JournalSource;
  movement_key: string;
  track_key: string;
  // The tracked_workouts row this entry belongs to. The renderer
  // links into /track/workout/[id] so tapping a journal row lands
  // on the full recorded session (programmed body, entries, notes).
  workout_id: string | null;
  // For tag rows: the title (or category fallback) of the workout
  // section that produced this number — surfaced on the movement
  // detail page so the member knows which programmed piece the result
  // came from before tapping in.
  section_title: string | null;
  // Direct rows carry the raw value columns; tag rows carry whatever
  // numeric the underlying set produced (the renderer can decide
  // what to show — usually the section's headline metric for the
  // scheme).
  value_numeric: number | null;
  value_seconds: number | null;
  value_unit: string | null;
  notes: string | null;
  performed_at: string;
};

// Raw row shapes from the two source tables. Tag rows are joined to
// their section so the renderer can show a context label
// ("Strength & Skill · Back Squat 1RM") if it wants.
export type DirectInputRow = {
  id: string;
  workout_id: string | null;
  movement_key: string;
  track_key: string;
  value_numeric: number | null;
  value_seconds: number | null;
  value_unit: string | null;
  notes: string | null;
  performed_at: string;
};

export type TagInputRow = {
  id: string;
  // Resolved through the section to its parent tracked_workouts row.
  workout_id: string | null;
  // The section's display title (falls back to category label) — used
  // to show "Strength & Skill" beside the date on the movement page.
  section_title: string | null;
  movement_key: string;
  track_key: string | null;
  performed_at: string;
  notes: string | null;
  // The section's headline metric for this scheme. The caller fills
  // it in from the section + entries (heaviest set for max_load,
  // total time for for_time, ...). For tags with no resolved value
  // we still show the row in the chronological journal, just
  // without a numeric.
  value_numeric: number | null;
  value_seconds: number | null;
  value_unit: string | null;
};

function direct(row: DirectInputRow): JournalRow {
  return {
    id: `direct:${row.id}`,
    source: 'direct',
    movement_key: row.movement_key,
    track_key: row.track_key,
    workout_id: row.workout_id,
    section_title: null,
    value_numeric: row.value_numeric,
    value_seconds: row.value_seconds,
    value_unit: row.value_unit,
    notes: row.notes,
    performed_at: row.performed_at,
  };
}

function tag(row: TagInputRow): JournalRow {
  return {
    id: `tag:${row.id}`,
    source: 'tag',
    movement_key: row.movement_key,
    track_key: row.track_key ?? '',
    workout_id: row.workout_id,
    section_title: row.section_title,
    value_numeric: row.value_numeric,
    value_seconds: row.value_seconds,
    value_unit: row.value_unit,
    notes: row.notes,
    performed_at: row.performed_at,
  };
}

// Merge + sort (newest first). Both sources are preserved; the
// renderer can show source-specific affordances by reading
// `row.source`.
export function mergeJournal(
  directRows: DirectInputRow[],
  tagRows: TagInputRow[],
): JournalRow[] {
  const merged = [
    ...directRows.map(direct),
    ...tagRows.map(tag),
  ];
  merged.sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  return merged;
}

// Derive the value the tag should contribute to the movement Journal.
// The section's format decides which column to look at, and the scheme
// metric + direction decides MAX vs MIN across the section's entries.
//
// Time-metric schemes prefer the section's `total_time_seconds`
// aggregate (For time); fall back to the best entry-level
// `time_seconds`. Weight / reps / distance / calories metrics pick
// the best matching entry column. AMRAP's `total_rounds` covers the
// reps case when no per-round entries exist; the cardio aggregates
// (`total_distance_m`, `total_calories`) cover distance / calories
// the same way.
export type SectionForDerivation = {
  section_format: SectionFormatKey;
  total_time_seconds: number | null;
  total_rounds: number | null;
  total_distance_m: number | null;
  total_calories: number | null;
  entries: {
    weight_numeric: number | null;
    reps: number | null;
    time_seconds: number | null;
    distance_numeric: number | null;
    calories: number | null;
  }[];
};

export function deriveTagValue(
  scheme: { metric: Metric; better: 'higher' | 'lower' },
  section: SectionForDerivation,
): { value_numeric: number | null; value_seconds: number | null } {
  if (scheme.metric === 'time') {
    if (section.total_time_seconds != null) {
      return { value_numeric: null, value_seconds: section.total_time_seconds };
    }
    const times = section.entries
      .map((e) => e.time_seconds)
      .filter((v): v is number => v != null);
    if (times.length === 0) {
      return { value_numeric: null, value_seconds: null };
    }
    const chosen =
      scheme.better === 'higher' ? Math.max(...times) : Math.min(...times);
    return { value_numeric: null, value_seconds: chosen };
  }
  const pick = (field: keyof SectionForDerivation['entries'][number]) => {
    const values = section.entries
      .map((e) => e[field])
      .filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return scheme.better === 'higher' ? Math.max(...values) : Math.min(...values);
  };
  let v: number | null = null;
  if (scheme.metric === 'weight') v = pick('weight_numeric');
  else if (scheme.metric === 'reps') {
    v = pick('reps');
    if (v == null && section.total_rounds != null) v = section.total_rounds;
  } else if (scheme.metric === 'distance') {
    v = pick('distance_numeric');
    if (v == null && section.total_distance_m != null) v = section.total_distance_m;
  } else if (scheme.metric === 'calories') {
    v = pick('calories');
    if (v == null && section.total_calories != null) v = section.total_calories;
  }
  return { value_numeric: v, value_seconds: null };
}

// Per-scheme PR-at-time-of-recording. Walk the merged journal oldest
// first; an entry is a PR if it strictly beats every earlier entry
// for the same track_key under the scheme's "better" direction.
// Returns the set of row ids that were PRs when recorded.
export function prRowIds(
  rows: JournalRow[],
  schemeFor: (trackKey: string | null) => Pick<Scheme, 'metric' | 'better'> | undefined,
): Set<string> {
  const ids = new Set<string>();
  const bestByTrack = new Map<string, number>();
  const ascending = [...rows].sort(
    (a, b) =>
      new Date(a.performed_at).getTime() -
      new Date(b.performed_at).getTime(),
  );
  for (const row of ascending) {
    if (!row.track_key) continue;
    const scheme = schemeFor(row.track_key);
    if (!scheme) continue;
    const v = scheme.metric === 'time' ? row.value_seconds : row.value_numeric;
    if (v == null) continue;
    const prior = bestByTrack.get(row.track_key);
    const isPR =
      prior == null ||
      (scheme.better === 'higher' ? v > prior : v < prior);
    if (isPR) {
      ids.add(row.id);
      bestByTrack.set(row.track_key, v);
    }
  }
  return ids;
}

// Best-of across the union for a given scheme. Filters by track_key
// before delegating to bestOf() from src/lib/track.ts so the same
// MIN/MAX-by-direction logic is reused.
export function bestOfMerged(
  rows: JournalRow[],
  schemeKey: string,
  scheme: Pick<Scheme, 'metric' | 'better'>,
): JournalRow | null {
  const subset = rows.filter((r) => r.track_key === schemeKey);
  const asTrackedRows: TrackedResultRow[] = subset.map((r) => ({
    id: r.id,
    workout_id: '',
    movement_key: r.movement_key,
    track_key: r.track_key,
    value_numeric: r.value_numeric,
    value_seconds: r.value_seconds,
    value_unit: r.value_unit,
    notes: r.notes,
    performed_at: r.performed_at,
  }));
  const winner = bestOf(asTrackedRows, scheme);
  if (!winner) return null;
  return subset.find((r) => r.id === winner.id) ?? null;
}
