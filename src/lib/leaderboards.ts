// Helpers for rendering leaderboard rows. The RPCs return raw fields
// (total_time_seconds, total_rounds, ...) and the display logic
// depends on the section format / scheme metric, mirroring how
// Journal rows are formatted.

import type { Metric } from './movements';
import { formatWeight, type WeightUnit } from './weight';
import type { SectionFormatKey } from './programming';
import { formatSeconds } from './track';

export type ClassLeaderboardRow = {
  profile_id: string;
  display_name: string;
  score: number;
  total_time_seconds: number | null;
  total_rounds: number | null;
  total_extra_reps: number | null;
  did_not_finish: boolean | null;
  heaviest_weight: number | null;
  weight_unit: string | null;
  total_distance_m: number | null;
  total_calories: number | null;
  section_format: string;
  performed_at: string;
  rank: number;
};

export type StrengthLeaderboardRow = {
  profile_id: string;
  display_name: string;
  value_numeric: number | null;
  value_seconds: number | null;
  performed_at: string;
  source: 'direct' | 'tag';
  rank: number;
};

// Render the score field for a class leaderboard row. Format-aware:
//   for_time      → total_time_seconds as MM:SS (or "DNF")
//   amrap         → "N rounds + M reps"
//   max_load      → heaviest_weight kg
//   strength_sets → heaviest_weight kg
//   max_distance  → total_distance_m as "N m"
//   max_calories  → total_calories as "N cal"
//   emom          → "X / N done" if we knew N; falls back to weight
//   intervals     → falls back to weight
//   no_score/other → "—"
export function formatClassScore(
  row: ClassLeaderboardRow,
  weightUnit: WeightUnit = 'kg',
): string {
  const f = row.section_format as SectionFormatKey;
  if (f === 'for_time') {
    if (row.did_not_finish) return 'DNF';
    if (row.total_time_seconds != null) return formatSeconds(row.total_time_seconds);
    return '—';
  }
  if (f === 'amrap') {
    const r = row.total_rounds ?? 0;
    const extra = row.total_extra_reps ?? 0;
    return extra > 0
      ? `${r} round${r === 1 ? '' : 's'} + ${extra} reps`
      : `${r} round${r === 1 ? '' : 's'}`;
  }
  if (f === 'max_distance') {
    return row.total_distance_m != null && row.total_distance_m > 0
      ? `${row.total_distance_m} m`
      : '—';
  }
  if (f === 'max_calories') {
    return row.total_calories != null && row.total_calories > 0
      ? `${row.total_calories} cal`
      : '—';
  }
  if (f === 'max_load' || f === 'strength_sets') {
    return row.heaviest_weight != null
      ? formatWeight(row.heaviest_weight, weightUnit)
      : '—';
  }
  if (f === 'emom' || f === 'intervals') {
    return row.heaviest_weight != null
      ? formatWeight(row.heaviest_weight, weightUnit)
      : '—';
  }
  return '—';
}

export function formatStrengthValue(
  row: StrengthLeaderboardRow,
  metric: Metric,
  weightUnit: WeightUnit = 'kg',
): string {
  if (metric === 'time') {
    return row.value_seconds != null ? formatSeconds(row.value_seconds) : '—';
  }
  if (row.value_numeric == null) return '—';
  // Weights are stored in kilograms (0181), so this converts for display
  // rather than asserting a unit it cannot see — strength_leaderboard
  // returns no unit column, which is why this used to hardcode 'kg' and
  // mislabel every imported row.
  if (metric === 'weight') return formatWeight(row.value_numeric, weightUnit);
  const unit =
    metric === 'distance' ? 'm' : metric === 'calories' ? 'cal' : 'reps';
  return `${row.value_numeric} ${unit}`;
}

// Format-driven; same logic the leaderboard SQL uses. UI sometimes
// wants to hide leaderboards for unrankable formats.
export function isRankable(format: SectionFormatKey): boolean {
  return format !== 'no_score' && format !== 'other';
}

// Ordinal suffix for the rank badge: 1st / 2nd / 3rd / 4th.
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
