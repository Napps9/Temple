import { describe, expect, it } from 'vitest';

import {
  addDays,
  classEditWindow,
  DEFAULT_EDIT_WEEKS,
  describeEditTarget,
  matchMembers,
  memberStatus,
  sanitiseClassEdit,
  sanitiseMemberQuery,
  type ClassEditRequest,
} from './chat-lookup';

const roster = [
  { name: 'Marcus Webb' },
  { name: 'Jo Marchant' },
  { name: 'Marcia Webb' },
  { name: 'Sarah Jones' },
];

describe('sanitiseMemberQuery', () => {
  it('takes the query off the tool payload or a bare string', () => {
    expect(sanitiseMemberQuery({ query: '  Marcus   Webb ' })).toBe('Marcus Webb');
    expect(sanitiseMemberQuery('Sarah')).toBe('Sarah');
  });

  it('refuses nothing, one letter and essays', () => {
    expect(sanitiseMemberQuery({ query: ' ' })).toBeNull();
    expect(sanitiseMemberQuery({ query: 'm' })).toBeNull();
    expect(sanitiseMemberQuery({ query: 'x'.repeat(61) })).toBeNull();
    expect(sanitiseMemberQuery(null)).toBeNull();
  });
});

describe('matchMembers', () => {
  it('answers with the one person when a name part matches exactly', () => {
    expect(matchMembers(roster, 'Marcus')).toEqual([{ name: 'Marcus Webb' }]);
    expect(matchMembers(roster, 'marcus webb')).toEqual([{ name: 'Marcus Webb' }]);
  });

  it('offers the candidates when a fragment could be several people', () => {
    expect(matchMembers(roster, 'marc')).toEqual([
      { name: 'Marcia Webb' },
      { name: 'Marcus Webb' },
      { name: 'Jo Marchant' },
    ]);
  });

  it('keeps a shared surname as a choice rather than guessing', () => {
    expect(matchMembers(roster, 'Webb')).toEqual([
      { name: 'Marcia Webb' },
      { name: 'Marcus Webb' },
    ]);
  });

  it('returns nothing when no one matches', () => {
    expect(matchMembers(roster, 'Zebedee')).toEqual([]);
  });

  it('caps the pick list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Sam Test${i}` }));
    expect(matchMembers(many, 'sam')).toHaveLength(8);
  });
});

describe('memberStatus', () => {
  const base = {
    isIntro: false,
    isActive: true,
    isExpiringSoon: false,
    isExpired: false,
    daysUntilExpiry: null,
  };

  it('leads with the thing that needs attention', () => {
    expect(memberStatus({ ...base, isExpired: true, isActive: false })).toEqual({
      label: 'Lapsed',
      tone: 'bad',
    });
    expect(
      memberStatus({ ...base, isExpiringSoon: true, daysUntilExpiry: 5 }),
    ).toEqual({ label: 'Expiring in 5 days', tone: 'warn' });
    expect(
      memberStatus({ ...base, isExpiringSoon: true, daysUntilExpiry: 1 }),
    ).toEqual({ label: 'Expiring in 1 day', tone: 'warn' });
    expect(
      memberStatus({ ...base, isExpiringSoon: true, daysUntilExpiry: 0 }),
    ).toEqual({ label: 'Expires today', tone: 'warn' });
  });

  it('distinguishes an intro from a full membership, and neither from none', () => {
    expect(memberStatus({ ...base, isIntro: true }).label).toBe('On an intro');
    expect(memberStatus(base).label).toBe('Active');
    expect(memberStatus({ ...base, isActive: false })).toEqual({
      label: 'No membership',
      tone: 'neutral',
    });
  });
});

describe('sanitiseClassEdit', () => {
  it('takes a day-and-capacity change', () => {
    expect(
      sanitiseClassEdit({ class_type: ' CrossFit ', days: [6], capacity: 20 }),
    ).toEqual({
      classType: 'CrossFit',
      days: [6],
      from: null,
      to: null,
      capacity: 20,
      durationMinutes: null,
      shiftMinutes: null,
    });
  });

  it('drops a request that changes nothing', () => {
    expect(sanitiseClassEdit({ days: [2] })).toBeNull();
    expect(sanitiseClassEdit({ days: [2], shift_minutes: 0 })).toBeNull();
    expect(sanitiseClassEdit(null)).toBeNull();
  });

  it('refuses values outside the bulk editor’s own bounds', () => {
    expect(sanitiseClassEdit({ capacity: 0, days: [1] })).toBeNull();
    expect(sanitiseClassEdit({ capacity: 5000 })).toBeNull();
    expect(sanitiseClassEdit({ duration_minutes: 2 })).toBeNull();
    expect(sanitiseClassEdit({ shift_minutes: 5000 })).toBeNull();
  });

  it('cleans the day list and rejects a backwards range', () => {
    expect(sanitiseClassEdit({ days: [6, 6, 1, 9, -1], capacity: 12 })?.days).toEqual([
      1, 6,
    ]);
    expect(
      sanitiseClassEdit({ from: '2026-03-10', to: '2026-03-01', capacity: 12 }),
    ).toBeNull();
  });

  it('keeps a negative shift — earlier is a real instruction', () => {
    expect(sanitiseClassEdit({ shift_minutes: -30 })?.shiftMinutes).toBe(-30);
  });
});

describe('classEditWindow', () => {
  const req = (over: Partial<ClassEditRequest> = {}): ClassEditRequest => ({
    classType: null,
    days: null,
    from: null,
    to: null,
    capacity: 20,
    durationMinutes: null,
    shiftMinutes: null,
    ...over,
  });

  it('bounds an open-ended request rather than running forever', () => {
    const w = classEditWindow(req(), '2026-02-08');
    expect(w.start).toBe('2026-02-08');
    expect(w.end).toBe(addDays('2026-02-08', DEFAULT_EDIT_WEEKS * 7));
    expect(w.bounded).toBe(true);
  });

  it('honours a stated end date and never starts in the past', () => {
    const w = classEditWindow(
      req({ from: '2026-03-01', to: '2026-03-31' }),
      '2026-02-08',
    );
    expect(w).toEqual({ start: '2026-03-01', end: '2026-03-31', bounded: false });
    expect(
      classEditWindow(req({ from: '2025-01-01', to: '2026-03-31' }), '2026-02-08')
        .start,
    ).toBe('2026-02-08');
  });

  it('rolls over months and years', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('describeEditTarget', () => {
  const req = (over: Partial<ClassEditRequest>): ClassEditRequest => ({
    classType: null,
    days: null,
    from: null,
    to: null,
    capacity: 20,
    durationMinutes: null,
    shiftMinutes: null,
    ...over,
  });

  it('names the target the way the owner would have', () => {
    expect(describeEditTarget(req({ days: [6] }), 12)).toBe('12 classes — Saturday');
    expect(describeEditTarget(req({ days: [1, 2, 3, 4, 5] }), 40)).toBe(
      '40 classes — weekday',
    );
    expect(describeEditTarget(req({ days: [2, 4], classType: 'Spin' }), 8)).toBe(
      '8 classes — Tue/Thu Spin',
    );
    expect(describeEditTarget(req({}), 1)).toBe('1 class');
  });
});
