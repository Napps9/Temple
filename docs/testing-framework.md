# Manual testing framework — per feature area

A repeatable QA pass, broken out by feature area rather than one linear
journey (that's `docs/gym-outreach-checklist.md` Tier 5). Use this before
a launch, after a big change to that area, or whenever something feels
off and you want a structured way to isolate it.

Each area: what to click through, what "pass" looks like. Use two
browser profiles (or incognito) to test staff and member roles at once
where noted.

---

## Auth & onboarding

- [ ] Sign up with a fresh email → confirmation email arrives within
      ~30s → click through → lands signed in.
- [ ] Create a gym → setup checklist appears and every step
      completable (logo, settings, class type, schedule, health
      screening, plan).
- [ ] Join an existing gym via invite link → lands correctly, no
      duplicate account created if the email already exists.
- [ ] Consent gate: new member can't reach the app without ticking all
      three consent clauses; under-18 blocked unless the gym opted in.

## Bookings & classes

- [ ] Member books a class from the agenda/calendar → confirmation
      shown, credit/entitlement deducted correctly.
- [ ] Waitlist: fully-booked class → member joins waitlist → a
      cancellation promotes the next person automatically.
- [ ] Self-cancel: credits refund per plan type (unlimited = no
      refund, credit pack = refunded), respects the cancel-cutoff
      window.
- [ ] Staff on-behalf booking bypasses the booking window / cutoff
      correctly.
- [ ] Health/PAR-Q gate blocks booking until screening is complete;
      waiver gate blocks until signed (test with a gym that has both
      published).

## Billing & plans

- [ ] Owner connects Stripe (Manage → Billing & payments) → status
      flips to "Connected."
- [ ] Member subscribes to a plan → Stripe Checkout completes →
      membership shows **ACTIVE**, payment history shows **PAID**.
- [ ] Multi-membership picker appears correctly when a member holds
      more than one eligible entitlement.
- [ ] Cancel / change plan (self-serve or staff-approved, per gym
      settings) actually updates the Stripe subscription.
- [ ] Store: a one-off purchase and a recurring store subscription
      both complete checkout and show in order history.

## Health & safety / data protection

- [ ] PAR-Q: a flagged answer shows "allow with flag," staff can see
      the flag, and the access is logged
      (`health_data_access_log`).
- [ ] Waiver: draw-signature capture works, re-publishing a new
      version re-prompts existing members.
- [ ] Member withdraws consent from Account → health data actually
      erased (PAR-Q, injuries, consent record cleared).
- [ ] `leave_gym` (self-leave or admin-remove) erases health data the
      same way.
- [ ] Guardian flow (if `allow_minors` is on for a test gym): parent
      adds a child, completes screening on their behalf, books a
      class for them — each guardian read shows in the audit log.

## Staff & member management

- [ ] Invite a staff member by email → invite email arrives → they
      can accept and sign in with the right role/capabilities.
- [ ] Capability matrix: a role without `can_manage_staff` genuinely
      can't reach staff-management surfaces (test by signing in as
      that role, not just reading the gate in code).
- [ ] Archive / restore a member, class type, or plan — soft-delete
      round-trips cleanly; hard delete is blocked when dependent rows
      exist.
- [ ] Member detail page shows accurate booking/payment/health-flag
      history for that one member.

## Communications

- [ ] Send a campaign to a real test address → shows **delivered**,
      not simulated.
- [ ] Automation (e.g. lead-response) fires on the trigger condition
      and the email actually arrives.
- [ ] Unsubscribe link in a received email actually suppresses future
      sends to that address.
- [ ] Per-gym sending domain (if configured) is used correctly, not
      the shared fallback.

## Data import / migration

- See the migration dry-run steps above — member CSV import, workout
  history import, Stripe-subscriber adopt import. Re-run this
  section any time the importer or `infer-import` changes.

## Mobile / cross-platform

- [ ] Core flows (sign up, book, pay, log a workout) work on an
      actual phone, not just responsive-resized desktop — iOS and
      Android if you have both.
- [ ] Push notifications (if applicable) actually arrive on a real
      device.

---

## When to re-run a section

- Touched booking/credit logic → **Bookings & classes** section
- Touched Stripe/webhook code → **Billing & plans** section
- Touched consent/PAR-Q/waiver/erasure → **Health & safety** section
- Touched the importer or AI inference → **Data import** section
- Before any real gym onboarding call → the full Tier 5 journey in
  `docs/gym-outreach-checklist.md`, not just this doc
