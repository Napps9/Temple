// Weekly timetable definitions + occurrence expansion for the seeder.
// Day numbering is 0=Sunday..6=Saturday, matching class_recurrences
// (0005) and gym_hours (0003).

export type ClassTypeDef = { name: string; color: string };

export type RecurrenceDef = {
  classType: string;
  daysOfWeek: number[];
  times: string[]; // 'HH:MM' local
  durationMinutes: number;
  capacity: number;
};

export const CLASS_TYPE_DEFS: ClassTypeDef[] = [
  { name: 'CrossFit', color: '#DC2626' },
  { name: 'Olympic Lifting', color: '#F59E0B' },
  { name: 'Gymnastics', color: '#8B5CF6' },
  { name: 'Open Gym', color: '#10B981' },
  { name: 'Engine', color: '#06B6D4' },
];

// ~21 slots/week. Weekdays carry the volume; Saturday gets the
// specialist sessions; Sunday is closed (mirrors gym_hours below).
export const RECURRENCE_DEFS: RecurrenceDef[] = [
  { classType: 'CrossFit', daysOfWeek: [1, 2, 3, 4, 5], times: ['06:00', '17:30'], durationMinutes: 60, capacity: 14 },
  { classType: 'Olympic Lifting', daysOfWeek: [2, 4], times: ['18:30'], durationMinutes: 75, capacity: 10 },
  { classType: 'Gymnastics', daysOfWeek: [6], times: ['09:00'], durationMinutes: 60, capacity: 12 },
  { classType: 'Open Gym', daysOfWeek: [1, 3, 5], times: ['12:00'], durationMinutes: 60, capacity: 20 },
  { classType: 'Engine', daysOfWeek: [2, 4], times: ['07:15'], durationMinutes: 45, capacity: 16 },
];

// Hyrox-discipline counterpart to CLASS_TYPE_DEFS/RECURRENCE_DEFS
// above — same slot budget and shape, different programming: race
// simulations, compromised running and strength built for the eight
// stations rather than CrossFit's WOD/oly/gymnastics split.
export const CLASS_TYPE_DEFS_HYROX: ClassTypeDef[] = [
  { name: 'Hyrox Simulation', color: '#DC2626' },
  { name: 'Compromised Running', color: '#2563EB' },
  { name: 'Strength for Hyrox', color: '#F59E0B' },
  { name: 'Open Gym', color: '#10B981' },
  { name: 'Engine Builder', color: '#06B6D4' },
];

export const RECURRENCE_DEFS_HYROX: RecurrenceDef[] = [
  { classType: 'Hyrox Simulation', daysOfWeek: [1, 3, 5], times: ['06:00', '17:30'], durationMinutes: 75, capacity: 14 },
  { classType: 'Compromised Running', daysOfWeek: [2, 4], times: ['06:00'], durationMinutes: 45, capacity: 16 },
  { classType: 'Strength for Hyrox', daysOfWeek: [2, 4], times: ['18:30'], durationMinutes: 60, capacity: 10 },
  { classType: 'Open Gym', daysOfWeek: [1, 3, 5], times: ['12:00'], durationMinutes: 60, capacity: 20 },
  { classType: 'Engine Builder', daysOfWeek: [6], times: ['09:00'], durationMinutes: 60, capacity: 16 },
];

// gym_hours rows: [day_of_week, opens_at, closes_at]. No Sunday row =
// closed, which is how the app reads absence.
export const GYM_HOURS: [number, string, string][] = [
  [1, '06:00', '21:00'],
  [2, '06:00', '21:00'],
  [3, '06:00', '21:00'],
  [4, '06:00', '21:00'],
  [5, '06:00', '21:00'],
  [6, '08:00', '14:00'],
];

// Converts a local wall-clock time in an IANA zone to a UTC ISO string
// without a timezone library: format a UTC guess back into the target
// zone, measure the drift, correct once (a second pass settles the
// rare DST-transition edge).
export function localToUtc(dateISO: string, time: string, tz: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  let utcMs = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    utcMs += Date.UTC(y, m - 1, d, hh, mm, 0) - asIfUtc;
  }
  return new Date(utcMs).toISOString();
}

export type Occurrence = { dateISO: string; time: string; startsAtUtc: string };

// All occurrences of a recurrence between two dates (inclusive),
// expanded in date order — the same walk extend_recurrence does.
export function expandOccurrences(
  def: RecurrenceDef,
  startISO: string,
  endISO: string,
  tz: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t);
    if (!def.daysOfWeek.includes(day.getUTCDay())) continue;
    const dateISO = day.toISOString().slice(0, 10);
    for (const time of def.times) {
      out.push({ dateISO, time, startsAtUtc: localToUtc(dateISO, time, tz) });
    }
  }
  return out;
}

export function isoDateOffset(baseISO: string, days: number): string {
  const d = new Date(`${baseISO}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
