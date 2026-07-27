import { describe, expect, it } from 'vitest';

import {
  dayTickState,
  formatDayLabel,
  groupSlotsByDay,
  slotKey,
  toggleDay,
  type ReopenSlot,
} from './closure-reopen';

function mkSlot(
  localDate: string,
  time: string,
  extras: Partial<ReopenSlot> = {},
): ReopenSlot {
  return {
    recurrence_id: 'rec-1',
    starts_at: `${localDate}T${time}:00.000Z`,
    local_date: localDate,
    class_type_name: 'CrossFit',
    duration_minutes: 60,
    capacity: 12,
    ...extras,
  };
}

describe('groupSlotsByDay', () => {
  it('groups by the gym-local day and sorts both levels', () => {
    const grouped = groupSlotsByDay([
      mkSlot('2026-12-28', '18:00'),
      mkSlot('2026-12-27', '10:00'),
      mkSlot('2026-12-28', '06:00'),
    ]);
    expect(grouped.map((d) => d.date)).toEqual(['2026-12-27', '2026-12-28']);
    expect(grouped[1].slots.map((s) => s.starts_at)).toEqual([
      '2026-12-28T06:00:00.000Z',
      '2026-12-28T18:00:00.000Z',
    ]);
  });

  it('keeps two schedules that land on the same day and time apart', () => {
    const grouped = groupSlotsByDay([
      mkSlot('2026-12-27', '10:00', { recurrence_id: 'rec-1' }),
      mkSlot('2026-12-27', '10:00', { recurrence_id: 'rec-2' }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].slots).toHaveLength(2);
    expect(new Set(grouped[0].slots.map(slotKey)).size).toBe(2);
  });

  it('groups by local_date, not by the UTC instant', () => {
    // 23:00 local on the 27th in a UTC+X gym is the 28th in UTC. The day
    // the gym means is the one on the row.
    const grouped = groupSlotsByDay([
      { ...mkSlot('2026-12-27', '10:00'), starts_at: '2026-12-28T02:00:00.000Z' },
    ]);
    expect(grouped[0].date).toBe('2026-12-27');
  });

  it('returns nothing for nothing', () => {
    expect(groupSlotsByDay([])).toEqual([]);
  });
});

describe('dayTickState / toggleDay', () => {
  const day = groupSlotsByDay([
    mkSlot('2026-12-27', '10:00'),
    mkSlot('2026-12-27', '18:00'),
  ])[0];
  const [a, b] = day.slots;

  it('reads all / some / none', () => {
    expect(dayTickState(day, new Set())).toBe('all');
    expect(dayTickState(day, new Set([slotKey(a)]))).toBe('some');
    expect(dayTickState(day, new Set([slotKey(a), slotKey(b)]))).toBe('none');
  });

  it('clears a fully ticked day', () => {
    expect([...toggleDay(day, new Set())].sort()).toEqual(
      [slotKey(a), slotKey(b)].sort(),
    );
  });

  it('fills a part-ticked day rather than clearing it', () => {
    expect([...toggleDay(day, new Set([slotKey(a)]))]).toEqual([]);
  });

  it('fills an empty day', () => {
    expect([...toggleDay(day, new Set([slotKey(a), slotKey(b)]))]).toEqual([]);
  });

  it('leaves other days alone', () => {
    const other = slotKey(mkSlot('2026-12-30', '10:00'));
    expect(toggleDay(day, new Set([other])).has(other)).toBe(true);
  });
});

describe('formatDayLabel', () => {
  it('does not slide a day with the viewer offset', () => {
    expect(formatDayLabel('2026-12-27')).toMatch(/27/);
    expect(formatDayLabel('2027-01-01')).toMatch(/1/);
  });
});
