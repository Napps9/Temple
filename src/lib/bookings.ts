export type BookingRow = {
  id: string;
  class_session_id: string;
  starts_at: string;
  duration_minutes: number;
  class_type_name: string | null;
  class_type_color: string | null;
  attended_at: string | null;
  no_show: boolean;
  promoted_from_waitlist: boolean;
};

export type SplitBookings = {
  upcoming: BookingRow[];
  past: BookingRow[];
};

export function splitBookings(rows: BookingRow[], now: Date = new Date()): SplitBookings {
  const upcoming: BookingRow[] = [];
  const past: BookingRow[] = [];
  for (const r of rows) {
    const start = new Date(r.starts_at);
    if (start.getTime() > now.getTime()) {
      upcoming.push(r);
    } else {
      past.push(r);
    }
  }
  upcoming.sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  past.sort(
    (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
  );
  return { upcoming, past };
}

export type AttendanceLabel = 'Attended' | 'No-show' | 'Unmarked';

export function attendanceLabel(row: Pick<BookingRow, 'attended_at' | 'no_show'>): AttendanceLabel {
  if (row.attended_at) return 'Attended';
  if (row.no_show) return 'No-show';
  return 'Unmarked';
}
