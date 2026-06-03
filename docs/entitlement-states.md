# Entitlement states (`plan_subscriptions.status`)

The state machine that governs whether a member can book classes on a
given plan. State lives on `plan_subscriptions.status`, not on
`gym_memberships` — relationship persistence and plan state are
separate concerns (plan §0.3). `gym_memberships` deliberately has no
`status` column; whether a member is "active at this gym" is derived
from `plan_subscriptions` + `comp_grants` via `is_active_relationship`
(§0.6, future slice).

## Primary states (`plan_sub_state` enum)

### `pending`

Signed up; first charge not yet cleared. Critical for UK/EU SCA: 3DS
challenges sit minutes to days, so flipping straight to `active` on
sign-up either wrongly grants access or blocks the flow until the
challenge completes.

- **In**: sign-up RPC inserts at `pending`.
- **Out**: `active` on first `invoice.paid` webhook; `lapsed` on
  initial payment failure / 3DS abandon past the sign-up window
  (scheduled job).
- **Eligibility**: denied. UI copy: "Payment confirming".
- **Audit**: row created with `audit_events.kind = 'plan_sub_pending'`.

### `active`

Standard state.

- **In**: `pending → active` on `invoice.paid`;
  `paused → active` on resume;
  `cancelled_at_period_end → active` on reversal pre-period-end.
- **Out**: `paused`, `cancelled_at_period_end`, `lapsed`,
  `refunded_retained`.
- **Eligibility**: allowed, subject to class-type allowlist and
  credit balance.

### `paused`

Pre-paid time held; no charges; no credit refills during the pause.

- **In**: `active → paused` on member/staff pause action.
- **Out**: `active` on resume; `cancelled` on explicit cancel from
  pause.
- **Eligibility**: open — the plan flags two interpretations
  ("pre-paid time held" → eligible; "frozen, no access" → ineligible).
  Pin down when §0.5 predicate lands. UI copy: "Paused — resume any
  time".

### `cancelled_at_period_end`

Member cancelled; access continues through `paid_period_end`.

- **In**: `active → cancelled_at_period_end` on cancel action.
- **Out**: `cancelled` when `paid_period_end` passes (scheduled
  job); `active` on reversal.
- **Eligibility**: allowed for classes whose
  `starts_at <= paid_period_end`. UI copy:
  "Cancelled — access through {paid_period_end}".

### `lapsed`

Renewal failed past the dunning window.

- **In**: `active → lapsed` on Stripe
  `customer.subscription.updated` with `status='unpaid'` after
  dunning; `pending → lapsed` on initial-payment abandon.
- **Out**: re-subscription creates a new `plan_subscriptions` row
  (preferred). Reactivation of the `lapsed` row only on Stripe's
  automatic recovery path.
- **Eligibility**: denied. UI copy: "Membership lapsed — update
  payment".

### `cancelled`

Terminal.

- **In**: `cancelled_at_period_end → cancelled` at `paid_period_end`;
  `paused → cancelled` on explicit cancel.
- **Out**: none. Re-subscription = new row.
- **Eligibility**: denied. UI copy: "Cancelled — re-subscribe to
  book".

### `refunded_retained`

Owner issued a refund with retained access (Invariant: refund
retention).

- **In**: `active → refunded_retained` via Owner refund action with
  "retain access" toggle (Phase 3).
- **Out**: `cancelled` at `paid_period_end`.
- **Eligibility**: allowed within retention window. UI copy:
  "Refunded ${amount} — access retained through {paid_period_end}".

## Side-state: `awaiting_payment_authentication` (boolean)

Independent of `status`. Set when Stripe fires
`invoice.payment_action_required` on an off-session renewal (SCA
challenge mid-membership).

- **Set**: webhook handler on `invoice.payment_action_required`.
- **Clear**: `invoice.paid` (success); lapse path (status →
  `lapsed`, side-state → false).
- **Eligibility**: unchanged. The UI badges the member; out-of-band
  notifications (email + push) fire.

## What does NOT live here

- "Active member at this gym" — `is_active_relationship` (§0.6)
  composes this state machine with live `comp_grants`.
- "Has ever paid" — `has_ever_paid` (§0.6) reads `billing_events`.
- Per-class eligibility — `is_booking_eligible` (§0.5) composes
  status + plan class-type allowlist + credit balance.
