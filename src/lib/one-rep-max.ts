// Resolving a member's working 1RM for a movement, and the percentages
// off it that programming prescribes.
//
// A "1RM" here is not necessarily a logged single. Most members never
// record one — they have a 3, 5 or 10 rep max, or a tagged strength
// section. So when there's no recorded 1rm we estimate from whatever
// rep max exists (Epley) and label it as an estimate, rather than
// showing a member nothing.
//
// Units: every writer in the app stores 'kg', but the CSV importer
// (0072) writes 'lb' through unconverted, and bestOf() compares raw
// numerics — so a 315 lb row currently outranks a 200 kg one.
//
// We deliberately do NOT convert. The rep-max row on the movement
// detail page renders the winner of that raw comparison ("315 lb"); a
// converting resolver would pick a different row and render a
// different number three centimetres below it, disagreeing about both
// the weight and which session was best. Instead, a movement with any
// non-kg weight row resolves to `unit_unknown` and the card says so.
// That makes the gap visible rather than burying a guess inside one
// feature. The real fix is a per-gym weight unit with kg stored
// canonically, which also has to cover the strength_leaderboard RPC.

import { bestOfMerged, type JournalRow } from './movement-journal';
import type { Movement, Scheme } from './movements';

export type MaxSource = 'recorded' | 'estimated';

export type ResolvedMax = {
  kind: 'max';
  value: number;
  unit: 'kg';
  source: MaxSource;
  // Which scheme it came from: '1rm' when recorded, '3rm' | '5rm' |
  // '10rm' when estimated.
  fromScheme: string;
  // The raw best that produced it, so the caller can say
  // "estimated from your 5RM (90 kg × 5)".
  fromValue: number;
  fromReps: number;
  performedAt: string;
};

// A movement whose weight history is in pounds. We can't rank it
// against kg rows without contradicting the rep-max card, so we say
// nothing numeric and explain why.
export type UnitUnknown = { kind: 'unit_unknown' };

export type MaxResolution = ResolvedMax | UnitUnknown;

export function isKgUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? '').trim().toLowerCase();
  return u === '' || u === 'kg' || u === 'kgs';
}

// Epley. Identity at one rep, which matters — a recorded 1RM must never
// be inflated by passing through here.
export function estimateOneRepMax(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps < 1) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

// '3rm' -> 3. Returns null for anything that isn't a rep-max scheme.
export function repsForScheme(schemeKey: string): number | null {
  const m = /^(\d+)rm$/.exec(schemeKey);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A recorded 1RM always wins. Otherwise estimate from every rep max the
// member has and take the highest result, naming the scheme it came
// from — one rule, explainable in a single line of UI, with the label
// carrying the caveat rather than the algorithm trying to be clever
// about which max is stalest.
export function resolveOneRepMax(
  rows: JournalRow[],
  movement: Pick<Movement, 'schemes'>,
): MaxResolution | null {
  const weightSchemes = movement.schemes.filter(
    (s) => s.metric === 'weight' && s.better === 'higher',
  );
  if (weightSchemes.length === 0) return null;

  const schemeKeys = new Set(weightSchemes.map((s) => s.key));
  const weightRows = rows.filter(
    (r) => schemeKeys.has(r.track_key) && r.value_numeric != null,
  );
  if (weightRows.length === 0) return null;
  if (weightRows.some((r) => !isKgUnit(r.value_unit))) {
    return { kind: 'unit_unknown' };
  }

  const bestFor = (scheme: Scheme): { row: JournalRow; reps: number } | null => {
    const reps = repsForScheme(scheme.key);
    if (reps == null) return null;
    const row = bestOfMerged(weightRows, scheme.key, scheme);
    if (!row || row.value_numeric == null) return null;
    return { row, reps };
  };

  const recorded = weightSchemes.find((s) => s.key === '1rm');
  if (recorded) {
    const hit = bestFor(recorded);
    if (hit) {
      const value = hit.row.value_numeric as number;
      return {
        kind: 'max',
        value,
        unit: 'kg',
        source: 'recorded',
        fromScheme: '1rm',
        fromValue: value,
        fromReps: 1,
        performedAt: hit.row.performed_at,
      };
    }
  }

  let best: ResolvedMax | null = null;
  for (const scheme of weightSchemes) {
    if (scheme.key === '1rm') continue;
    const hit = bestFor(scheme);
    if (!hit) continue;
    const raw = hit.row.value_numeric as number;
    const estimated = estimateOneRepMax(raw, hit.reps);
    // Highest estimate wins — each candidate is itself a best-ever, so
    // this is the same MAX rule the rest of Track uses. Tie-break on
    // fewer reps (Epley degrades as reps climb), then more recent.
    if (best) {
      if (estimated < best.value) continue;
      if (estimated === best.value) {
        if (hit.reps > best.fromReps) continue;
        if (
          hit.reps === best.fromReps &&
          hit.row.performed_at <= best.performedAt
        ) {
          continue;
        }
      }
    }
    best = {
      kind: 'max',
      value: estimated,
      unit: 'kg',
      source: 'estimated',
      fromScheme: scheme.key,
      fromValue: raw,
      fromReps: hit.reps,
      performedAt: hit.row.performed_at,
    };
  }
  return best;
}

// The bar has to be loadable: round to plate pairs.
export function percentWeight(oneRm: number, pct: number): number {
  return Math.round(((oneRm * pct) / 100) / 2.5) * 2.5;
}

export function formatWeight(value: number): string {
  // Rounded values land on .0 or .5 — drop a trailing .0 so 80 kg
  // doesn't render as "80.0 kg".
  const n = Math.round(value * 10) / 10;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${text} kg`;
}

// 50-100% in 5% steps. Nobody prescribes a 40% working set, and 13
// rows made a very tall card above the leaderboard on a phone.
export const PERCENT_STEPS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
