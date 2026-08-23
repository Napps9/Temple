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

export type UpcomingGroup = { label: string; rows: BookingRow[] };

// "This week" ends at the gym's own week boundary (week_starts_on), not
// seven days from now — a Sunday booking is "this week" on Saturday only
// for Sunday-start gyms.
export function groupUpcomingBookings(
  rows: BookingRow[],
  weekStartsOn: 'mon' | 'sun',
  now: Date = new Date(),
): UpcomingGroup[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = start.getDay();
  const diff = weekStartsOn === 'sun' ? -day : day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  const nextWeek = new Date(start);
  nextWeek.setDate(start.getDate() + 7);
  const weekAfter = new Date(start);
  weekAfter.setDate(start.getDate() + 14);

  const groups: UpcomingGroup[] = [
    { label: 'This week', rows: [] },
    { label: 'Next week', rows: [] },
    { label: 'Later', rows: [] },
  ];
  for (const r of rows) {
    const at = new Date(r.starts_at).getTime();
    if (at < nextWeek.getTime()) groups[0].rows.push(r);
    else if (at < weekAfter.getTime()) groups[1].rows.push(r);
    else groups[2].rows.push(r);
  }
  return groups.filter((g) => g.rows.length > 0);
}

// One line under the upcoming list saying what cancelling costs, derived
// from the same cutoff fields isLateCancel reads so the footnote can never
// disagree with the warning. Null when cancelling is always free.
export function describeCancelPolicy(
  rows: BookingRow[],
  gymDefaults: { cancel_cutoff_minutes_before?: number | null } | null | undefined,
): string | null {
  const cutoffs = new Set<string>();
  for (const r of rows) {
    const ct = r.cancelCutoffs;
    if (ct?.cancel_cutoff_mode === 'day_before' && ct.cancel_cutoff_time) {
      cutoffs.add('day_before');
    } else {
      const min =
        ct?.cancel_cutoff_minutes_before ??
        gymDefaults?.cancel_cutoff_minutes_before ??
        0;
      cutoffs.add(`rel:${min}`);
    }
  }
  if (cutoffs.size === 0) return null;
  if (cutoffs.size === 1) {
    const only = [...cutoffs][0];
    if (only === 'day_before') {
      return 'Cancel by the day-before deadline to keep your credit.';
    }
    const min = Number(only.slice(4));
    if (min <= 0) return null;
    return `Cancel up to ${fmtCutoffWindow(min)} before a class to keep your credit.`;
  }
  return "Cancel before each class's deadline to keep your credit — later forfeits it.";
}

function fmtCutoffWindow(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '24 hours' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

export type AttendanceLabel = 'Attended' | 'No-show' | 'Unmarked';

export function attendanceLabel(row: Pick<BookingRow, 'attended_at' | 'no_show'>): AttendanceLabel {
  if (row.attended_at) return 'Attended';
  if (row.no_show) return 'No-show';
  return 'Unmarked';
}
