// Column auto-detection + row coercion for the workout-history import
// wizard. Mirrors the shape of `columns.ts` (members), but the row
// shape is per-set: one CSV row = one logged movement result.
//
// Movement matching is done client-side so the preview can flag
// rows whose movement name doesn't resolve to a vocab entry (the owner
// can fix the CSV and try again, or accept that those rows are dropped).

import { MOVEMENT_GROUPS } from '../movements';
import { toIsoDate } from './columns';

export type WorkoutField =
  | 'email'
  | 'date'
  | 'movement'
  | 'weight'
  | 'reps'
  | 'unit'
  | 'notes';

export const WORKOUT_FIELD_LABELS: Record<WorkoutField, string> = {
  email: 'Member email',
  date: 'Date',
  movement: 'Movement / exercise',
  weight: 'Weight',
  reps: 'Reps',
  unit: 'Weight unit (kg or lb)',
  notes: 'Notes',
};

const FIELD_HEADERS: Record<WorkoutField, string[]> = {
  email: ['email', 'member email', 'athlete email', 'user email', 'e-mail'],
  date: [
    'date', 'workout date', 'performed', 'performed at', 'performed on',
    'logged at', 'logged on', 'day', 'session date',
  ],
  movement: [
    'movement', 'exercise', 'lift', 'wod', 'workout', 'movement name',
    'exercise name', 'workout name', 'event workout name', 'wod name',
    'event name', 'exercise movement', 'movement exercise',
  ],
  weight: [
    'weight', 'load', 'kg', 'lb', 'lbs', 'kgs', 'value', 'weight (kg)',
    'weight (lb)', 'result', 'weight kg', 'weight lb', 'amount',
  ],
  reps: ['reps', 'rep', 'repetitions', 'count', 'rep count'],
  unit: ['unit', 'units', 'weight unit', 'weight units'],
  notes: ['notes', 'note', 'comments', 'comment', 'description'],
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./()]+/g, ' ').trim();
}

const WEIGHT_UNIT_RE =
  /^(kg|kgs|kilo|kilos|kilogram|kilograms|lb|lbs|pound|pounds)$/i;

// A column literally named "Unit" reads as the weight unit in a strength
// export, but in a scored-results export it holds "mm:ss" / "rounds+reps".
// Only trust that header match when the sampled values actually look like
// weight units; with no rows to judge (header-only detection) the match
// stands, so paste/preview behaviour is unchanged.
function looksLikeWeightUnits(colIndex: number, rows: string[][]): boolean {
  let seen = 0;
  let weightLike = 0;
  for (let i = 0; i < rows.length && seen < 30; i += 1) {
    const v = (rows[i]?.[colIndex] ?? '').trim();
    if (!v) continue;
    seen += 1;
    if (WEIGHT_UNIT_RE.test(v)) weightLike += 1;
  }
  if (seen === 0) return true;
  return weightLike / seen >= 0.5;
}

export function autoDetect(
  headers: string[],
  rows: string[][] = [],
): (WorkoutField | null)[] {
  const used = new Set<WorkoutField>();
  return headers.map((h, idx) => {
    const n = normalise(h);
    for (const field of Object.keys(FIELD_HEADERS) as WorkoutField[]) {
      if (used.has(field)) continue;
      if (!FIELD_HEADERS[field].some((alias) => normalise(alias) === n)) continue;
      if (field === 'unit' && !looksLikeWeightUnits(idx, rows)) continue;
      used.add(field);
      return field;
    }
    return null;
  });
}

// Times (3:12, 1:05:10), AMRAP rounds+reps (19+7), Hyrox splits and
// FOR_TIME/AMRAP score types are the shape of a benchmark / metcon / race
// export — which this weighted-movement importer can't represent. Detect it
// from the values (not the headers, which vary) so the preview can say so
// plainly instead of dropping every row as an "unknown movement".
const SCORE_TIME_RE = /^\d{1,3}:\d{2}(:\d{2})?$/;
const SCORE_ROUNDS_RE = /^\d+\s*\+\s*\d+$/;
const SCORE_WORD_RE =
  /\b(for[\s_]?time|for[\s_]?rounds?[\s_]?reps?|amrap|emom|mm:ss|h:mm:ss|hyrox)\b/i;

export function looksLikeScoredResults(rows: string[][]): boolean {
  let judged = 0;
  let scored = 0;
  for (let i = 0; i < rows.length && i < 200; i += 1) {
    const cells = (rows[i] ?? []).map((c) => (c ?? '').trim());
    if (!cells.some(Boolean)) continue;
    judged += 1;
    if (
      cells.some(
        (v) =>
          SCORE_TIME_RE.test(v) ||
          SCORE_ROUNDS_RE.test(v) ||
          SCORE_WORD_RE.test(v),
      )
    ) {
      scored += 1;
    }
  }
  return judged > 0 && scored / judged >= 0.25;
}

// Build a flat name → key index across MOVEMENT_GROUPS. Names and
// aliases collapse to the same normalised form the CSV value goes
// through, so "Back Squat", "back-squat", "back  squats" all resolve
// to back_squat.
const MOVEMENT_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const g of MOVEMENT_GROUPS) {
    for (const mv of g.movements) {
      m.set(normalise(mv.name), mv.key);
      m.set(normalise(mv.key), mv.key);
      for (const a of mv.aliases ?? []) m.set(normalise(a), mv.key);
    }
  }
  return m;
})();

export function matchMovement(name: string): string | null {
  const n = normalise(name);
  if (!n) return null;
  return MOVEMENT_INDEX.get(n) ?? null;
}

// Snapshot used by the preview's "couldn't match" callout so the owner
// can spot which inputs need rewording.
export type MovementMiss = { value: string; rowIndex: number };

export type ImportWorkoutRow = {
  email: string;
  date: string;             // ISO YYYY-MM-DD
  movement_key: string;     // resolved vocab key
  // Trackable schemes are all keyed by reps for weighted lifts; the
  // RPC casts this back into the `<reps>rm` track_key shape. Default
  // 1 when reps is missing.
  reps: number;
  weight: number | null;    // null = bodyweight / no load
  unit: 'kg' | 'lb';
  notes: string | null;
};

// Returns the rows we can ship to the RPC plus a list of misses for
// the preview screen.
export function buildWorkoutRows(
  headers: string[],
  mapping: (WorkoutField | null)[],
  rows: string[][],
): { ready: ImportWorkoutRow[]; misses: MovementMiss[]; skippedNoEmail: number; skippedNoDate: number } {
  const out: ImportWorkoutRow[] = [];
  const misses: MovementMiss[] = [];
  let skippedNoEmail = 0;
  let skippedNoDate = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const cells = rows[i];
    let email: string | null = null;
    let date: string | null = null;
    let movement: string | null = null;
    let weight: number | null = null;
    let reps: number | null = null;
    let unit: 'kg' | 'lb' = 'kg';
    let notes: string | null = null;

    for (let j = 0; j < headers.length; j += 1) {
      const f = mapping[j];
      if (!f) continue;
      const v = (cells[j] ?? '').trim();
      if (!v) continue;
      switch (f) {
        case 'email':
          email = v.toLowerCase();
          break;
        case 'date':
          date = toIsoDate(v);
          break;
        case 'movement':
          movement = v;
          break;
        case 'weight': {
          const n = Number.parseFloat(v.replace(/,/g, '.'));
          if (Number.isFinite(n) && n >= 0) weight = n;
          break;
        }
        case 'reps': {
          const n = Number.parseInt(v, 10);
          if (Number.isFinite(n) && n > 0 && n <= 100) reps = n;
          break;
        }
        case 'unit': {
          const lv = v.toLowerCase();
          if (lv.startsWith('lb') || lv === 'pound' || lv === 'pounds') unit = 'lb';
          else unit = 'kg';
          break;
        }
        case 'notes':
          notes = v;
          break;
      }
    }

    if (!email) {
      skippedNoEmail += 1;
      continue;
    }
    if (!date) {
      skippedNoDate += 1;
      continue;
    }
    const key = movement ? matchMovement(movement) : null;
    if (!key) {
      if (movement) misses.push({ value: movement, rowIndex: i });
      continue;
    }
    out.push({
      email,
      date,
      movement_key: key,
      reps: reps ?? 1,
      weight,
      unit,
      notes,
    });
  }
  return { ready: out, misses, skippedNoEmail, skippedNoDate };
}
