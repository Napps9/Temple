// Programming-balance aggregation — pure, no React/RN imports.
//
// Given a list of programmed `Section`s (the JSONB sitting on
// class_programming.sections) inside a date range, classify each one
// by movement pattern + energy system + body region, then roll up to
// the matrices the Analysis page renders:
//
//   • computePatternEnergyMatrix  (pattern × energy 2-D grid)
//   • computeEnergyMix            (phosphagen/glycolytic/oxidative %)
//   • computePatternMix           (per-pattern volume)
//   • computeRegionVolume         (per-body-region count for the heat map)
//   • computeBalance              (push:pull + anterior:posterior badges)
//   • untaggedSections            (coach-fix-up surface)
//
// Movement detection rides on `detectMovementsInText` (already used by
// the workout recorder) so a section's body text turns into structured
// movement keys without a coach having to tag anything manually.

import {
  classifyMovement,
  ENERGY_SYSTEMS,
  FORMAT_ENERGY_BIAS,
  MOVEMENT_PATTERNS,
  patternsOf,
  type Dominance,
  type EnergySystem,
  type MovementPattern,
} from './movement-classification';
import { detectMovementsInText } from './movement-detection';
import type {
  Section,
  SectionCategoryKey,
  SectionFormatKey,
} from './programming';

export type ClassifiedSection = {
  date: string;
  class_type_id: string | null;
  section_category: SectionCategoryKey;
  section_format: SectionFormatKey;
  title: string;
  movement_keys: string[];
  patterns: MovementPattern[];
  energy_systems: EnergySystem[];
  regions: string[];
  dominance_buckets: Dominance[];
  matched: boolean;
};

// Looks for duration cues in a programmed body — "20 min amrap",
// "30 min for time", "12 minute cap" — so a long for_time/amrap
// shifts into the oxidative bucket. Cap of 15 min is the boundary
// between metcon and longer aerobic work (CrossFit convention).
const DURATION_RE = /(\d{1,3})\s*(?:min|minute|mins|minutes|m\b)/i;

export function inferDuration(body: string | null | undefined): number | null {
  if (!body) return null;
  const m = body.match(DURATION_RE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function classifyProgrammedSection(
  section: Section,
  date: string,
  classTypeId: string | null,
): ClassifiedSection {
  const body = section.body ?? '';
  const detected = detectMovementsInText(body);
  const movementKeys = Array.from(
    new Set(detected.map((d) => d.movement_key)),
  );

  const patterns = new Set<MovementPattern>();
  const energySystems = new Set<EnergySystem>();
  const regions = new Set<string>();
  const dominanceBuckets = new Set<Dominance>();

  for (const key of movementKeys) {
    const cls = classifyMovement(key);
    if (!cls) continue;
    for (const p of patternsOf(key)) patterns.add(p);
    for (const e of cls.energy_systems) energySystems.add(e);
    for (const r of cls.primary_regions) regions.add(r);
    dominanceBuckets.add(cls.dominance);
  }

  // Layer the format's energy bias on top — captures sections where
  // the body is sparse but the format alone is informative
  // (strength_sets 5x5 → phosphagen; long amrap → glycolytic+oxidative).
  for (const e of FORMAT_ENERGY_BIAS[section.section_format] ?? []) {
    energySystems.add(e);
  }

  // Long for_time / amrap upgrades to oxidative.
  if (
    section.section_format === 'for_time' ||
    section.section_format === 'amrap'
  ) {
    const dur = inferDuration(body);
    if (dur !== null && dur >= 15) energySystems.add('oxidative');
  }

  return {
    date,
    class_type_id: classTypeId,
    section_category: section.section_category,
    section_format: section.section_format,
    title: section.title ?? '',
    movement_keys: movementKeys,
    patterns: [...patterns],
    energy_systems: [...energySystems],
    regions: [...regions],
    dominance_buckets: [...dominanceBuckets],
    matched: movementKeys.length > 0,
  };
}

// -----------------------------------------------------------------------
// Aggregations
// -----------------------------------------------------------------------

export function computeEnergyMix(
  sections: ClassifiedSection[],
): { system: EnergySystem; count: number; pct: number }[] {
  const counts = new Map<EnergySystem, number>();
  for (const e of ENERGY_SYSTEMS) counts.set(e, 0);
  let total = 0;
  for (const s of sections) {
    for (const e of s.energy_systems) {
      counts.set(e, (counts.get(e) ?? 0) + 1);
      total += 1;
    }
  }
  return [...ENERGY_SYSTEMS].map((system) => {
    const count = counts.get(system) ?? 0;
    const pct = total === 0 ? 0 : Math.round((count / total) * 100);
    return { system, count, pct };
  });
}

export function computePatternMix(
  sections: ClassifiedSection[],
): { pattern: MovementPattern; count: number; pct: number }[] {
  const counts = new Map<MovementPattern, number>();
  let total = 0;
  for (const s of sections) {
    for (const p of s.patterns) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
      total += 1;
    }
  }
  return [...MOVEMENT_PATTERNS]
    .map((pattern) => {
      const count = counts.get(pattern) ?? 0;
      const pct = total === 0 ? 0 : Math.round((count / total) * 100);
      return { pattern, count, pct };
    })
    .sort((a, b) => b.count - a.count);
}

export function computeRegionVolume(
  sections: ClassifiedSection[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sections) {
    for (const r of s.regions) counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}

export type Balance = {
  push: number;
  pull: number;
  anterior: number;
  posterior: number;
  mixed: number;
};

const PUSH_PATTERNS: MovementPattern[] = ['horizontal_push', 'vertical_push'];
const PULL_PATTERNS: MovementPattern[] = ['horizontal_pull', 'vertical_pull'];

export function computeBalance(sections: ClassifiedSection[]): Balance {
  const out: Balance = {
    push: 0,
    pull: 0,
    anterior: 0,
    posterior: 0,
    mixed: 0,
  };
  for (const s of sections) {
    for (const p of s.patterns) {
      if (PUSH_PATTERNS.includes(p)) out.push += 1;
      if (PULL_PATTERNS.includes(p)) out.pull += 1;
    }
    for (const d of s.dominance_buckets) {
      if (d === 'anterior') out.anterior += 1;
      else if (d === 'posterior') out.posterior += 1;
      else if (d === 'mixed') out.mixed += 1;
    }
  }
  return out;
}

export type PatternEnergyMatrix = Record<
  MovementPattern,
  Record<EnergySystem, number>
>;

export function computePatternEnergyMatrix(
  sections: ClassifiedSection[],
): PatternEnergyMatrix {
  const empty = () =>
    Object.fromEntries(ENERGY_SYSTEMS.map((e) => [e, 0])) as Record<
      EnergySystem,
      number
    >;
  const out = Object.fromEntries(
    MOVEMENT_PATTERNS.map((p) => [p, empty()]),
  ) as PatternEnergyMatrix;
  // Each section contributes +1 per (pattern × energy_system) pair it
  // covers — patterns + energy_systems are already deduped on the
  // section in classifyProgrammedSection.
  for (const s of sections) {
    for (const p of s.patterns) {
      for (const e of s.energy_systems) {
        out[p][e] += 1;
      }
    }
  }
  return out;
}

export function untaggedSections(
  sections: ClassifiedSection[],
): ClassifiedSection[] {
  return sections.filter((s) => !s.matched);
}
