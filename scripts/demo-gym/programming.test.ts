import { describe, expect, it } from 'vitest';

import { CROSSFIT_WOD_TEMPLATES, HYROX_WOD_TEMPLATES, buildProgrammingRows } from './programming';
import { SECTION_CATEGORIES, SECTION_FORMATS } from '../../src/lib/programming';

const VALID_CATEGORIES = new Set<string>(SECTION_CATEGORIES.map((c) => c.key));
const VALID_FORMATS = new Set<string>(SECTION_FORMATS.map((f) => f.key));

function checkTemplateMap(templates: Record<string, unknown>) {
  for (const days of Object.values(templates)) {
    expect(Array.isArray(days)).toBe(true);
    expect((days as unknown[]).length).toBeGreaterThan(0);
    for (const day of days as { section_category: string; section_format: string; title: string }[][]) {
      expect(day.length).toBeGreaterThan(0);
      for (const s of day) {
        expect(VALID_CATEGORIES.has(s.section_category)).toBe(true);
        expect(VALID_FORMATS.has(s.section_format)).toBe(true);
        expect(s.title.length).toBeGreaterThan(0);
      }
    }
  }
}

describe('CROSSFIT_WOD_TEMPLATES / HYROX_WOD_TEMPLATES', () => {
  it('every template uses a real section category and format', () => {
    checkTemplateMap(CROSSFIT_WOD_TEMPLATES);
    checkTemplateMap(HYROX_WOD_TEMPLATES);
  });

  it('never programs Open Gym in either discipline', () => {
    expect('Open Gym' in CROSSFIT_WOD_TEMPLATES).toBe(false);
    expect('Open Gym' in HYROX_WOD_TEMPLATES).toBe(false);
  });
});

describe('buildProgrammingRows', () => {
  const classTypeIdByName = new Map([
    ['CrossFit', 'ct-crossfit'],
    ['Open Gym', 'ct-open-gym'],
  ]);
  const sessions = [
    { class_type_id: 'ct-crossfit', starts_at: '2026-06-01T06:00:00.000Z' },
    { class_type_id: 'ct-crossfit', starts_at: '2026-06-01T17:30:00.000Z' }, // same day, second slot
    { class_type_id: 'ct-crossfit', starts_at: '2026-06-03T06:00:00.000Z' },
    { class_type_id: 'ct-open-gym', starts_at: '2026-06-02T12:00:00.000Z' },
    { class_type_id: null, starts_at: '2026-06-04T06:00:00.000Z' },
  ];

  it('emits exactly one row per (class type, date), skipping class types with no template', () => {
    const rows = buildProgrammingRows(sessions, classTypeIdByName, 'gym-1', 'owner-1', CROSSFIT_WOD_TEMPLATES);
    expect(rows).toHaveLength(2); // 2026-06-01 and 2026-06-03, deduped across the two same-day slots
    expect(new Set(rows.map((r) => r.date))).toEqual(new Set(['2026-06-01', '2026-06-03']));
    expect(rows.every((r) => r.class_type_id === 'ct-crossfit')).toBe(true);
    expect(rows.every((r) => r.gym_id === 'gym-1' && r.author_id === 'owner-1')).toBe(true);
  });

  it('cycles through the template rotation in date order', () => {
    const manyDates = Array.from({ length: 7 }, (_, i) => ({
      class_type_id: 'ct-crossfit',
      starts_at: `2026-06-0${i + 1}T06:00:00.000Z`,
    }));
    const rows = buildProgrammingRows(manyDates, classTypeIdByName, 'gym-1', 'owner-1', CROSSFIT_WOD_TEMPLATES);
    const rotationLength = CROSSFIT_WOD_TEMPLATES.CrossFit.length;
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted[0].sections).toEqual(CROSSFIT_WOD_TEMPLATES.CrossFit[0]);
    expect(sorted[rotationLength].sections).toEqual(CROSSFIT_WOD_TEMPLATES.CrossFit[0]);
  });

  it('returns nothing for a template map with no matching class types', () => {
    expect(buildProgrammingRows(sessions, classTypeIdByName, 'gym-1', 'owner-1', {})).toEqual([]);
  });
});
