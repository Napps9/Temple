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
  | 'score_type'
  | 'score_value'
  | 'notes';

export const WORKOUT_FIELD_LABELS: Record<WorkoutField, string> = {
  email: 'Member email',
  date: 'Date',
  movement: 'Movement / workout name',
  weight: 'Weight',
  reps: 'Reps',
  unit: 'Weight unit (kg or lb)',
  score_type: 'Score type (For Time / AMRAP…)',
  score_value: 'Score / result',
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
  score_type: ['score type', 'result type', 'scoring', 'scoring type'],
  score_value: ['score value', 'score', 'result value', 'score result'],
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

export function matchMovement(
  name: string,
  overrides?: Map<string, string>,
): string | null {
  const n = normalise(name);
  if (!n) return null;
  if (overrides && overrides.has(n)) return overrides.get(n) ?? null;
  return MOVEMENT_INDEX.get(n) ?? null;
}

// Shared normaliser so a caller can key an override map the same way
// matchMovement looks it up (the AI resolver's accepted matches).
export function normaliseMovementName(s: string): string {
  return normalise(s);
}

// Flat {key, name} list of the movement vocabulary — the payload the AI
// resolver needs to map messy export names onto real movement keys.
export function movementVocab(): { key: string; name: string }[] {
  const out: { key: string; name: string }[] = [];
  for (const g of MOVEMENT_GROUPS) {
    for (const mv of g.movements) out.push({ key: mv.key, name: mv.name });
  }
  return out;
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
  overrides?: Map<string, string>,
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
    const key = movement ? matchMovement(movement, overrides) : null;
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

// --- Scored WOD sections (Phase A) --------------------------------------
// Benchmark results (Fran, Cindy, Grace…) whose score is a time or an
// AMRAP round count, rather than a weighted movement. These land as a
// tracked_workout_sections row (section_category 'wod') — sections are
// title-based, so the workout name is the title and no movement vocab is
// needed. See docs/workout-results-import-scope.md.

export type ImportSectionRow = {
  email: string;
  date: string; // ISO YYYY-MM-DD
  section_category: string; // 'wod' for imported benchmarks
  section_format: 'for_time' | 'amrap';
  title: string; // the workout / benchmark name
  total_time_seconds: number | null;
  total_rounds: number | null;
  total_extra_reps: number | null;
  notes: string | null;
};

// "3:12" -> 192, "1:05:10" -> 3910. mm:ss or h:mm:ss; null if it doesn't
// read as a clock time (mm/ss out of range, or not colon-separated).
export function parseTimeToSeconds(v: string): number | null {
  const s = v.trim();
  let m = s.match(/^(\d+):(\d{2})$/);
  if (m) {
    const sec = +m[2];
    if (sec >= 60) return null;
    return +m[1] * 60 + sec;
  }
  m = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m) {
    const min = +m[2];
    const sec = +m[3];
    if (min >= 60 || sec >= 60) return null;
    return +m[1] * 3600 + min * 60 + sec;
  }
  return null;
}

// "19+7" -> { rounds: 19, extraReps: 7 }. A bare "19" -> { rounds: 19,
// extraReps: 0 }. Null otherwise.
export function parseRoundsReps(
  v: string,
): { rounds: number; extraReps: number } | null {
  const s = v.trim();
  let m = s.match(/^(\d+)\s*\+\s*(\d+)$/);
  if (m) return { rounds: +m[1], extraReps: +m[2] };
  m = s.match(/^(\d+)$/);
  if (m) return { rounds: +m[1], extraReps: 0 };
  return null;
}

// Which import path a row belongs to, read from its Score Type.
// 'for_time'/'amrap' become scored sections; 'deferred' is Hyrox/race
// data not imported yet; 'weighted' is the existing movement path. Null
// (unrecognised type) is treated as weighted, best-effort.
export type RowKind = 'for_time' | 'amrap' | 'weighted' | 'deferred';

export function classifyScoreType(scoreType: string): RowKind | null {
  const n = normalise(scoreType);
  if (!n) return null;
  if (n === 'for time' || n === 'fortime') return 'for_time';
  if (
    n === 'amrap' ||
    n === 'for rounds reps' ||
    n === 'for rounds and reps' ||
    n === 'rounds reps' ||
    n === 'rounds and reps'
  ) {
    return 'amrap';
  }
  if (
    n === 'for weight' ||
    n === 'weight' ||
    n === 'load' ||
    n === 'for load' ||
    n === 'max load' ||
    n === '1rm'
  ) {
    return 'weighted';
  }
  if (n === 'time' || n === 'total time' || n === 'total race time') {
    return 'deferred';
  }
  return null;
}

// First non-empty value mapped to `field` in this row.
function cellFor(
  field: WorkoutField,
  headers: string[],
  mapping: (WorkoutField | null)[],
  cells: string[],
): string {
  for (let j = 0; j < headers.length; j += 1) {
    if (mapping[j] === field) {
      const v = (cells[j] ?? '').trim();
      if (v) return v;
    }
  }
  return '';
}

export function buildSectionRows(
  headers: string[],
  mapping: (WorkoutField | null)[],
  rows: string[][],
): {
  ready: ImportSectionRow[];
  skippedNoEmail: number;
  skippedNoDate: number;
  skippedUnscored: number;
} {
  const out: ImportSectionRow[] = [];
  let skippedNoEmail = 0;
  let skippedNoDate = 0;
  let skippedUnscored = 0;

  for (const cells of rows) {
    const email = cellFor('email', headers, mapping, cells).toLowerCase();
    const dateRaw = cellFor('date', headers, mapping, cells);
    // The workout / benchmark name is mapped to `movement` (the CSV's
    // Event/Workout Name column); a section carries it as the title.
    const title = cellFor('movement', headers, mapping, cells);
    const scoreType = cellFor('score_type', headers, mapping, cells);
    const scoreValue = cellFor('score_value', headers, mapping, cells);
    const notes = cellFor('notes', headers, mapping, cells) || null;

    if (!email) {
      skippedNoEmail += 1;
      continue;
    }
    const date = dateRaw ? toIsoDate(dateRaw) : null;
    if (!date) {
      skippedNoDate += 1;
      continue;
    }

    const kind = classifyScoreType(scoreType);
    if (kind === 'for_time') {
      const secs = parseTimeToSeconds(scoreValue);
      if (secs === null) {
        skippedUnscored += 1;
        continue;
      }
      out.push({
        email,
        date,
        section_category: 'wod',
        section_format: 'for_time',
        title: title || 'Imported workout',
        total_time_seconds: secs,
        total_rounds: null,
        total_extra_reps: null,
        notes,
      });
    } else if (kind === 'amrap') {
      const rr = parseRoundsReps(scoreValue);
      if (rr === null) {
        skippedUnscored += 1;
        continue;
      }
      out.push({
        email,
        date,
        section_category: 'wod',
        section_format: 'amrap',
        title: title || 'Imported workout',
        total_time_seconds: null,
        total_rounds: rr.rounds,
        total_extra_reps: rr.extraReps,
        notes,
      });
    } else {
      skippedUnscored += 1;
    }
  }
  return { ready: out, skippedNoEmail, skippedNoDate, skippedUnscored };
}

export type ImportResults = {
  weighted: ImportWorkoutRow[];
  sections: ImportSectionRow[];
  misses: MovementMiss[];
  deferred: number; // Hyrox / race rows — Phase B
  skippedNoEmail: number;
  skippedNoDate: number;
  skippedUnscored: number;
};

// Split every row into the weighted-movement path, the scored-section
// path, or the deferred (Hyrox/race) bucket — keyed off Score Type — then
// coerce each bucket. With no Score Type column mapped, every row is
// weighted, so a plain strength CSV behaves exactly as before.
export function buildResults(
  headers: string[],
  mapping: (WorkoutField | null)[],
  rows: string[][],
  overrides?: Map<string, string>,
): ImportResults {
  const hasScoreType = mapping.includes('score_type');
  const weightedRows: string[][] = [];
  const sectionRows: string[][] = [];
  let deferred = 0;

  for (const cells of rows) {
    const kind = hasScoreType
      ? classifyScoreType(cellFor('score_type', headers, mapping, cells))
      : 'weighted';
    if (kind === 'for_time' || kind === 'amrap') sectionRows.push(cells);
    else if (kind === 'deferred') deferred += 1;
    else weightedRows.push(cells);
  }

  // In a results export a FOR_WEIGHT row's load sits in Score Value, not a
  // dedicated Weight column. When no Weight column is mapped, read Score
  // Value as the weight for the weighted bucket (sections read it directly,
  // so they're unaffected).
  const weightedMapping =
    !mapping.includes('weight') && mapping.includes('score_value')
      ? mapping.map((m) => (m === 'score_value' ? 'weight' : m))
      : mapping;
  const weighted = buildWorkoutRows(
    headers,
    weightedMapping,
    weightedRows,
    overrides,
  );
  const sections = buildSectionRows(headers, mapping, sectionRows);

  return {
    weighted: weighted.ready,
    sections: sections.ready,
    misses: weighted.misses,
    deferred,
    skippedNoEmail: weighted.skippedNoEmail + sections.skippedNoEmail,
    skippedNoDate: weighted.skippedNoDate + sections.skippedNoDate,
    skippedUnscored: sections.skippedUnscored,
  };
}
