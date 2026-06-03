// Pure aggregation helpers for attendance.tsx. The screen reads
// class_bookings + class_sessions for a window; these helpers bucket
// the raw rows into the shapes the chart and breakdown table expect.

export type AttendanceBooking = {
  class_session_id: string;
  attended_at: string | null;
  no_show: boolean;
};

export type AttendanceSession = {
  id: string;
  class_type_id: string | null;
  starts_at: string;
};

export type AttendanceBucket = {
  class_type_id: string | null;
  attended: number;
  no_show: number;
  unmarked: number;
};

export type DayBucket = {
  day: string; // YYYY-MM-DD
  attended: number;
};

function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export function bucketByClassType(
  bookings: AttendanceBooking[],
  sessions: AttendanceSession[],
): AttendanceBucket[] {
  const sessionMap = new Map<string, AttendanceSession>();
  for (const s of sessions) sessionMap.set(s.id, s);

  const acc = new Map<string | null, AttendanceBucket>();
  for (const b of bookings) {
    const session = sessionMap.get(b.class_session_id);
    if (!session) continue;
    const key = session.class_type_id;
    if (!acc.has(key)) {
      acc.set(key, { class_type_id: key, attended: 0, no_show: 0, unmarked: 0 });
    }
    const bucket = acc.get(key)!;
    if (b.attended_at !== null) bucket.attended += 1;
    else if (b.no_show) bucket.no_show += 1;
    else bucket.unmarked += 1;
  }
  return [...acc.values()];
}

export function bucketByDay(
  bookings: AttendanceBooking[],
  sessions: AttendanceSession[],
  range: { start: string; end: string },
): DayBucket[] {
  const sessionMap = new Map<string, AttendanceSession>();
  for (const s of sessions) sessionMap.set(s.id, s);

  const acc = new Map<string, number>();
  for (const b of bookings) {
    if (b.attended_at === null) continue;
    const session = sessionMap.get(b.class_session_id);
    if (!session) continue;
    const day = isoDate(session.starts_at);
    if (day < range.start || day > range.end) continue;
    acc.set(day, (acc.get(day) ?? 0) + 1);
  }

  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, attended]) => ({ day, attended }));
}
