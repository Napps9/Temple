// The Book tab's class recommendation is a small, explainable heuristic
// (no ML): it learns a member's taste from their recent *attendance* and
// ranks upcoming sessions by how well each matches. Three signals,
// blended:
//   - type affinity — which class types they actually show up to,
//     recency-weighted (a 3-week half-life so a current habit outweighs a
//     stale one)
//   - time-of-day — how close a session runs to their usual hour for that
//     type, so a 6am regular isn't sent to a 6pm class
//   - soonness — a mild nudge toward the near future so the pick is
//     actionable, without letting "soonest" dominate the match
// These pure functions are unit-tested; the data fetching + eligibility
// filtering lives in the Book screen.

export const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;

const RECENCY_HALF_LIFE_MS = 21 * 24 * 60 * 60 * 1000;
const SOONNESS_HALF_LIFE_DAYS = 3;
const HOUR_SIGMA = 2; // hours; ±2h still a strong time-of-day match

const WEIGHT_TYPE = 0.55;
const WEIGHT_TIME = 0.3;
const WEIGHT_SOON = 0.15;

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
};

export function buildTasteProfile(
  rows: AttendedRow[],
  nowMs: number,
): TasteProfile {
  const affinity = new Map<string, number>();
  const hoursByType = new Map<string, Map<number, number>>();
  for (const row of rows) {
    if (!row.typeId || !row.startedAt) continue;
    const ageMs = Math.max(0, nowMs - new Date(row.attendedAt).getTime());
    const weight = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
    affinity.set(row.typeId, (affinity.get(row.typeId) ?? 0) + weight);
    const hour = new Date(row.startedAt).getHours();
    const hist = hoursByType.get(row.typeId) ?? new Map<number, number>();
    hist.set(hour, (hist.get(hour) ?? 0) + weight);
    hoursByType.set(row.typeId, hist);
  }
  return { affinity, hoursByType };
}

// 0..1 score for how well `hour` matches the member's attended-hour
// histogram: a weighted Gaussian falloff around each attended hour, with
// 24h wraparound so 23:00 and 01:00 read as close.
export function hourAffinity(
  hist: Map<number, number> | undefined,
  hour: number,
): number {
  if (!hist || hist.size === 0) return 0;
  let sum = 0;
  let total = 0;
  for (const [h, w] of hist) {
    const raw = Math.abs(h - hour);
    const dist = Math.min(raw, 24 - raw);
    sum += w * Math.exp(-(dist * dist) / (2 * HOUR_SIGMA * HOUR_SIGMA));
    total += w;
  }
  return total > 0 ? sum / total : 0;
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
  const startMs = new Date(session.starts_at).getTime();
  const hour = new Date(session.starts_at).getHours();
  const timeScore = hourAffinity(
    profile.hoursByType.get(session.class_type_id),
    hour,
  );
  const daysAway = Math.max(0, (startMs - nowMs) / (24 * 60 * 60 * 1000));
  const soonScore = Math.pow(0.5, daysAway / SOONNESS_HALF_LIFE_DAYS);
  return (
    typeScore * WEIGHT_TYPE + timeScore * WEIGHT_TIME + soonScore * WEIGHT_SOON
  );
}
