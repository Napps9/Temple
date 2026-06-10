// Movement-trend computation for the coach-facing programming
// analysis page. Pure — fed by rows from tracked_movement_results
// (deliberate PR/strength logs). Trends compare each member's first
// vs latest value per (movement, track) inside the window, honouring
// the scheme's direction (faster time = better at lower).

export type ResultPoint = {
  profile_id: string;
  movement_key: string;
  track_key: string;
  value: number;
  performed_at: string;
};

export type Direction = 'higher' | 'lower';

export type MemberTrend = {
  profile_id: string;
  count: number;
  first: number;
  last: number;
  // Signed % change first -> last; null when first is 0.
  deltaPct: number | null;
  trend: 'improving' | 'declining' | 'flat';
};

export type MovementTrendSummary = {
  movement_key: string;
  track_key: string;
  members: MemberTrend[];
  improving: number;
  declining: number;
  flat: number;
};

// Changes smaller than this (relative) count as flat — re-logging the
// same single at 100kg twice isn't a decline because of a rounding
// wobble.
const FLAT_THRESHOLD = 0.005;

export function memberTrend(
  values: { value: number; performed_at: string }[],
  better: Direction,
  profileId: string,
): MemberTrend | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) =>
    a.performed_at.localeCompare(b.performed_at),
  );
  const first = sorted[0].value;
  const last = sorted[sorted.length - 1].value;
  const deltaPct = first === 0 ? null : ((last - first) / first) * 100;

  let trend: MemberTrend['trend'];
  const relChange = first === 0 ? (last === 0 ? 0 : 1) : Math.abs(last - first) / Math.abs(first);
  if (relChange < FLAT_THRESHOLD) {
    trend = 'flat';
  } else if (better === 'higher') {
    trend = last > first ? 'improving' : 'declining';
  } else {
    trend = last < first ? 'improving' : 'declining';
  }

  return {
    profile_id: profileId,
    count: values.length,
    first,
    last,
    deltaPct,
    trend,
  };
}

export function computeMovementTrends(
  points: ResultPoint[],
  betterOf: (movementKey: string, trackKey: string) => Direction,
): MovementTrendSummary[] {
  // (movement, track) -> profile -> points
  const byTrack = new Map<
    string,
    {
      movement_key: string;
      track_key: string;
      perMember: Map<string, ResultPoint[]>;
    }
  >();
  for (const p of points) {
    const key = `${p.movement_key}\t${p.track_key}`;
    let bucket = byTrack.get(key);
    if (!bucket) {
      bucket = {
        movement_key: p.movement_key,
        track_key: p.track_key,
        perMember: new Map(),
      };
      byTrack.set(key, bucket);
    }
    const arr = bucket.perMember.get(p.profile_id) ?? [];
    arr.push(p);
    bucket.perMember.set(p.profile_id, arr);
  }

  const summaries: MovementTrendSummary[] = [];
  for (const { movement_key, track_key, perMember } of byTrack.values()) {
    const better = betterOf(movement_key, track_key);
    const members: MemberTrend[] = [];
    for (const [profileId, rows] of perMember) {
      const t = memberTrend(rows, better, profileId);
      if (t) members.push(t);
    }
    if (members.length === 0) continue;
    members.sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0));
    summaries.push({
      movement_key,
      track_key,
      members,
      improving: members.filter((m) => m.trend === 'improving').length,
      declining: members.filter((m) => m.trend === 'declining').length,
      flat: members.filter((m) => m.trend === 'flat').length,
    });
  }

  // Busiest movements first; tie-break alphabetically for stability.
  summaries.sort(
    (a, b) =>
      b.members.length - a.members.length ||
      a.movement_key.localeCompare(b.movement_key),
  );
  return summaries;
}
