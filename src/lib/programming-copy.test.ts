import { describe, expect, it } from 'vitest';

import {
  clearPlan,
  clearSentence,
  copyPlan,
  copySentence,
  dayLabel,
  mondayOf,
  sectionLine,
  shiftDays,
  weekDays,
  type ProgrammedDay,
} from './programming-copy';
import type { Section } from './programming';

function section(partial: Partial<Section>): Section {
  return {
    section_category: 'wod',
    section_format: 'for_time',
    title: '',
    body: '',
    leaderboard_enabled: false,
    ...partial,
  };
}

const TYPES = [
  { id: 'ct-wod', name: 'Barbell club' },
  { id: 'ct-open', name: 'Open gym' },
];

function day(date: string, classTypeId: string, sections: Section[]): ProgrammedDay {
  return { date, classTypeId, sections };
}

describe('weeks run Monday to Sunday', () => {
  it('finds the Monday from any day inside the week', () => {
    expect(mondayOf('2026-08-05')).toBe('2026-08-03'); // Wednesday
    expect(mondayOf('2026-08-03')).toBe('2026-08-03'); // Monday itself
    // Sunday belongs to the week that just ended, not the one starting.
    expect(mondayOf('2026-08-09')).toBe('2026-08-03');
  });

  it('walks seven days and crosses months', () => {
    expect(weekDays('2026-07-27')).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('labels a day the way a coach reads a calendar', () => {
    expect(dayLabel('2026-08-03')).toBe('Monday 3 Aug');
  });
});

// The coach has to recognise what they wrote. A category label describes
// half a gym's programming and identifies none of it.
describe('naming a section', () => {
  it('uses the coach’s own title', () => {
    expect(sectionLine(section({ title: 'Back squat', body: '5x5 @ 80%' }))).toBe(
      'Back squat — 5x5 @ 80%',
    );
  });

  it('falls back to the category only when there is no title', () => {
    expect(sectionLine(section({ body: '21-15-9' }))).toBe('WOD — 21-15-9');
    expect(sectionLine(section({}))).toBe('WOD');
  });

  it('takes the first line and trims a long one', () => {
    expect(sectionLine(section({ title: 'Metcon', body: 'AMRAP 20\nthen 400m run' }))).toBe(
      'Metcon — AMRAP 20',
    );
    expect(sectionLine(section({ title: 'Metcon', body: 'x'.repeat(90) }))).toMatch(/…$/);
  });
});

describe('copying a week forward', () => {
  const source = [
    day('2026-07-27', 'ct-wod', [section({ title: 'Back squat', body: '5x5' })]),
    day('2026-07-29', 'ct-wod', [section({ title: 'Metcon', body: 'Fran' })]),
    day('2026-07-29', 'ct-open', [section({ title: 'Skills' })]),
  ];

  it('lands each day on the same weekday a week later', () => {
    const card = copyPlan({
      fromMonday: '2026-07-27',
      toMonday: '2026-08-03',
      classTypes: TYPES,
      source,
      destination: [],
    });
    expect(card.rows.map((r) => `${r.day} ${r.classType}`)).toEqual([
      'Monday 3 Aug Barbell club',
      'Wednesday 5 Aug Barbell club',
      'Wednesday 5 Aug Open gym',
    ]);
    expect(card.rows[0].incoming).toEqual(['Back squat — 5x5']);
  });

  // The robbery this exists to prevent, and the reason the preview is the
  // content rather than a count.
  it('shows the coach exactly what it is about to overwrite', () => {
    const card = copyPlan({
      fromMonday: '2026-07-27',
      toMonday: '2026-08-03',
      classTypes: TYPES,
      source,
      destination: [
        day('2026-08-05', 'ct-wod', [
          section({ title: 'Partner chipper', body: 'written Tuesday night' }),
        ]),
      ],
    });
    const wednesday = card.rows.find((r) => r.day === 'Wednesday 5 Aug' && r.classType === 'Barbell club')!;
    expect(wednesday.replacing).toEqual(['Partner chipper — written Tuesday night']);
    expect(card.replacedDays).toBe(1);
  });

  // Copying nothing onto something is a delete wearing a copy's clothes.
  it('does not blank a day the source week left empty', () => {
    const card = copyPlan({
      fromMonday: '2026-07-27',
      toMonday: '2026-08-03',
      classTypes: TYPES,
      source: [],
      destination: [day('2026-08-03', 'ct-wod', [section({ title: 'Keep me' })])],
    });
    expect(card.rows).toEqual([]);
    expect(card.replacedDays).toBe(0);
  });

  it('names both weeks so nobody agrees to the wrong one', () => {
    const card = copyPlan({
      fromMonday: '2026-07-27',
      toMonday: '2026-08-03',
      classTypes: TYPES,
      source,
      destination: [],
    });
    expect(card.heading).toBe('The week of 27 Jul onto the week of 3 Aug');
  });
});

describe('the sentence above the card', () => {
  const source = [
    day('2026-07-27', 'ct-wod', [section({ title: 'A' })]),
    day('2026-07-29', 'ct-wod', [section({ title: 'B' })]),
  ];

  it('says nothing is lost when nothing is', () => {
    const card = copyPlan({
      fromMonday: '2026-07-27',
      toMonday: '2026-08-03',
      classTypes: TYPES,
      source,
      destination: [],
    });
    expect(copySentence(card)).toBe(
      '2 sessions across 2 days, onto days with nothing on them.',
    );
  });

  it('names the overwrite before it is agreed to', () => {
    const card = copyPlan({
      fromMonday: '2026-07-27',
      toMonday: '2026-08-03',
      classTypes: TYPES,
      source,
      destination: [day('2026-08-03', 'ct-wod', [section({ title: 'Mine' })])],
    });
    expect(copySentence(card)).toBe(
      '2 sessions across 2 days. 1 already has programming and it will be replaced.',
    );
  });

  it('says plainly when there is nothing to copy', () => {
    const card = copyPlan({
      fromMonday: '2026-07-27',
      toMonday: '2026-08-03',
      classTypes: TYPES,
      source: [],
      destination: [],
    });
    expect(copySentence(card)).toBe('There is nothing programmed that week to copy.');
  });
});

describe('clearing a day', () => {
  it('renders what is about to be deleted, not a count of it', () => {
    const card = clearPlan({
      date: '2026-08-08',
      classTypes: TYPES,
      existing: [
        day('2026-08-08', 'ct-wod', [
          section({ title: 'Saturday partner WOD', body: 'teams of two' }),
        ]),
      ],
    });
    expect(card.heading).toBe('Saturday 8 Aug');
    expect(card.rows[0].replacing).toEqual(['Saturday partner WOD — teams of two']);
    expect(card.rows[0].incoming).toEqual([]);
    expect(clearSentence(card)).toBe('1 session is deleted. There is no undo.');
  });

  it('says so rather than confirming a delete of nothing', () => {
    const card = clearPlan({ date: '2026-08-08', classTypes: TYPES, existing: [] });
    expect(card.rows).toEqual([]);
    expect(clearSentence(card)).toBe('There is nothing programmed that day.');
  });
});
