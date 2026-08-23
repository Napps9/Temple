import type { QueryClient } from '@tanstack/react-query';

import { dayBeforeCutoffEpoch } from './zoned-time';

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
  cancelCutoffs?: CancelCutoffClassType;
};

export type CancelCutoffClassType = {
  cancel_cutoff_minutes_before: number | null;
  cancel_cutoff_mode: 'relative' | 'day_before' | null;
  cancel_cutoff_time: string | null;
  cancel_cutoff_days_before: number | null;
} | null;

// Mirror the server-side precedence in 0074: class-type day_before wins,
// then class-type relative override, then gym relative default. Shared so
// every cancel affordance shows the same forfeit warning — the bookings
// page used to skip it entirely.
export function isLateCancel(
  startsAt: string,
  classType: CancelCutoffClassType,
  gymDefaults:
    | {
        timezone?: string | null;
        cancel_cutoff_minutes_before?: number | null;
      }
    | null
    | undefined,
): boolean {
  const start = new Date(startsAt);
  if (classType?.cancel_cutoff_mode === 'day_before' && classType.cancel_cutoff_time) {
    const cutoff = dayBeforeCutoffEpoch(
      startsAt,
      gymDefaults?.timezone || 'UTC',
      classType.cancel_cutoff_days_before ?? 1,
      classType.cancel_cutoff_time,
    );
    return Date.now() >= cutoff;
  }
  const relativeMin =
    classType?.cancel_cutoff_minutes_before ??
    gymDefaults?.cancel_cutoff_minutes_before ??
    0;
  const cancelCutoffMs = relativeMin * 60 * 1000;
  return cancelCutoffMs > 0 && start.getTime() - cancelCutoffMs <= Date.now();
}

// Every cache a book / cancel touches. Kept in one place because these
// lists used to be maintained per-call-site and drifted: the class-detail
// modal's book path only refreshed its own session, so the calendar's
// "Booked" badge, the next-class card, the agenda counts, and the member's
// credit balance all stayed stale until an unrelated refetch. Any place
// that books, cancels or refunds a booking calls this.
export function invalidateBookingCaches(qc: QueryClient): void {
  const keys = [
    ['class-bookings'],
    ['my-future-bookings'],
    ['my-future-bookings-set'],
    ['my-next-booking'],
    ['my-bookings'],
    ['agenda-booking-counts'],
    ['my-subscriptions'],
    ['recommended-class'],
    // The new-member "Book your first class" step reads this count; without
    // it the checklist item never ticks after the first booking.
    ['member-onboarding-bookings'],
  ];
  for (const queryKey of keys) {
    void qc.invalidateQueries({ queryKey });
  }
}

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
