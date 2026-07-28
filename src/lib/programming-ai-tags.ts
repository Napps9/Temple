// AI programming tags — the Boxmate-style "workout type / length /
// heavy or light" dimensions, read by AI instead of a coach tagging
// each session by hand.
//
// The rule-based classifier (programming-balance.ts) only sees what
// the alias lexicon recognises, and knows nothing about loading or
// how long a piece runs beyond a bare "NN min" regex. The
// classify-programming edge function sends each distinct programmed
// section to Claude once (cached per gym by content hash) and gets
// back movements, an estimated duration, and a load level. This
// module is the pure client half: fingerprinting for dedup/correlation,
// response validation, merging the AI read into ClassifiedSection, and
// the aggregations behind the Time domains and Load balance cards.
//
// Everything degrades: when the tag map is empty (no ANTHROPIC_API_KEY
// configured, or the call failed) durations fall back to the
// inferDuration regex and the load card simply doesn't render — the
// Analysis page never blocks on AI availability. Pure module, no
// React/RN/supabase imports — the invoke glue lives on the Analysis
// page next to the query it feeds.

import { HYROX_GROUPS } from './hyrox';
import {
  classifyMovement,
  patternsOf,
  type EnergySystem,
} from './movement-classification';
import { MOVEMENT_GROUPS } from './movements';
import type { Section, SectionFormatKey } from './programming';
import { inferDuration, type ClassifiedSection } from './programming-balance';

export type LoadLevel = 'heavy' | 'moderate' | 'light' | 'bodyweight';

export const LOAD_LEVELS: readonly LoadLevel[] = [
  'heavy',
  'moderate',
  'light',
  'bodyweight',
] as const;

export const LOAD_LABELS: Record<LoadLevel, string> = {
  heavy: 'Heavy',
  moderate: 'Moderate',
  light: 'Light',
  bodyweight: 'Bodyweight',
};

// Hotter → cooler as the barbell gets lighter; grey for no load at all.
export const LOAD_COLOURS: Record<LoadLevel, string> = {
  heavy: '#EF4444',
  moderate: '#F59E0B',
  light: '#10B981',
  bodyweight: '#9CA3AF',
};

export type TimeDomain = {
  key: string;
  label: string;
  min: number;
  max: number;
};

// CrossFit-convention conditioning time domains. max is exclusive so
// a 5:00 piece lands in 5–10 and a 20:00 piece in 20+.
export const TIME_DOMAINS: readonly TimeDomain[] = [
  { key: 'under5', label: 'Under 5 min', min: 0, max: 5 },
  { key: '5to10', label: '5–10 min', min: 5, max: 10 },
  { key: '10to15', label: '10–15 min', min: 10, max: 15 },
  { key: '15to20', label: '15–20 min', min: 15, max: 20 },
  { key: 'over20', label: '20+ min', min: 20, max: Infinity },
] as const;

// The formats where "how long does it run" is a property of the piece
// itself. Strength work is excluded on purpose — a 5×5 taking 25
// minutes of clock time is not a 25-minute time domain.
const CONDITIONING_FORMATS: readonly SectionFormatKey[] = [
  'for_time',
  'amrap',
  'emom',
  'intervals',
  'max_distance',
  'max_calories',
] as const;

export type AiSectionTag = {
  movement_keys: string[];
  duration_minutes: number | null;
  load_level: LoadLevel | null;
  confidence: 'high' | 'medium' | 'low';
};

export type TaggedSection = ClassifiedSection & {
  duration_minutes: number | null;
  load_level: LoadLevel | null;
  ai_matched: boolean;
};

// The canonical identity of a section's content. The edge function
// hashes this string (under a server-only cache-version prefix) for
// its cache key, so keep the normalisation in lock-step with
// classify-programming/index.ts.
export function sectionFingerprint(
  s: Pick<Section, 'section_format' | 'title' | 'body'>,
): string {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${s.section_format}\n${norm(s.title)}\n${norm(s.body)}`;
}

// Both catalogs, whatever the gym's discipline — the Record flow's tag
// picker is cross-discipline for the same reason, and a CrossFit gym
// programming a sled push deserves the tag as much as a Hyrox one.
export function movementVocab(): { key: string; name: string }[] {
  return [...MOVEMENT_GROUPS, ...HYROX_GROUPS].flatMap((g) =>
    g.movements.map((m) => ({ key: m.key, name: m.name })),
  );
}

// Validate one raw tag object from the edge function. Anything out of
// vocabulary or out of range is dropped rather than trusted — a wrong
// number on an analytics card is worse than a blank one.
export function parseAiTag(raw: unknown): AiSectionTag | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const keys = Array.isArray(r.movement_keys)
    ? r.movement_keys.filter(
        (k): k is string =>
          typeof k === 'string' && classifyMovement(k) !== undefined,
      )
    : [];
  const dur =
    typeof r.duration_minutes === 'number' &&
    Number.isFinite(r.duration_minutes) &&
    r.duration_minutes >= 1 &&
    r.duration_minutes <= 600
      ? Math.round(r.duration_minutes)
      : null;
  const load = LOAD_LEVELS.includes(r.load_level as LoadLevel)
    ? (r.load_level as LoadLevel)
    : null;
  const confidence =
    r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low';
  return { movement_keys: keys, duration_minutes: dur, load_level: load, confidence };
}

// Merge the AI read into the rule-based classification. AI movements
// union into the matrices (they only ever add coverage — the lexicon
// result stands untouched); duration prefers the AI estimate and falls
// back to the "NN min" regex; a section only the AI could read flips
// to matched so it leaves the Untagged card.
export function applyAiTag(
  base: ClassifiedSection,
  section: Pick<Section, 'section_format' | 'body'>,
  tag: AiSectionTag | undefined,
): TaggedSection {
  // The regex fallback gets the same 1–600 sanity gate the AI path has
  // in parseAiTag — a stray number the regex misreads must not become
  // a bar on the Time domains card.
  const inferred = inferDuration(section.body);
  const duration =
    tag?.duration_minutes ??
    (inferred !== null && inferred >= 1 && inferred <= 600 ? inferred : null);

  const movementKeys = new Set(base.movement_keys);
  const patterns = new Set(base.patterns);
  const energy = new Set<EnergySystem>(base.energy_systems);
  const regions = new Set(base.regions);
  const dominance = new Set(base.dominance_buckets);
  for (const key of tag?.movement_keys ?? []) {
    const cls = classifyMovement(key);
    if (!cls) continue;
    movementKeys.add(key);
    for (const p of patternsOf(key)) patterns.add(p);
    for (const e of cls.energy_systems) energy.add(e);
    for (const r of cls.primary_regions) regions.add(r);
    dominance.add(cls.dominance);
  }

  // Same rule classifyProgrammedSection applies from the regex: a long
  // for_time / amrap is oxidative work even if no single movement is —
  // and the AI estimate can supply the duration the regex couldn't see.
  if (
    (section.section_format === 'for_time' ||
      section.section_format === 'amrap') &&
    duration !== null &&
    duration >= 15
  ) {
    energy.add('oxidative');
  }

  return {
    ...base,
    movement_keys: [...movementKeys],
    patterns: [...patterns],
    energy_systems: [...energy],
    regions: [...regions],
    dominance_buckets: [...dominance],
    matched: base.matched || movementKeys.size > 0,
    ai_matched: !base.matched && movementKeys.size > 0,
    duration_minutes: duration,
    load_level: tag?.load_level ?? null,
  };
}

export function computeTimeDomainMix(
  sections: TaggedSection[],
): { key: string; label: string; count: number; pct: number }[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const s of sections) {
    if (!CONDITIONING_FORMATS.includes(s.section_format)) continue;
    if (s.duration_minutes === null) continue;
    const domain = TIME_DOMAINS.find(
      (d) => s.duration_minutes! >= d.min && s.duration_minutes! < d.max,
    );
    if (!domain) continue;
    counts.set(domain.key, (counts.get(domain.key) ?? 0) + 1);
    total += 1;
  }
  return TIME_DOMAINS.map((d) => {
    const count = counts.get(d.key) ?? 0;
    const pct = total === 0 ? 0 : Math.round((count / total) * 100);
    return { key: d.key, label: d.label, count, pct };
  });
}

export function computeLoadMix(
  sections: TaggedSection[],
): { level: LoadLevel; count: number; pct: number }[] {
  const counts = new Map<LoadLevel, number>();
  let total = 0;
  for (const s of sections) {
    if (s.load_level === null) continue;
    counts.set(s.load_level, (counts.get(s.load_level) ?? 0) + 1);
    total += 1;
  }
  return [...LOAD_LEVELS].map((level) => {
    const count = counts.get(level) ?? 0;
    const pct = total === 0 ? 0 : Math.round((count / total) * 100);
    return { level, count, pct };
  });
}

export type ClassifiableSection = Pick<
  Section,
  'section_category' | 'section_format' | 'title' | 'body'
>;

// A compact digest of a fingerprint set, for use in a react-query key:
// any content edit anywhere in the window changes the digest and
// triggers a refetch (which is cheap — the edge function caches per
// section server-side). djb2 over the joined fingerprints.
export function fingerprintDigest(fingerprints: string[]): string {
  let h = 5381;
  const joined = fingerprints.join('\n');
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  }
  return `${fingerprints.length}:${h.toString(16)}`;
}

// Dedupe a window's sections by fingerprint — the request the edge
// function expects. Insertion-ordered, so the response array aligns
// with `fingerprints`.
export function dedupeSections(sections: ClassifiableSection[]): {
  fingerprints: string[];
  unique: ClassifiableSection[];
} {
  const byFingerprint = new Map<string, ClassifiableSection>();
  for (const s of sections) {
    const fp = sectionFingerprint(s);
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, s);
  }
  return {
    fingerprints: [...byFingerprint.keys()],
    unique: [...byFingerprint.values()],
  };
}

// Turn the edge function's order-aligned response back into a
// fingerprint-keyed map, dropping anything malformed.
export function correlateAiTags(
  fingerprints: string[],
  rawTags: unknown,
): Map<string, AiSectionTag> {
  const out = new Map<string, AiSectionTag>();
  if (!Array.isArray(rawTags)) return out;
  rawTags.forEach((raw, i) => {
    if (i >= fingerprints.length) return;
    const tag = parseAiTag(raw);
    if (tag) out.set(fingerprints[i], tag);
  });
  return out;
}
