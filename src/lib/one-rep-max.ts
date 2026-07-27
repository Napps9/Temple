// Resolving a member's working 1RM for a movement, and the percentages
// off it that programming prescribes.
//
// A "1RM" here is not necessarily a logged single. Most members never
// record one — they have a 3, 5 or 10 rep max, or a tagged strength
// section. So when there's no recorded 1rm we estimate from whatever
// rep max exists (Epley) and label it as an estimate, rather than
// showing a member nothing.
//
// Units: kilograms are canonical in storage since 0181 — the importer
// converts on the way in and the existing lb rows were backfilled — so
// every weight here is directly comparable. Display conversion is the
// caller's job, via useGymWeightUnit and formatWeight in lib/weight.
// This file used to refuse to resolve a max for any movement with a
// pounds row, because ranking it against kg rows would have contradicted
// the rep-max row rendered three centimetres above. That refusal is gone
// with the reason for it.

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

export type MaxResolution = ResolvedMax;

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

// Re-exported so callers that already import from here don't need a
// second import; the implementation lives with the conversion.
export { formatWeight } from './weight';

// 50-100% in 5% steps. Nobody prescribes a 40% working set, and 13
// rows made a very tall card above the leaderboard on a phone.
export const PERCENT_STEPS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
