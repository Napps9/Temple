import { z } from 'zod';

// The shape of a single programming section. Persisted in
// class_programming.sections as a JSONB array. Keys are snake_case
// and persisted; display labels can change freely.
//
// section_format is a display-shape tag — it drives the entry form
// the member sees at log time, not the storage shape of their
// result. See src/lib/track-sections.ts (PR 2).
//
// Legacy rows from before migration 0024 may still arrive on read
// as { title, body } only — parseSection() coerces those to the new
// shape so a client running mid-deploy never crashes.

export const SECTION_CATEGORIES = [
  { key: 'strength_and_skill', label: 'Strength & Skill' },
  { key: 'wod', label: 'WOD' },
  { key: 'primer', label: 'Primer' },
  { key: 'mobility', label: 'Mobility' },
  { key: 'accessories', label: 'Accessories' },
  { key: 'warm_up', label: 'Warm-up' },
  { key: 'miscellaneous', label: 'Miscellaneous' },
] as const;

export const SECTION_FORMATS = [
  { key: 'for_time', label: 'For time' },
  { key: 'amrap', label: 'AMRAP' },
  { key: 'emom', label: 'EMOM' },
  { key: 'intervals', label: 'Intervals' },
  { key: 'strength_sets', label: 'Strength sets' },
  { key: 'max_load', label: 'Max load' },
  { key: 'no_score', label: 'No score' },
  { key: 'other', label: 'Other' },
] as const;

export type SectionCategoryKey = (typeof SECTION_CATEGORIES)[number]['key'];
export type SectionFormatKey = (typeof SECTION_FORMATS)[number]['key'];

const CATEGORY_KEYS: SectionCategoryKey[] = SECTION_CATEGORIES.map(
  (c) => c.key,
);
const FORMAT_KEYS: SectionFormatKey[] = SECTION_FORMATS.map((f) => f.key);

const CATEGORY_LABEL_BY_KEY = new Map<string, string>(
  SECTION_CATEGORIES.map((c) => [c.key, c.label]),
);
const CATEGORY_KEY_BY_LABEL = new Map<string, string>(
  SECTION_CATEGORIES.map((c) => [c.label, c.key]),
);

export const sectionSchema = z.object({
  section_category: z.enum(CATEGORY_KEYS as [string, ...string[]]),
  section_format: z.enum(FORMAT_KEYS as [string, ...string[]]),
  title: z.string(),
  body: z.string(),
  leaderboard_enabled: z.boolean().optional(),
});

// The zod-inferred type widens enums to string. Override the two
// enum fields so consumers get the narrow key unions for switch/
// dispatch ergonomics.
export type Section = Omit<
  z.infer<typeof sectionSchema>,
  'section_category' | 'section_format' | 'leaderboard_enabled'
> & {
  section_category: SectionCategoryKey;
  section_format: SectionFormatKey;
  leaderboard_enabled: boolean;
};

export function categoryLabel(key: SectionCategoryKey): string {
  return CATEGORY_LABEL_BY_KEY.get(key) ?? key;
}

export function formatLabel(key: SectionFormatKey): string {
  return SECTION_FORMATS.find((f) => f.key === key)?.label ?? key;
}

// Auto-fill suggestion for the title input. The modal calls this on
// every category pick; the call site decides whether to overwrite the
// current title (overwrite only when the existing title still matches
// a category label, so "Primer — shoulders" survives a re-pick).
export function categoryToTitle(key: SectionCategoryKey): string {
  return categoryLabel(key);
}

// True when the title is a category label (and is therefore safe to
// overwrite on a category re-pick). Includes the empty string so the
// first category pick always fills the title.
export function titleMatchesAnyCategory(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed === '') return true;
  return CATEGORY_KEY_BY_LABEL.has(trimmed);
}

// Coerce one section from raw JSON into the current shape. Tolerates:
//   - legacy { title, body } pre-migration → miscellaneous / other
//   - missing title → "" (the modal will auto-fill it on next edit)
//   - missing body  → ""
//   - unknown category / format keys → fall back to miscellaneous /
//     other rather than throwing, so a forward-rolled DB key doesn't
//     break a stale client
export function parseSection(raw: unknown): Section {
  if (typeof raw !== 'object' || raw === null) {
    return {
      section_category: 'miscellaneous',
      section_format: 'other',
      title: '',
      body: '',
      leaderboard_enabled: false,
    };
  }
  const obj = raw as Record<string, unknown>;
  const rawCategory =
    typeof obj.section_category === 'string' ? obj.section_category : null;
  const rawFormat =
    typeof obj.section_format === 'string' ? obj.section_format : null;
  return {
    section_category:
      rawCategory && (CATEGORY_KEYS as string[]).includes(rawCategory)
        ? (rawCategory as SectionCategoryKey)
        : 'miscellaneous',
    section_format:
      rawFormat && (FORMAT_KEYS as string[]).includes(rawFormat)
        ? (rawFormat as SectionFormatKey)
        : 'other',
    title: typeof obj.title === 'string' ? obj.title : '',
    body: typeof obj.body === 'string' ? obj.body : '',
    leaderboard_enabled: obj.leaderboard_enabled === true,
  };
}

export function parseSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseSection);
}
