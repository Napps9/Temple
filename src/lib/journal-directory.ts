// The journal directory's pure rules: month grouping and the one-line
// result summary each row carries. RN-free so both unit-test in node.

import {
  aggregateHeadline,
  FORMAT_SHAPES,
  type SectionAggregates,
} from './track-sections';
import type { SectionFormatKey } from './programming';

export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Preserves the input order (the journal query is already newest-first),
// so groups come out in the order their first row appears.
export function groupByMonth<T extends { performed_at: string }>(
  rows: T[],
  now: Date = new Date(),
): { key: string; label: string; rows: T[] }[] {
  const groups: { key: string; label: string; rows: T[] }[] = [];
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const key = monthKey(r.performed_at);
    let list = byKey.get(key);
    if (!list) {
      list = [];
      byKey.set(key, list);
      groups.push({ key, label: monthLabel(r.performed_at, now), rows: list });
    }
    list.push(r);
  }
  return groups;
}

type SummarySection = SectionAggregates & {
  section_format: SectionFormatKey;
  free_text_result: string | null;
  notes: string | null;
};

// One line per row: the first section's real headline when it has one,
// otherwise an honest count — never a fake result.
export function resultLine(
  sections: SummarySection[],
  legacyCount: number,
): string {
  for (const s of sections) {
    const shape = FORMAT_SHAPES[s.section_format];
    const head =
      shape.kind === 'notes_only'
        ? s.free_text_result?.trim() || null
        : aggregateHeadline(s);
    if (head) {
      return sections.length > 1
        ? `${head} · ${sections.length} sections`
        : head;
    }
  }
  if (sections.length > 0) {
    return `${sections.length} ${sections.length === 1 ? 'section' : 'sections'}`;
  }
  if (legacyCount > 0) {
    return `${legacyCount} ${legacyCount === 1 ? 'result' : 'results'}`;
  }
  return 'No results recorded';
}
