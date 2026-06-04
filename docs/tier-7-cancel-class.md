# Tier 7 — Cancel a class from the timetable

## Context

Owners need to cancel scheduled classes — single sessions and recurring series — when the gym closes, an instructor leaves, demand changes. Today the timetable is append-only from the operator's side; the only way to "remove" a class is to let it pass. Tier 7 ships the cancel affordance with credit-refund semantics and a Google-Calendar-shaped recurrence prompt.

## Decisions

- **Refund credits**: yes. Credit-pack subs get the credit back on `credit_balance`; active comp grants get it back on `credits_remaining`. Unlimited subs get nothing (nothing to refund). The original entitlement source isn't recorded today, so refund infers: comp grant first if it was active at the session's `starts_at`, else current active credit-pack sub, else nothing. Document the limitation; a future `class_bookings.entitlement_source_id` column makes it exact.
- **Past sessions are not cancellable**: RPCs assert `starts_at > now()`; UI hides the button on past rows.
- **Hard delete, not soft**: no `class_sessions.cancelled_at`. Cascade deletes the booking row — member sees the class gone. Trade-off accepted; soft-delete is a follow-up if it bites.

## Migration — `0018_cancel_session.sql`

Three RPCs, all SECURITY DEFINER, all gated on `user_can_admin_or_coach(gym_id)`. Each returns `int` = sessions cancelled. Body order is load-bearing — see comment in the migration.

- **`cancel_session(p_session_id)`** — one session. Order: read booked profile_ids → refund credits → delete waitlist → delete session (cascade deletes bookings; promotion trigger's `starts_at IS NULL` guard kicks in because the session row is gone, so no spurious promotions into a vanishing class).
- **`cancel_recurrence_from(p_session_id)`** — this session + all future siblings of the same `recurrence_id`. Same per-session order, applied in a loop. Then `update class_recurrences set ends_on = (p_session.starts_at - interval '1 day')::date` so re-materialisation won't re-create them.
- **`cancel_recurrence(p_recurrence_id)`** — every future session in the series + delete the `class_recurrences` row. Past sessions stay as history.

Cancel any pending cover requests for affected sessions in all three paths.

## UI

- **`ClassDetailModal.tsx`** (manage mode): add red "Cancel class" button, gated on `can_edit_classes` AND `starts_at > now()`. Opens `CancelClassDialog`.
- **`CancelClassDialog.tsx`** (new): branches on `session.recurrence_id`.
  - One-off → single confirm. Body: "Cancel \<class\> on \<date\>? N members are booked; K credits will be refunded."
  - Recurring → tri-state radio with counts:
    - **Just this one** (default)
    - **This and all future** (\<X\> more sessions; \<Y\> total bookings, \<Z\> credits)
    - **The whole series** (\<X\> future sessions; \<Y\> total bookings, \<Z\> credits)
  - Confirm calls the matching RPC.

## Tests

- pgTAP:
  - `cancel_past_session_blocked.sql` — RPC raises when `starts_at <= now()`
  - `cancel_session_refunds_credit_pack.sql` — credit_balance += 1 on the active credit-pack sub
  - `cancel_session_refunds_comp_grant.sql` — credits_remaining += 1 on the active comp
  - `cancel_session_no_refund_to_unlimited.sql` — nothing changes
  - `cancel_session_drops_waitlist.sql` — waitlist rows for the session are gone
  - `cancel_recurrence_from_sets_ends_on.sql` — `class_recurrences.ends_on` set to day before
  - `cancel_whole_series_keeps_past_sessions.sql` — past sessions in the series remain
  - `no_promotion_into_cancelled_class.sql` — booking-delete during cancel does NOT promote a waitlister into the now-deleted session

## Verification

- pgTAP suite goes green in CI.
- Local walk-through: owner cancels a one-off, the booked credit-pack member's `credit_balance` goes up by 1; owner cancels "this and future" on a Tuesday session, every Tuesday past today vanishes from the calendar; member who was on the waitlist for a cancelled class sees the waitlist entry gone (no ghost promotion).
- After merge: same Studio-paste check shape as Tier 6, looking for `cancel_session` / `cancel_recurrence_from` / `cancel_recurrence` in `information_schema.routines`.
