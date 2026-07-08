// The Book tab's class recommendation is a small, explainable heuristic
// (no ML): it learns a member's taste from their recent *attendance* and
// ranks upcoming sessions by how well each matches. Four signals,
// blended:
//   - type affinity — which class types they actually show up to,
//     recency-weighted (a 3-week half-life so a current habit outweighs a
//     stale one)
//   - time-of-day — how close a session runs to their usual hour for that
//     type, so a 6am regular isn't sent to a 6pm class
//   - day-of-week — how well the session's weekday matches the days they
//     usually train that type (a Mon/Wed/Fri regular is nudged onto those
//     days), with a tight falloff so adjacent days get only mild credit
//   - soonness — a mild nudge toward the near future so the pick is
//     actionable, without letting "soonest" dominate the match
// These pure functions are unit-tested; the data fetching + eligibility
// filtering lives in the Book screen.

export const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;

const RECENCY_HALF_LIFE_MS = 21 * 24 * 60 * 60 * 1000;
const SOONNESS_HALF_LIFE_DAYS = 3;
const HOUR_SIGMA = 2; // hours; ±2h still a strong time-of-day match
const DAY_SIGMA = 1; // weekdays; adjacent days count, two-apart barely

const WEIGHT_TYPE = 0.5;
const WEIGHT_TIME = 0.22;
const WEIGHT_DAY = 0.16;
const WEIGHT_SOON = 0.12;

export type AttendedRow = {
  typeId: string | null;
  startedAt: string | null;
  attendedAt: string;
};

export type TasteProfile = {
  // Recency-weighted attendance count per class type.
  affinity: Map<string, number>;
  // Recency-weighted histogram of attended start-hours, per class type.
  hoursByType: Map<string, Map<number, number>>;
  // Recency-weighted histogram of attended weekdays (0=Sun..6=Sat), per
  // class type.
  daysByType: Map<string, Map<number, number>>;
};

export function buildTasteProfile(
  rows: AttendedRow[],
  nowMs: number,
): TasteProfile {
  const affinity = new Map<string, number>();
  const hoursByType = new Map<string, Map<number, number>>();
  const daysByType = new Map<string, Map<number, number>>();
  const bump = (
    byType: Map<string, Map<number, number>>,
    typeId: string,
    key: number,
    weight: number,
  ) => {
    const hist = byType.get(typeId) ?? new Map<number, number>();
    hist.set(key, (hist.get(key) ?? 0) + weight);
    byType.set(typeId, hist);
  };
  for (const row of rows) {
    if (!row.typeId || !row.startedAt) continue;
    const ageMs = Math.max(0, nowMs - new Date(row.attendedAt).getTime());
    const weight = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
    affinity.set(row.typeId, (affinity.get(row.typeId) ?? 0) + weight);
    const started = new Date(row.startedAt);
    bump(hoursByType, row.typeId, started.getHours(), weight);
    bump(daysByType, row.typeId, started.getDay(), weight);
  }
  return { affinity, hoursByType, daysByType };
}

// 0..1 score for how well `value` matches a recency-weighted histogram
// on a cyclic axis: a weighted Gaussian falloff around each observed key,
// with wraparound so the ends of the cycle read as adjacent (23:00≈01:00,
// Sat≈Sun).
function cyclicAffinity(
  hist: Map<number, number> | undefined,
  value: number,
  period: number,
  sigma: number,
): number {
  if (!hist || hist.size === 0) return 0;
  let sum = 0;
  let total = 0;
  for (const [k, w] of hist) {
    const raw = Math.abs(k - value);
    const dist = Math.min(raw, period - raw);
    sum += w * Math.exp(-(dist * dist) / (2 * sigma * sigma));
    total += w;
  }
  return total > 0 ? sum / total : 0;
}

export function hourAffinity(
  hist: Map<number, number> | undefined,
  hour: number,
): number {
  return cyclicAffinity(hist, hour, 24, HOUR_SIGMA);
}

export function dayAffinity(
  hist: Map<number, number> | undefined,
  day: number,
): number {
  return cyclicAffinity(hist, day, 7, DAY_SIGMA);
}

export function scoreSession(
  profile: TasteProfile,
  maxAffinity: number,
  session: { class_type_id: string | null; starts_at: string },
  nowMs: number,
): number {
  if (!session.class_type_id) return 0;
  const typeScore =
    maxAffinity > 0
      ? (profile.affinity.get(session.class_type_id) ?? 0) / maxAffinity
      : 0;
  const start = new Date(session.starts_at);
  const timeScore = hourAffinity(
    profile.hoursByType.get(session.class_type_id),
    start.getHours(),
  );
  const dayScore = dayAffinity(
    profile.daysByType.get(session.class_type_id),
    start.getDay(),
  );
  const daysAway = Math.max(0, (start.getTime() - nowMs) / (24 * 60 * 60 * 1000));
  const soonScore = Math.pow(0.5, daysAway / SOONNESS_HALF_LIFE_DAYS);
  return (
    typeScore * WEIGHT_TYPE +
    timeScore * WEIGHT_TIME +
    dayScore * WEIGHT_DAY +
    soonScore * WEIGHT_SOON
  );
}
