import { supabase } from '@/lib/supabase';
import type { Scheme } from '@/lib/movements';

export type BestClaim = {
  movementKey: string;
  trackKey: string;
  scheme: Pick<Scheme, 'metric' | 'better'>;
  valueNumeric: number | null;
  valueSeconds: number | null;
  valueUnit: string | null;
  performedAt: string;
};

// The local day the member is in, which is the day the message is
// about. The server cannot work this out — it knows when the row
// arrived, not where the person was standing.
function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Ask the server whether any of these results beat what the member had
// before. The direction of "better" lives in the TypeScript scheme
// catalog, so it travels as a parameter — the same arrangement
// strength_leaderboard has used since 0101.
//
// Best-effort by design: a milestone is a nice thing to say, and losing
// one must never cost somebody the workout they just logged.
export async function claimPersonalBests(
  gymId: string,
  claims: BestClaim[],
): Promise<void> {
  for (const c of claims) {
    try {
      await supabase.rpc('record_personal_best', {
        p_gym_id: gymId,
        p_movement_key: c.movementKey,
        p_track_key: c.trackKey,
        p_metric: c.scheme.metric,
        p_better: c.scheme.better,
        p_value_numeric: c.valueNumeric,
        p_value_seconds: c.valueSeconds,
        p_value_unit: c.valueUnit,
        p_performed_at: c.performedAt,
        p_local_day: localDay(c.performedAt),
      });
    } catch {
      // See above.
    }
  }
}
