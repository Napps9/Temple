// Pure math for pause / resume.
//
// Pause holds pre-paid time; resume hands that time back. The new
// paid_period_end on resume is the old paid_period_end plus however
// long the sub was paused. Same arithmetic if pause_started_at is
// before now() (member-initiated pause that took effect immediately)
// or in the past (staff-set pause with retroactive effect — rare
// but possible).
//
// This module mirrors the SQL pause-resume helper that lands with
// the resume_subscription RPC in Track B sprint 3. UI uses it to
// preview "Access through {date}" before staff confirms a resume.

/**
 * How many milliseconds did the subscription spend paused?
 * Clamped at zero — a resume-before-pause-started (which shouldn't
 * happen but might from clock skew) returns zero rather than a
 * negative offset that would shorten access.
 */
export function pauseDurationMs(params: {
  pauseStartedAt: Date;
  resumeAt: Date;
}): number {
  const diff = params.resumeAt.getTime() - params.pauseStartedAt.getTime();
  return diff > 0 ? diff : 0;
}

/**
 * Compute the new paid_period_end after a resume.
 *
 * - paidPeriodEnd null → null (subs with no period end — e.g. a
 *   credit pack that never billed — have nothing to extend).
 * - Otherwise: shift forward by exactly the pause duration so the
 *   member gets back the time they paid for and didn't use.
 */
export function computeResumedPaidPeriodEnd(params: {
  paidPeriodEnd: Date | null;
  pauseStartedAt: Date;
  resumeAt: Date;
}): Date | null {
  if (!params.paidPeriodEnd) return null;
  const offset = pauseDurationMs({
    pauseStartedAt: params.pauseStartedAt,
    resumeAt: params.resumeAt,
  });
  return new Date(params.paidPeriodEnd.getTime() + offset);
}
