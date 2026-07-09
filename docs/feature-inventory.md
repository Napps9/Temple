# Temple — feature inventory

A snapshot of every feature live in the platform as of this writing.
Organised by **who** uses it. Capabilities in brackets show the
permission gate that controls visibility for staff features.

---

## Member-facing features

### Athlete mode (gymless users)

A signed-in user with no active gym membership — a brand-new sign-up,
or an **ex-member** — lands in the `athlete/` area (the root index
routes gymless users to `/athlete`, replacing the old `/welcome`
dead-end). It carries:
- **Portable training history** — every movement they've logged,
  unioned across all gyms they've trained at (`leave_gym` never
  deletes `tracked_*` data, and the tracking RLS self-select branch is
  membership-independent, so the history survives leaving and is read
  back by `profile_id`). Read-only per-movement detail reuses the
  shared `MovementDetailView` (`mode="athlete"`): best-of, PR badges,
  trend sparklines, journal — minus the leaderboard + Record affordances.
- **Join / start-a-gym CTAs** — the athlete home and account screen
  both offer "Join a gym" (invite) and "Start a gym", so the gymless
  landing subsumes what `/welcome` used to do.
- **Solo (gymless) workout logging** — behind a paid athlete tier that
  is **free during beta**. `athlete_subscriptions` is the entitlement;
  `is_athlete_active()` gates it. The athlete taps "Start solo
  tracking" (free in beta) to self-activate, then logs lifts/PRs via
  the recorder in `solo` mode — rows are written with `gym_id = NULL`,
  allowed by the extended tracking insert RLS
  (`gym_id IS NULL AND is_athlete_active(auth.uid())`). Solo rows are
  visible only to the athlete (no gym's coaches see them). The account
  screen shows the subscription state and a cancel. When the payments
  phase lands, `start_athlete_subscription` is the single seam that
  takes a charge before activating (`source` / `current_period_end`
  carry billing state); the gate itself doesn't change.

### Bookings & classes
- **Calendar (Day / Week / Month views)** — browse the gym's class
  schedule with class-type colour coding, coach avatars, capacity and
  remaining spots. On a phone, the member Book tab drops straight into
  an agenda list (a card per class, filter pills scoped to that day's
  class types) instead of the grid; on tablet/desktop, Book's Day view
  is a compact stacked list rather than an hourly grid with empty
  hours, with class-type filter chips above it. Staff's Manage
  calendar always keeps the full hourly grid, since the gaps are where
  a class gets scheduled.
- **Quick-book recommendation** — ranks upcoming sessions by a blended,
  explainable taste score (`src/lib/recommend.ts`, unit-tested): recency-
  weighted class-type affinity (3-week half-life, all attended types
  considered, not just the top one), time-of-day match to the member's
  usual training hour for that type, day-of-week match to the weekdays
  they usually train it, and a mild soonness nudge. The top-scoring
  eligible session is surfaced (respecting plan class-type allowlists,
  credit balance, paid period and active comp grants). Marked with a
  sparkles glyph on the recommended card, the highlighted agenda row, and
  the class detail modal.
- **Next class card + My bookings** — combined tile showing the
  member's upcoming class plus a route into the full bookings list.
- **Waitlist** — automatic queue + promotion when a slot opens, honest
  rank shown to the member (computed over the full queue regardless
  of RLS).
- **Self-cancel bookings** — credits refunded according to the plan
  type (unlimited gets none; credit packs / comp grants do). The
  refund fires via a BEFORE DELETE trigger on `class_bookings` for the
  member self-cancel path; admin session-cancel refunds every booking
  in full (no cancel-cutoff penalty when the gym cancels) and the
  cascade stays intact (0065 uses a transaction-local skip flag, not
  the replica-mode hack that had been orphaning bookings). Credit
  balances are guarded by non-negative CHECK constraints, so a
  double-book race aborts rather than going negative.
- **Booking eligibility** — a member self-booking with no eligible
  entitlement is refused only when they already hold a plan with this
  gym (out of credits / lapsed); gyms that grant access by membership
  alone (no plans) book on membership. Booking windows and the
  entitlement requirement are bypassed for staff on-behalf bookings
  and for waitlist promotion (a late drop-out still promotes the next
  member even inside the booking cutoff).
- **Multi-membership picker** — a member holding more than one
  eligible plan / comp grant for a class sees a labelled radio picker
  on the confirm step (rendered by `list_booking_entitlements`) with
  the gym's default pre-selected. The default is chosen by the gym's
  `subscription_resolution` setting (`credits_first` | `newest_first`
  | `highest_priority`) and the chosen entitlement is recorded on the
  booking row so the refund path can target it precisely. Members
  holding a single entitlement see the unchanged single-button
  confirm.
- **Health/PAR-Q gate** — annual (365-day) screening flow, with
  allow-with-flag if the member ticks a flagged answer. Enforced both
  as a member entry redirect and as a **booking prerequisite** inside
  `_book_class_for`: coaches and owners (who bypass the entry gate)
  can't book a class for themselves until they've completed PAR-Q.
  Bootstrap-safe: a gym with no published questionnaire is unguarded
  so an owner can publish one in the first place.
- **Waiver gate** — a gym can upload a liability waiver as a PDF
  (`waiver_documents`, versioned like PAR-Q) and members sign it with a
  **drawn signature** (captured as SVG vector paths in
  `waiver_signatures`, no image upload). Same booking-prerequisite +
  entry-redirect enforcement as PAR-Q, bootstrap-safe the same way. A
  gym needs only **one** of {waiver, PAR-Q} to go live; if it publishes
  **both**, a member must clear both. Signatures are retained as
  liability records — deliberately *not* swept by the health-data
  erasure/purge (lawful basis: defence of legal claims). Publishing a
  new waiver version re-prompts everyone to re-sign.
- **Family / dependents** — where the gym allows minors, a member can
  add loginless child accounts from a Family screen (`create_dependent`
  → a `managed` profile linked by `guardianships`). The guardian
  completes the child's waiver / PAR-Q on their behalf (`?subject=`
  param), books and cancels the child into classes
  (`parent_book_dependent` / `parent_cancel_dependent_booking`), and
  removes the child (`remove_dependent`, soft-removal mirroring
  `leave_gym`). Staff rosters show a "Child" badge + a Children filter;
  the member detail page notes a managed account. Guardian reads of a
  child's health state are audit-logged.

### Plans, payments & onboarding
- **Plan subscription self-view** — see active plans, credit balance,
  paid period end, plan notice period.
- **Comp grants** — visible if granted by staff, with credits + window.
- **Member onboarding flow** — non-health questions answered at first
  join, surfaced on the member profile to staff.
- **Account self-management** — change name + email (with re-confirm),
  password reset, avatar upload, leave-gym (cancels subs + comps).
- **Gym share / invite link** — share button + Web Share API for the
  member-facing join URL.

### Store

[`can_manage_store`, `can_see_store_revenue`] A gym-branded storefront
(logo + brand colours) where members buy **one-off** goods — **physical**
items (water bottles, tees — shipped, so Stripe Checkout collects the
address and a flat per-order shipping fee is added) and **digital** goods
(programmes, event tickets — delivered as a private Storage file the buyer
downloads in-app and via a 7-day signed link in the receipt email) — and
**recurring** monthly products: a programming subscription, a locker
rental, or a **physical subscription box** shipped every cycle.

- **Member side** (`/store`, linked from Account when the store is on) —
  branded product grid with photo, price, stock ("3 left") and a **Sold
  out** state once a tracked item hits zero. Buy opens Stripe Checkout on
  the gym's connected account (direct charge, no platform fee — the same
  rails as memberships). `/purchases` lists past orders with their lines,
  totals, shipping status and re-downloadable digital goods.
- **Subscriptions** — a product can be marked **recurring (monthly)**:
  digital (a file re-delivered each cycle), a no-deliverable service (a
  locker rental), or a **physical box** shipped every cycle. Members
  **Subscribe** via a Stripe subscription on the gym's connected account (a
  box collects a delivery address at checkout) and manage/cancel it (at
  period end) under `/purchases`, where they can also edit a box's delivery
  address. Each paid cycle is recorded as an ordinary paid order — a digital
  good re-delivers its file; a box drops into the staff fulfilment queue to
  ship — so cycles flow through receipts, purchases, fulfilment and revenue.
  Staff see active subscribers, and can cancel, on a **Subscriptions** tab.
- **Staff side** (Manage → Store) [`can_manage_store`] — add / price /
  hide / remove products, mark one recurring, upload a photo and (for
  digital) the download file, set stock; an orders queue with the buyer,
  items, shipping address and a **Mark shipped / done** action; a **Sales
  this month** tile [`can_see_store_revenue`].
- **Owner settings** — switch the store on and set the shipping fee
  (`gyms.store_enabled` / `store_shipping_fee_cents`, RPC
  `set_store_settings`). Owners pick who manages the store and who sees
  revenue from the Team → role-permissions editor.
- **Under the hood (0085–0087)** — `store_products` / `store_orders` /
  `store_order_items` / `store_digital_deliveries` / `store_subscriptions`,
  all `gym_id`-RLS; the member catalogue reads through `list_store_products`
  (which hides the asset path so the deliverable can't leak).
  `store-checkout` builds the session (one-off payment, or subscription mode
  on a cached recurring Price, collecting an address for a box), validating
  price + stock server-side; `stripe-webhook` settles one-off orders via
  `_mark_store_order_paid` and each subscription invoice via
  `_record_store_subscription_cycle` (both idempotent on Stripe retries) —
  a box cycle mints a physical order carrying the subscription's delivery
  address — emailing the receipt via Resend. `store-cancel-subscription`
  flips cancel-at-period-end; `update_store_subscription_shipping` edits a
  box's address. Inventory decrements at payment; selling out is automatic.

### Tracking & training

- **Per-gym discipline (CrossFit vs Hyrox)** — a gym runs Track in its
  training flavour, set by the owner in Manage → Settings → Gym settings
  (`gyms.discipline`, default `crossfit`; owner-gated `set_gym_discipline`
  RPC). A **Hyrox** gym's Track home replaces the CrossFit movement-group
  grid with the eight race stations (SkiErg, Sled Push, Sled Pull, Burpee
  Broad Jumps, Row, Farmers Carry, Sandbag Lunges, Wall Balls), the 1 km
  run split, a full/half **Race Simulation** tile, and a **Hyrox Time**
  tile for your official competition finish time (full/half, logged
  separately from the training simulation) — each station
  logging a single best **time** (lower is better). The station catalog
  lives in `src/lib/hyrox.ts`; keys are namespaced `hyrox_*` and share the
  same `tracked_*` tables, so the existing per-movement detail (best-of,
  PR badges, trend sparklines, journal), the recorder, and the
  strength-style leaderboards all work unchanged via the discipline-aware
  finders in `src/lib/movements.ts` (`catalogGroups`, `allSchemeOptions`)
  and the `useGymDiscipline` hook. Journal, streaks/heatmap and the injury
  tracker are shared across both disciplines. Phase 1 = station + run PBs
  and a single race finish time. Phase 2 adds a **split-by-split race
  simulation builder** (`RecordHyroxRaceModal`, "Log full splits" on the
  Race Simulation detail page): 8 laps of run → roxzone → station timed
  individually, by race type (singles/doubles/relay), division
  (open/pro), gender category and optional age group, stored in
  `tracked_hyrox_races` + `tracked_hyrox_splits` (RLS matching the
  `tracked_workout_sections`/`tracked_section_entries` pattern). The
  aggregate total is written alongside as an ordinary `hyrox_sim` PB
  result, so the existing leaderboard/PR-badge/sparkline surfaces keep
  reading one number per race without change — the split tables are a
  detail view underneath it, not a replacement.

- **PR badges** — on the movement detail page, every journal row
  shows a trophy PR chip when the result was a strict improvement
  (per track-key, per scheme direction) over every earlier entry at
  the time it was recorded. Higher-better schemes use the numeric
  value; time-based ones use seconds with "lower better". Logic
  lives in `prRowIds` (`src/lib/movement-journal.ts`), unit-tested.

- **Trend sparklines** — each rep-max row on the movement detail page
  shows a tiny View-based sparkline (no chart libs) of that scheme's
  progression once there are 2+ logged points. Lower-is-better
  schemes (time) are inverted so an improving series still trends
  upward. Pure helpers `trendPoints` + `normaliseForPlot`
  (`src/lib/movement-trend.ts`), unit-tested; the line is
  `src/components/Sparkline.tsx`.

- **Consistency stats + 12-week heatmap** — on the /track home, a card
  leads with a three-up stat row — days in a row, weeks in a row, and
  sessions this month — above a 12-week heatmap grid, all drawn from the
  same Set of locally-keyed logged days. Cells the member trained on glow
  with the gym's primary colour; everything else stays a soft neutral.
  `workoutStreak` / `weekStreak` (honours week_starts_on) /
  `sessionsThisMonth` in `src/lib/workout-streak.ts`, grid in
  `src/components/WorkoutHeatmap.tsx`, all unit-tested.

- **Workout journal** — every recorded session with date, title,
  programmed sections + recorded results, route into a detail view.
- **Record workout modal** — pre-fill from today's programming for
  the class types the member is permitted to see, then a
  format-driven entry form per section (For time / AMRAP / EMOM /
  Intervals / Max distance / Max calories / Strength sets / Max load /
  No score / Other).
- **Cardio scoring** — Max distance and Max calories formats for
  erg/bike/run conditioning ("20 min max distance row", "12 min max
  cals assault bike"): distance-in-metres or calories headline plus an
  optional total time, with derived average pace shown in the journal
  and workout detail (/500m erg convention, /km when the section text
  reads as running — `formatPace` / `paceIntervalForText` in
  `src/lib/track.ts`). Optional per-split entries; the class
  leaderboard falls back to summed splits when no headline aggregate
  was logged (migration `0101`, pgTAP
  `class_leaderboard_cardio_scoring.sql`).
- **Movement tagging** — at log time, tag a section with the
  movements it contained + a rep-max scheme so it counts on the
  movement / leaderboard.
- **Per-movement detail page** — rep-max best-of, full history merging
  direct PRs with section-tagged results, "session" badge.
- **Per-group page** — best-of per movement in a group (Squats,
  Pushing, Pulling, Cleans, Snatch, Aerobic, Bodyweight).
- **Movement Library + starred home** (`/track/movements`, "Movement
  Library" tile on the Track home) — search and browse the **full
  cross-discipline** catalog (CrossFit + Hyrox) regardless of the gym's
  own discipline. Name+alias search via `searchMovements`; browse groups
  the gym's discipline first (`allGroupsDisciplineFirst`). Members
  **star at two levels** — an individual movement
  (`tracked_movement_favourites`) or a whole **group**
  (`tracked_group_favourites`); both tables are self-only RLS with no
  gym_id, so favourites travel with the profile. The **Track home grid is
  rendered from these stars** (`useMovementFavourites` →
  `deriveTiles`): a starred group is a group tile while ≥2 of its
  movements remain selected, collapses to a single movement tile at one,
  and disappears at zero; individually-starred movements always render as
  their own tiles (Hyrox keeps its per-station colour + work spec via
  `HYROX_TILE_META`). **Defaults mirror the old home** and aren't
  persisted until the first edit (CrossFit → its groups starred; Hyrox →
  its movements starred individually), materialised on first change so
  they're editable. The Record flow's movement **tag picker** uses the
  same widened catalog + search, so a workout section can be tagged with
  any movement, not just the gym's discipline.
- **Leaderboards** — class-session leaderboards (for-time, AMRAP,
  max distance, max calories, load-based formats) and
  strength-movement leaderboards (rep-max per scheme), honouring
  the gym's appear-in-leaderboards opt-in.
- **Movement-activity badges** — Track-home group tiles show "N new"
  when the member has fresh logs in that group; clears on visit.
- **Injury tracker** — gender-neutral body silhouette with tappable
  regions, pain 0-10, affected movements, start date, weekly
  check-ins, status (active / improving / resolved). Auto-raises
  staff alerts.
- **Injury check-in nudge** — inbox card + Track-tile badge when an
  injury is overdue for its weekly check-in.

### Communication
- **Direct messages** — 1:1 chats inside the gym; messaging-policy
  gated (open / coach-only / staff-only).
- **Class-session broadcasts** — coaches push a message to everyone
  booked into a class; lands in the member's inbox under Classes.
- **Gym announcements** — gym-wide posts in the inbox.
- **"What needs you" nav badge** — the top-bar inbox bell shows a count
  rolling up unread messages (`inbox_unread_summary`), injury check-ins
  due, and classes attended-but-not-logged. `useNotificationCount`
  (`src/lib/notifications.ts`). All in-app — no push/email.
- **Post-workout log nudge** — after a class you were marked in for
  (`class_bookings.attended_at`) with nothing logged that day, the Track
  home and the Inbox show a "log your results" prompt; on Track it opens
  the recorder pre-filled for that session (`useLogNudge`). Day-grained,
  so any log that day clears it.

### Programming
- **Programming view** — read-only calendar of what's been programmed
  for the member's eligible class types each day; the same surface
  the recorder pre-fills from.

---

## Coach + admin-facing features (staff area)

The staff area shows up when `can_access_staff_area` is on.

### Programming
- **Programming calendar (manage mode)** — author day-by-day sections
  per class type. Each section is category + format + title + body.
  Categories: Strength & Skill / WOD / Primer / Mobility / Accessories
  / Warm-up / Miscellaneous.  Formats: for_time / amrap / emom /
  intervals / strength_sets / max_load / no_score / other.
- **Per-section leaderboard toggle** — flips on a class-session
  leaderboard for the For Time / AMRAP section of the day.
- **Inline auto-titling** — title auto-fills from the category and
  re-fills on category change *only* when it still matches.
- **Programming Analysis page** — 12-week injury heat map across the
  gym body + per-movement member trends (from both direct PR logs and
  section-tagged workout results) + the Programming Balance block:
  - Pattern × Energy matrix (the headline 2-D grid)
  - Energy system bars (phosphagen / glycolytic / oxidative)
  - Movement pattern volume bars
  - Region heat (BodyMap silhouette tinted by programmed volume)
  - Untagged sections (programming that didn't classify, so the coach
    can fix the wording).
  - Every Programming Balance card (and the block header) has an (i)
    toggle that reveals a "What this shows / Why it matters" panel —
    plain-language explanation of the energy-system / pattern jargon
    and how to act on each view.
- **Class-type filter chip** for the analysis matrices, including
  archived class types so historical analysis still works.

### Classes & operations
- **Class types editor** [`can_edit_classes`] — name, colour (the
  swatch picker dots any hue already used by a sibling class type so
  two don't clash), recurring schedule (days, times, duration,
  capacity, end-on or indefinite), per-type booking-window overrides
  (with the same min/hr/day/wk unit toggle as the gym defaults),
  archive / restore / hard-delete.  **Archiving cascades**: blocks new
  bookings, new programming, future materialisation. A class type can
  hold **multiple schedules** — e.g. one row for weekdays at 06:00 and
  a separate row for Saturday at 10:00 — each its own days/times/
  duration/capacity; the editor groups every `class_recurrences` row
  under its type and adds/removes them independently (materialisation
  already expands each row, so no schema change was needed).
- **Recurrence materialisation** — schedules turn into individual
  sessions on the calendar, extended to a horizon.
- **Cover requests** [`can_request_cover` / `can_claim_cover`] — a
  coach can hand a class to another coach; first-claim wins; refunds
  and waitlist promotion handled correctly on cancellation. **Claims
  are gated on class-type qualification** — a coach explicitly
  disqualified for that class type can't claim it (enforced in the
  `claim_cover` RPC and surfaced as a disabled state in the UI).
- **Class detail modal** — roster, attendance marking (check-in / no-
  show / unmark), cover request, leaderboard for that session.
  **Message class** [`can_broadcast_to_class`] — inline composer
  attached to the Members section sends a broadcast to every booked
  member without leaving the modal (same RLS-gated insert as the
  full broadcast screen; the chip only renders when there are
  bookings/waitlist entries to receive it). **Add member**
  [`can_assign_plan`] — staff search the gym roster, pick which
  entitlement (plan or comp) to charge it against, and book; the
  staff member is recorded as `booked_by_profile_id`. A **No charge**
  option books the member without resolving or debiting any
  entitlement, even if they hold an eligible plan (`p_no_charge` on
  `staff_book_member`) — for walk-ins, guests, and comps outside the
  plan/credit system.
  **Switch plan** [`can_assign_plan`] — per-booking swap action lets
  a coach change which entitlement an existing booking is charged
  against (the cancel-refund path follows the pointer, so a swap
  redirects the refund target too), or pick **No charge** to comp an
  existing booking: `p_no_charge` on `swap_booking_subscription`
  refunds the credit burned at book time (via `_refund_booking_credit`)
  and nulls the pointer, so a session already booked on Unlimited or a
  credit pack becomes a genuinely free seat. Both flows verify the pick
  is eligible via `list_booking_entitlements` against the target member.
- **Cancel session** — refunds credits, drops waitlist, deletes the
  session.

### Manage tabs

- **Gym setup checklist** (owner-only, auto-hides when complete) —
  shown above the tab strip on a new gym. Steps derived live from the
  data: add a logo, set your gym settings (operating defaults — done
  once the owner saves them, stamped by `operating_defaults_reviewed_at`),
  add a class type, schedule a class, set up health screening (a waiver
  **or** a PAR-Q satisfies it), create a membership plan, plus optional
  steps for invite-your-team, **bring your members across** (any
  `pending_members` row), and **import workout history** (any
  `tracked_workouts` row). Each step is a deep link to the page that
  completes it. The card disappears once every required step is done.
  Backed by `get_gym_setup_progress(gym_id)` so it never drifts from
  reality — delete a class type and the step flips back open. A new
  owner with required steps still pending is also redirected to a
  dedicated full-screen `/onboarding` version of the same checklist on
  sign-in; **Skip for now** permanently dismisses it
  (`gyms.onboarding_dismissed_at`, set via `dismiss_gym_onboarding`) so
  it doesn't reappear next sign-in — the inline Manage card stays
  available regardless, for whenever they want to finish.

The Manage page presents a tab strip:

- **Insights** [`can_see_insights`] — one date range driving every
  KPI: Revenue, Members, Attendance %, Intros new, Expiring soon,
  Expired, Paying, Conversion vs target, Retention vs target. Each
  tile delta vs previous period. **Targets** [`can_set_targets`] editor
  sets one goal at a time per metric (New intros, Conversions,
  Retention) via a value box + a Week/Month/Quarter/Year period
  selector — Conversions and Retention can be a rate (%) instead of a
  headcount; New intros is count-only.
- **Members** [`can_manage_tags`] — Attendance summary (Attended /
  No-show / Unmarked) by class type, **shareable signup link** card
  (Copy / Share, with archived state when public signup is off),
  searchable + filterable member list with PAR-Q badge, Injury badge,
  cohort badges (Intro / Active / Paying / Expiring / Expired), plan
  chips, tag chips; **Export members CSV**; **Tag rules** editor. The
  Members screen (`/management/members`) also hosts **member invites**
  [`can_invite`] — email a member, generate a code + QR, or use the
  front-desk walk-in QR (same card UI as staff invites on Team).
- **Team** [`can_manage_staff`] — staff roster with inline open-task
  + open-cover-request counts; per-coach earnings + class-type
  qualifications; SOPs card; Invite codes card (one-time codes to
  add owner / admin / coach / staff — member invites live on the
  Members screen). Every issued invite code has a scannable QR
  pointing at `/accept-invite?code=…` so staff invites can be sent as
  a single image. Invites can also be
  **emailed directly**: enter an address and the `send-invite` edge
  function mints the code via `create_invite` (caller's role gate
  applies) and sends the accept link through Resend — from the gym's
  verified sending domain if connected, else the Temple default.
- **Billing & payments** [owner] — Manage → Plans → Billing &
  payments (`/management/billing`). Connect the gym's own Stripe (Connect
  **Standard**, via OAuth) so it can charge members directly; Temple
  takes no application fee. Phase 1 (built) stores the connected account
  on `gym_stripe_accounts` via the `stripe-connect-start` /
  `stripe-connect-callback` edge functions. Member checkout and the
  subscription-recording webhook are built (`stripe-checkout` /
  `stripe-webhook`). Needs `STRIPE_SECRET_KEY`
  + `STRIPE_CONNECT_CLIENT_ID` secrets — see `docs/stripe-setup.md`.
  **Currency follows the connected account**: `stripe-connect-callback`
  reads the Stripe account's `default_currency` and stores it on
  `gyms.currency`, so every price / revenue / payout figure renders in
  the gym's real billing currency (a GBP account shows £). Until Stripe
  is connected the gym keeps its currency (default `GBP`), settable by
  hand in Gym settings (owner-gated `set_gym_currency` RPC). The Insights
  revenue tile reads this currency for its empty state rather than
  assuming USD.
- **Membership (self-serve)** [member] — members pick and pay for a plan
  themselves at `/membership` (linked from Account): the gym's live
  plans, their current subscription + credit balance, and a Subscribe
  button that opens Stripe Checkout via `stripe-checkout`. Gated by the
  gym's `members_can_self_checkout` toggle.
- **Membership change / cancel workflow** [member + `can_assign_plan`] —
  on `/membership`, switching to another recurring plan now changes the
  Stripe subscription **in place** (price swap, `proration_behavior=none`,
  same renewal date) instead of starting a second one; the member can
  also cancel at period end. Each gym sets, per direction, whether the
  change is self-serve or needs approval (`gyms.membership_upgrade_policy`
  / `_downgrade_policy` / `_cancel_policy`; defaults: upgrade self-serve,
  downgrade + cancel request). Owner edits them in the Manage → Plans tab
  (RPC `set_membership_change_policies`). Where approval is needed the
  member files a `membership_change_requests` row (RLS self
  insert/withdraw); staff work the queue at
  `/management/membership-requests`
  (RPC `staff_membership_change_requests`) and approve/reject. The Stripe
  change + row update run together in the `stripe-modify-subscription`
  edge function under the service role. Credit packs and one-off class
  buys are untouched.
- **Require a membership to book** [owner] — Billing toggle
  (`gyms.require_membership_to_book`, RPC `set_require_membership_to_book`).
  When on, members need an active membership/credits to book; staff are
  exempt unless `gym_memberships.require_membership_to_book` is set true
  per person (RPC `set_member_booking_requirement`). The calendar stays
  open to everyone — `_book_class_for` (0082) raises a "Membership
  required" error at the point of booking, and `ClassDetailModal` shows
  the gym's plans inline (Subscribe → Stripe) rather than routing away.
  Off by default; the original out-of-credits / lapsed-plan refusal is
  unchanged.
- **Plans** [`can_manage_plans`] — Unlimited / Credit period /
  Credit pack plans with monthly price + notice period (days);
  per-plan **class-type coverage** (All classes, or a Specific
  allowlist of class types — writes `plan_class_types`, which the
  booking entitlement filter reads so a restricted plan only books its
  classes); Archive / Restore / Hard delete with dependent-row
  protection.
- **Communications** [`can_manage_comms`] — the email campaign suite
  (detailed below under *Communications Suite*). The campaign screen
  (`/management/communications/<id>`) splits into a **Setup** view (name,
  subject, topic, audience, send) and a full-screen **Design** builder —
  a 3-pane `EmailEditor` (block rail · canvas · inspector, `variant="builder"`)
  reached from the "Design your email" card. Same component owns the email
  document, so autosave is unchanged.
- **Store** [`can_manage_store`] — the gym storefront: products, stock,
  orders and fulfilment (detailed above under *Store*).
- **Settings** — collapsible cards:
  - **Gym settings** [`can_manage_staff`] — training discipline
    (CrossFit / Hyrox), billing currency, week start, default
    class capacity / duration / materialisation horizon, plan-resolution
    order, "expiring soon" window, booking windows (open / close / free-
    cancel cutoff, each with a min/hr/day/wk unit toggle so "2 weeks" or
    "48 hours" is entered directly), PAR-Q expiry, health-data retention,
    lead conversion window. Same editor as the standalone
    `/management/operating` page. (Internally still "operating defaults":
    the `set_gym_operating_defaults` RPC + `gyms` columns.)
  - **Branding** — gym name, slug, logo upload, primary / secondary /
    text colours with inline HSV picker, public-signup toggle. An
    **Advanced branding** collapsible adds a dark-mode logo and a
    second colour palette — any field left blank is auto-derived from
    the light values via WCAG-contrast against the dark screen bg
    (`deriveDarkColour`), and a one-tap "Auto-generate from light"
    button fills the lot. The runtime `useGymBrand` resolves the right
    set based on the active colour scheme, so every chrome consumer
    (TopNav, Button, QR cards…) flips automatically when the user
    toggles light/dark.
  - **Health screening** [`can_manage_parq`] — upload a waiver PDF for
    members to sign (primary), and/or build a question-by-question
    PAR-Q (optional extra); publish new versions of either. One is
    enough to satisfy the setup checklist.
  - **Leaderboards** [`can_configure_leaderboards`] — toggle class
    leaderboards and strength leaderboards.
  - **Messaging** — choose who can DM whom (open / coach-only /
    staff-only).
  - **Class types** — same editor reachable from above.

### Leads

[`can_assign_plan`] Reachable from Manage → Members → Leads
(`/management/leads`). Track prospects from first contact through
conversion. Each lead row stores name, email, phone, source (from a
per-gym `lead_sources` vocabulary), a notes field, and a fixed status
pipeline: `cold → contacted → intro_booked → trial_attended →
converted | lost`. `record_lead` and `set_lead_status` RPCs gate
writes; tenant RLS uses `user_can_assign_plan`. Moving to
`converted` requires a member profile to link to (the rule is
enforced in the RPC), so the conversion dashboard can attribute
revenue to its source. The list page filters by status pill (Active
/ All / per-status) and supports inline status changes via the
detail modal. The detail modal exposes a manual "Converted" flow
with an inline member search for cases where auto-attribute on
signup didn't fire. The Insights page surfaces a "Conversions by
source" chip row alongside the lead_conversions tile so owners can
see which acquisition channels are paying off.

### Public lead capture

A gym can share an enquiry URL (`/lead/<slug>`) that lets a prospect
leave their name, email, phone and a message without an account.
Opt-in per gym via `gyms.public_lead_capture_enabled` (default off),
toggled from the Branding screen alongside the public-signup link.
The anonymous write goes through `capture_public_lead` (SECURITY
DEFINER, granted to `anon`), which validates the gym is accepting
enquiries, checks a loose email shape, and dedups on
`(gym, lower(email))` within a 30-day window so repeat submissions
refresh the existing open lead instead of piling up duplicates.
Captured rows land in Manage → Leads as `cold` with no
`captured_by`. IP-level throttling is a noted follow-up (would need
an edge function in front).

### Member import

[`can_manage_staff`] Reachable from Manage → Members → "Bring data
across" → Import members (`/management/members/import`), and surfaced
as an optional checklist step on the setup card. Drop a CSV from a
previous platform (Mindbody, PushPress, Glofox, Wodify or a
spreadsheet); the column mapper pre-fills via an AI pass — `infer-import`
in `map_columns` mode reads each column's header plus a privacy-safe
profile (value kind, fill rate, distinct ratio; never raw cell values)
and maps it to a Temple field, falling back to the alias heuristic
(`autoDetect`) when the AI key is unset or the call fails. The preview
counts staged vs. skipped rows, and commit writes them into
`pending_members`. A trigger on `gym_memberships`
insert links the pending row when the matching email signs up via
`/join/<slug>` — applying the imported plan metadata onto the
membership, copying tags into `member_tags`, and propagating "no
marketing" into the Comms Suite `email_unsubscribes` list. The
handover screen shows the gym's join URL + QR, a one-click per-member
CSV (email, name, join URL) the owner can blast from their existing
newsletter tool, and an opt-in "Send the welcome email from Temple"
button that creates a campaign with
`audience.kind = 'pending_members'` and lands the owner in the editor
to preview before send. A live linking-progress counter ticks up
while members sign up. Plan-name → membership_plan mapping happens in
the Review step below — a CSV plan name that case-insensitively
matches a plan the gym already has is pre-selected to "Map to
existing" (flagged "Matched by name") rather than defaulting to
create a duplicate.

### Member-import Review step (AI-assisted plan + tag inference)

[`can_manage_staff`] Sits between the column-mapper and the preview
inside `/management/members/import`. On entry, the wizard summarises
the mapped rows (distinct plan names + counts + bucketed credits /
plan_end stats + distinct tag values — **no emails, names, DOBs**) and
calls the `infer-import` edge function, which:

1. Look-asides `import_inference_corrections` for each plan name. An
   exact match (case-insensitive) is served with confidence
   `learned` and no AI call. Misses gather the most-relevant past
   corrections (recency + `was_overridden` priority over the
   `pg_trgm` GIN index) as few-shot examples.
2. Calls Claude Haiku 4.5 via the Anthropic Messages API with the
   summary + examples. Tool-use response shape pinned to a JSON
   schema so we don't parse free-form text. Returns: per plan
   `suggested_name / suggested_kind / suggested_credit_count /
   suggested_monthly_price_cents / confidence / reasoning`, plus a
   tag triage (`keep` / `drop` / `merge_suggestions`) and an optional
   `default_plan_hint`.
3. Falls back to deterministic rules (credits present + plan_end →
   `credit_period`; credits no plan_end → `credit_pack`; otherwise
   `unlimited`) when `ANTHROPIC_API_KEY` is unset or the API errors,
   so the wizard never blocks on AI availability.

The owner reviews and edits any field in the rendered cards; tag
chips toggle keep/drop in a single tap. On commit the wizard inserts
the chosen `membership_plans`, calls the (extended)
`import_pending_members` RPC with `linked_membership_plan_id`
stamped per row, and posts every plan / tag decision (`input`,
`ai_suggestion`, `final_value`, `was_overridden`) to
`record_import_corrections` — the cross-gym learning store grows
every time an owner reviews, so the next gym's import gets a sharper
prefill.

The `apply_pending_member_data` trigger (extended in 0076) auto-
creates a `plan_subscription` on signup when
`pending_members.linked_membership_plan_id` is set: `status='active'`,
`credit_balance` = `imported_credits_remaining` (for credit-based
plans), `paid_period_end` = `imported_plan_end`,
`stripe_subscription_id` `NULL` — Temple billing is bypassed for the
imported continuation. When `paid_period_end` lapses, the existing
booking gate naturally refuses the next booking; no new lapse code.

### Workout-history import

[`can_manage_staff`] Reachable from Manage → Members → "Bring data
across" → Import workout history
(`/management/members/import-workouts`), and surfaced as the final
optional checklist step. Same CSV/map/preview/commit wizard as the
members importer; each row is one logged set (email, date,
movement, weight, reps, unit, notes). The movement name is matched
client-side against the vocab in `src/lib/movements.ts` so misses
appear in the preview as an amber "Unknown movements" callout the
owner can correct before re-importing. The commit RPC
`import_member_workouts` matches emails against active
`gym_memberships` (skipping unknowns with a count), groups rows
sharing (email, date) into one `tracked_workouts` parent, and
writes one `tracked_movement_results` child per row with
`track_key = '<reps>rm'`. Re-running the importer for the same
(member, date) reuses the existing parent so results aren't
double-counted. Lands in `/track` so PR pages and sparklines light
up for the member as soon as they sign in. Endurance / time-based
schemes (run times, row distances) are deliberately deferred.

### Stripe member import (adopt live subscriptions)

[owner] Reachable from Manage → Plans → "Import members from Stripe"
(`/management/members/import-stripe`), shown once the gym has connected
Stripe. **Plan creation itself is now gated on a connected Stripe
account** — the Plans screen prompts you to connect first (members are
charged on the gym's own connected account), keeping existing plans
editable.

The importer brings a gym's **existing Stripe subscribers** across and
**adopts their live subscription** — same billing, no re-charge, and the
member (and owner) manage it in-app afterwards. The `stripe-import` edge
function (owner-gated, read-only) pages the connected account's
subscriptions (active / trialing / past_due, email-keyed) and returns
distinct prices + a row per subscriber. The review screen reuses the
member-import AI brain (`runInference`) to suggest a Temple plan name /
kind per Stripe price; the owner edits them and **ticks which prices and
which members** to import. Commit creates one `membership_plan` per
included price (caching `stripe_price_id`) and stages the chosen members
through `import_pending_members`, carrying the live
`imported_stripe_subscription_id` / `imported_stripe_customer_id` and the
renewal date.

When the member signs up with that email, the extended
`apply_pending_member_data` trigger (0089) creates their working
`plan_subscription` **carrying the live Stripe ids** (not null) and seeds
`gym_stripe_customers`. Because `stripe-webhook` matches membership subs
by the `stripe_subscription_id` column, renewals (`invoice.paid`) and
cancels (`customer.subscription.deleted`) then sync automatically, and the
in-app cancel / change-plan paths act on the real subscription. CSV
imports (no Stripe ids) are unchanged — they still create a null-Stripe
subscription. Customers with no email, and one-off (non-subscription)
buyers, are skipped (the no-email count is surfaced in the preview).

### Campaign topic picker

[`can_manage_comms`] Reachable from the campaign editor
(`/management/communications/<id>`). A horizontal chip row above the
audience builder lets the sender choose which topic the campaign is
sent under, or leave it as "No topic" (the pre-0058 default, only
suppresses members who hit the master "stop all" toggle). The live
audience count beneath the AudienceBuilder reflects the topic
suppression in real time; `comms_send_campaign` reads the chosen
topic and passes it to `comms_audience_rows` so the per-topic
suppression actually fires at send.

### Email topics

[`can_manage_comms`] Reachable from Manage → Communications → Email
topics (`/management/communications/topics`). Per-gym vocabulary of
categories — Newsletter, Programming, Promos, Billing — that
campaigns can be tagged with. The audience resolver
(`comms_audience_rows`) honours both blanket unsubscribes (the
historical NULL-topic row in `email_unsubscribes`) and per-topic
ones, so a member who unsubscribed from "Promos" still receives
"Billing reminders". Campaigns sent without a topic keep the
pre-0058 behaviour (only blanket unsubs apply).

### Member email preferences

Reachable from Account → "Manage email preferences"
(`/email-preferences`). A master toggle ("Receive any emails from
this gym") plus a per-topic toggle for each non-archived
`gym_email_topics` row. Subscribing to any topic also clears the
master "off" — the member's "yes" to this topic shouldn't lose to
the master "no". Behind the scenes, three SECURITY DEFINER RPCs
(`list_my_email_preferences`, `set_my_email_topic_subscription`,
`set_my_email_blanket_unsub`) gate writes on the caller's current
gym membership and `auth.users.email`.

### Communications Suite

[`can_manage_comms`, owner + admin by default] A Mailchimp-shaped email
surface, reachable from the **Comms** tab on Manage or
`/management/communications`.

- **Campaigns list + overview** — every draft / sent campaign with a
  status badge, plus headline tiles (campaigns, sent, emails delivered).
- **Block-based editor** — a WYSIWYG canvas built from stackable blocks
  (Heading / Text / Button / Image / Divider / Spacer). Each block
  reorders, duplicates and deletes; an inspector edits its text,
  alignment, colours and links. New content is seeded from the gym's
  brand palette, and a starter layout (logo + heading + copy + button)
  is dropped into every new campaign. Image blocks upload to the
  `email-assets` bucket or take a pasted URL. The document compiles to
  responsive, table-based HTML email (plus a plain-text alternative) via
  a pure, unit-tested renderer; a web iframe shows the real render.
- **Audience builder** — a mailing list from the gym's own members: all
  members, by lifecycle cohort (Intro / Active / Paying / Expiring /
  Expired), or by member tag. A live count resolves server-side, always
  excluding members without a usable email and anyone suppressed.
- **Send + delivery** — `comms_send_campaign` authorises, snapshots the
  resolved recipients, stores the compiled HTML, and flips the campaign
  to *sending*; the `send-campaign` edge function delivers via Resend (a
  pluggable ESP) — wrapping links for click tracking, injecting the open
  pixel, filling the unsubscribe URL per recipient. With no sending
  domain configured it records a clearly-labelled **simulated** send so
  the suite runs end-to-end.
- **Analytics** — a per-campaign funnel (recipients, delivered, open %,
  click %, unsubscribed, failed / bounced) recomputed from the recipient
  table, alongside the sent email's render. Opens / clicks / unsubscribes
  arrive via the public `track` edge function + `comms_track_event`.
- **Sender & footer settings** — from-name, reply-to, and the CAN-SPAM
  postal-address footer every send carries beside a one-click
  unsubscribe.
- **Sending domain, per-gym (0048)** — a gym can authenticate a domain
  they own to send from their own address (Mailchimp's
  domain-authentication tier). `gym_sending_domains` + the
  `sending-domain` edge function drive Resend's Management API: connect a
  domain → add the returned DKIM / SPF / DMARC records → verify, and
  `send-campaign` then sends from `<from_local>@<their-domain>`
  (DKIM-aligned, DMARC-passing, no "via" label) instead of the shared
  platform address. Free providers (gmail.com, …) are refused and a
  subdomain (mail.yourgym.com) is encouraged; the table is read-gated on
  `can_manage_comms` with **no client write path** (all writes go through
  the function under the service role). Falls back to the shared address
  until a domain is verified.
- **Hardening (0045)** — `effective_can` now gates on `left_at is
  null` (a soft-deleted admin loses every staff capability),
  `comms_send_campaign` takes a row lock to serialise concurrent
  "Send" clicks, and `email_campaigns.compiled_html` / `compiled_text`
  carry size CHECK constraints (2 MB / 512 KB) so runaway editors
  can't bloat the row. The `send-campaign` worker now (a) decodes
  HTML-entity-escaped `href` values before tracker-wrapping so links
  with `&amp;` round-trip correctly, (b) fans recipients out at a
  concurrency of 8 with a per-recipient Resend `Idempotency-Key` so
  big-gym sends complete inside the function timeout without risk of
  double-delivery, and (c) sets the `List-Unsubscribe-Post:
  List-Unsubscribe=One-Click` header so Gmail / Yahoo unsubscribes
  POST instead of GET — the `track` function now shows a confirm page
  on GET and only records the opt-out on POST, so a corporate scanner
  / link prefetcher can't auto-unsubscribe a member.
- **Compliance / privacy** — a per-gym `email_unsubscribes` suppression
  list the resolver always subtracts; member email (which lives in
  `auth.users`, not `profiles`) is only ever exposed through
  `can_manage_comms`-gated security-definer RPCs, never handed to the
  client raw.

### Website

[`can_manage_website`, owner + admin by default] A public marketing
page per gym, reachable from Manage → Website
(`/management/website`). A paid add-on: `gyms.website_builder_enabled`
gates every surface below and has **no owner-facing setter** — Temple
staff flip it directly after an external invoice, there's no self-serve
billing for it yet.

- **Block-based editor** — the same interaction model as the email
  builder (add from a palette, tap a block to edit its fields, up/down
  reorder, duplicate, delete), for 9 block types: Hero, About, Class
  schedule, Pricing, Team, Testimonials, Photo gallery, Hours &
  location, Contact. Schedule, Pricing and Team are read-only
  content-wise — they render the gym's real class sessions, membership
  plans and staff roster at view time (Pricing/Team can each hide
  specific rows without touching the source) rather than storing a
  copy, so none of the three can drift stale. Schedule rows are
  colour-coded by class type.
- **Templates (`src/lib/site-templates.ts`)** — four fully written
  starting points, paired 1:1 with the themes: Strength & Conditioning
  (Forged), Fight & Combat (Ringside), Boutique Studio (Daybreak),
  Coaching & PT (Baseline — the one consult-first funnel, its hero CTA
  scrolls to the contact form). Each builds the researched **multi-page**
  structure: a Home page that pitches, proves and converts (hero →
  about → testimonials → location → contact) plus dedicated Schedule,
  Team and Pricing pages for the three things that carry real,
  information-dense live data. Each of those three opens with a short
  intro paragraph (a per-template, benefit-first about block) before its
  live-data block — the page sets context and reassures before the raw
  grid/roster/plans. The hero headline is seeded from the
  gym's real name. Creating a site starts from a template picker; an
  existing site can apply a template from the editor's Theme section
  (confirm-gated — replaces every block on the *active page only*,
  keeps publish state and the site's other pages untouched).
  Deliberate gaps: testimonials ship empty and location without an
  address so the publish-blocking warnings act as a launch checklist —
  fabricated quotes or a missing address can never go live.
- **Class-type-aware image auto-population (`src/lib/site-auto-images.ts`)**
  — at site-creation time only (not when applying a template to an
  existing page), the hero photo and a gallery of up to 3 photos are
  searched and saved via the existing Pexels stock-photos integration,
  queried from the gym's own real class type names ("CrossFit gym",
  "Yoga training"…) rather than a generic archetype query — falls back
  to the archetype's `DEFAULT_STOCK_QUERIES` when the gym has no class
  types yet. Best-effort and silent: no `PEXELS_API_KEY`, a rate limit,
  or any network failure just leaves the template exactly as it was
  before this existed (photo-less hero, no gallery block) — site
  creation itself never fails because of it. The same fetched photos are
  also spread onto the intro about block of each non-home page
  (Schedule/Team/Pricing), alternating image side, so those pages open
  with a relevant image rather than a bare heading — reused, not
  re-fetched, so the photo cap stays at 4 total per site (1 hero + 3
  gallery) to respect the integration's platform-wide 200 req/hour
  Pexels budget. Pure query-building and
  image-placement logic lives in site-auto-images.ts (tested); the
  actual network calls live beside their one caller, `createSite` in
  management/website.tsx, since anything importing stock-photos.ts (and
  through it supabase.ts) can't be parsed by vitest. Photo-less
  background heroes still render with a subtle accent glow instead of a
  flat colour slab, for the no-class-types-yet / no-Pexels-key case.
- **Backfill intro sections (`addMissingIntros`/`applyIntroImages`)** —
  sites created before per-page intros existed (or any Schedule/Team/
  Pricing page an owner stripped back to just its live-data block) show
  an "Add intro sections" prompt in the editor. One tap inserts the
  intro about block for the site's own theme's template into every page
  that's missing one — in place, keeping every other edit, no
  delete-and-rebuild — and gives each a class-type photo the same way a
  fresh build does. Idempotent (only adds where missing, never
  duplicates, never touches Home) and best-effort on the photos (text-
  only if Pexels is off). `missingIntroSlugs`/`addMissingIntros` are
  pure and tested in site-templates.ts; the network fetch is orchestrated
  in `backfillIntros` in management/website.tsx.
- **Always-on site header** — every page shows the gym's logo (or name,
  if no logo is set) in a small header, rendered directly by
  `renderSiteHtml` rather than as a removable block — page furniture
  every gym site should always have, not something to add or delete.
  Once a gym has more than one page, the header also shows a nav link
  per page (current one marked `aria-current`), so it never appears
  for a single-page site.
- **Multi-page sites** — a site is `SiteDocument.pages: SitePage[]`,
  not a single flat block list; `pages[0]` is always Home (slug `''`,
  can't be renamed-away-from-home, reslugged, or deleted).
  Manage → Website shows a page-tab row (switch pages) plus a "Pages"
  button opening `PageManagerModal` (add/rename/reslug/delete —
  `addPage`/`renamePage`/`reslugPage`/`removePage` in
  `site-blocks.ts`; slugs auto-dedupe as `-2`, `-3`…). The Publish gate
  and the warnings panel both cover every page (`allPageWarnings`), not
  just the one on screen — a warning on a page the owner isn't
  currently viewing shows up prefixed with that page's title, and
  tapping it switches to that page. `/site/<slug>/sitemap.xml`
  (`api/site-sitemap/[slug].ts`) lists every page of a published site.
- **Live on-canvas editing (web)** — free-text fields (Hero headline/
  subheadline/CTA, About body, Testimonial quotes, Location address/
  hours, Contact copy) are directly editable inside the live rendered
  preview itself, not just the side-panel form — click the headline,
  type right there. Images, plan selection and theme stay side-panel
  only; the side panel remains fully functional for every field and is
  the only editing path on native, which has no iframe/webview. Above
  1280px wide the editor and canvas show side by side; narrower web
  widths keep a toggle between the two. Canvas edits sync to the panel
  (and vice versa) through a `postMessage` bridge validated against a
  field whitelist (`src/lib/site-canvas-sync.ts`); the preview iframe
  only ever reloads on side-panel/structural changes, never on a canvas
  keystroke, so typing never loses cursor focus.
- **Starter themes** — 4 named presets (Forged / Ringside / Daybreak /
  Baseline, `src/lib/brand-themes.ts`) shared with the email builder's
  own theme picker, so a gym's site and its marketing emails can use
  the same look. A theme composes with the gym's own saved brand
  colour rather than overriding it — two gyms on the same theme don't
  end up with identically-coloured pages regardless of their actual
  brand — and isn't baked into the stored page: a later brand-colour
  change is picked up automatically, no "reapplying" needed.
  `gym_websites.design` stores only the theme id.
- **Publish flow** — a draft is fully editable and previewable before
  going live; Publish/Unpublish is a separate explicit action from
  autosave. The staff-side preview reads the gym's real schedule/plans
  under the signed-in member's own RLS so a draft still previews with
  real content; the public route only ever serves a *published* site.
- **Public rendering (`/site/<slug>` for Home,
  `/site/<slug>/<page-slug>` for every other page)** — a standalone
  Vercel Serverless Function (`api/site/[...path].ts`, a catch-all so
  one function resolves both shapes), not an Expo Router screen: this
  project's web build is static-export only and can't mix in per-route
  server rendering, so a normal app route would ship an empty HTML
  shell to crawlers. An unknown page slug 404s; the function renders
  real HTML server-side per request via the same `renderSiteHtml` the
  in-app preview uses, reading `gym_website_by_slug` /
  `gym_public_schedule` / `gym_public_plans` / `gym_public_team` — four
  anon-grantable RPCs, each re-checking `published = true` itself since
  `security definer` bypasses the base tables' RLS. `gym_public_team`
  returns owner/admin/coach/staff who haven't left the gym (never plain
  members), matching the roster query Manage → Team already uses. The
  contact block
  submits straight to the existing `capture_public_lead` RPC via a
  small inline script — a real working form, not a link-out. A
  non-home page's `<title>` is `<page title> — <gym name>`; Home stays
  just the gym name. Nav links (and the hero's join CTA) are always
  absolute to the platform origin: a connected custom domain's
  middleware only rewrites its bare root to the renderer
  (`middleware.ts`), so a relative link to another page would 404
  there — a custom-domain visitor briefly leaves the custom domain when
  moving between pages, a known limitation, not a broken link.
- **Images** — hero/about/gallery uploads go to the `gym-website-assets`
  Storage bucket, gated the same way as the store's product-image
  bucket (`can_manage_website` + folder-scoped to the gym).
- **Stock photos (Pexels)** — a "Stock photos" button beside every
  image upload opens a search modal pre-filled per template archetype
  (`DEFAULT_STOCK_QUERIES` in `site-templates.ts`). The `stock-photos`
  edge function (`can_manage_website` + `website_builder_enabled`
  gated) proxies the search and copies the picked photo into the gym's
  `gym-website-assets` folder by numeric Pexels id only — the server
  never fetches a client-supplied URL. The picker carries the
  guideline-required Pexels/photographer credits; needs
  `PEXELS_API_KEY` per `docs/pexels-photos-setup.md`, and degrades to
  upload-only without it.
- **Custom domains (Manage → Website → Domain)** — a gym can connect a
  domain they own so the site serves from it directly instead of only
  `/site/<slug>`. The `custom-domain` edge function registers the
  domain on Temple's own Vercel project (no per-gym OAuth needed —
  unlike Stripe Connect, this is one platform API token, not a separate
  account per gym) and hands back DNS records to add; SSL is automatic
  once DNS resolves. `gym_website_domains` has **no client write
  policy** — every write happens under the service role, closing a real
  gap where the table's Phase-A speculative columns on `gym_websites`
  had no column-level RLS restriction. A new `middleware.ts` at the repo
  root (Vercel Routing Middleware) resolves a verified domain's `Host`
  header to a gym slug via `gym_slug_for_domain` and rewrites straight
  into the existing `/api/site/<slug>` function — no rendering logic
  duplicated. See `docs/vercel-domains-setup.md`.
- **JSON design download** — a "Download design (JSON)" chip in the
  editor exports the current `SiteDocument` as-is. A stopgap, not a
  working-site export: real static-HTML/zip portability (rewritten
  image URLs, an offline-capable contact form) is a larger future
  phase, deliberately not built yet.

### Coach-specific

- **Coach Earnings summary** [`can_set_coach_pay` for the owner] —
  per-class-type pay rates + total earnings for a date range, plus a
  per-coach breakdown card with a "Show breakdown" expander.
- **Cover claims and qualifications** [`can_request_cover`,
  `can_claim_cover`] — qualified-only cover claiming.
- **Tasks** [`can_manage_tasks`] — assign, reassign, complete, reopen.
- **SOPs** [`can_manage_sops` to write, `can_view_sops` to read] —
  doc-style standard operating procedures the whole team can read.
- **Coach Account screen** — own earnings card with date-range picker
  showing breakdown by class type.

### Health, safety & alerts

- **PAR-Q flow** [`can_see_health_flag`] — annual screening with the
  flag-on-yes pattern; flagged responses raise a staff alert.
- **Injury tracker (coach side)** — open injuries from members are
  surfaced on the member's profile + a body-region heat map on the
  Programming Analysis page; new injuries and weekly check-ins both
  raise staff alerts.
- **Staff Alerts inbox tab** [`can_acknowledge_alerts`] — kind-aware
  cards (PAR-Q flag / Injury new / Injury update) with Open profile
  and Acknowledge actions. Unacknowledged alerts also count toward the
  nav's unread indicator (`count_open_staff_alerts`), so a staff member
  sees there's something open without visiting the Inbox first.

### Messaging (coach side)

- **Class-session broadcasts** [`can_broadcast_to_class`] — message
  every member booked into a chosen class.
- **Gym-wide announcements** [`can_post_announcements`].

---

## Owner-only features

The owner role bypasses every capability check, but a handful of
actions are owner-only by policy:

- **One gym per account guard** — `create_gym` and `join_gym_by_slug`
  refuse if the caller already has an active membership somewhere
  else (active rejoin of the same gym is still allowed).
- **Pay rates** [`can_set_coach_pay`] — owner sets per-coach,
  per-class-type rates.
- **Targets** [`can_set_targets`] — Insights conversion / intro
  targets per month or quarter.
- **Hard delete** [`can_hard_delete`] — owner can delete classes /
  plans / class types when nothing depends on them.

---

## Cross-cutting platform features

- **Gym settings** (owner-only, Manage → Settings → Gym settings;
  surfaced as "Gym settings" but internally still the operating-defaults
  RPC + columns) — per-gym dials that used to be hard-coded into SQL:
  `week_starts_on` (Mon vs Sun), `timezone`, `default_class_capacity` +
  `default_class_minutes`, `expiring_within_days` (the cohort "expiring
  soon" window, read by `v_member_cohort`), `parq_expiry_days` (read by
  `_book_class_for` + `current_parq_state`), `health_retention_months`
  (read by `purge_expired_health_data`), `lead_conversion_window_days`,
  `materialisation_horizon_weeks`, `subscription_resolution`,
  `booking_window_hours_ahead` (earliest a member can book; null =
  unlimited), `booking_cutoff_minutes_before` (latest a member can
  book; refused inside the window), `cancel_cutoff_minutes_before`
  (cancel always allowed but credit forfeited past this cutoff —
  enforced inside the refund trigger). The free-cancel cutoff has a
  gym-wide **mode**: `relative` (the minutes-before above) or
  `day_before` — forfeit once now() passes `cancel_cutoff_time`,
  `cancel_cutoff_days_before` days before the class's own local date,
  computed in `gyms.timezone` (e.g. "cancel by 9pm the night before").
  A class type's relative override still wins over the gym mode. The
  three numeric booking-window fields are entered with a min/hr/day/wk
  unit toggle (`DurationField`); the client mirrors the absolute cutoff
  for its late-cancel warning via `src/lib/zoned-time.ts`. Each of the
  three booking-window fields can be overridden per class type — a
  non-NULL `class_types.booking_window_hours_ahead` /
  `booking_cutoff_minutes_before` / `cancel_cutoff_minutes_before`
  beats the gym default, NULL falls back. Used for open-gym slots
  with no cutoff coexisting with strictly-coached classes. Surfaced
  in the class-types editor as an "Override" expandable per class
  type — leave each field blank to inherit the gym setting. All
  default to the prior hard-coded value so existing gyms see zero
  behaviour change. `class_types` gained `default_capacity` (overrides
  the gym default), `coach_required` and `unsupervised_label` (replaces
  the literal "Unsupervised" string with a per-class-type customisable
  one). `class_sessions` + `class_recurrences` gained a `location`
  field for multi-room gyms. The colour-swatch palette grew from 8 to
  16 hand-tuned stops to give multi-class-type gyms distinguishable
  options at thumbnail size.
- **Unified `BackLink`** — every back affordance on a deep page goes
  through `src/components/BackLink.tsx`. Two variants
  (`chevron + label` for Manage / Account-style headers; `inline`
  chevron-only for row-with-title headers in Track / Inbox / Athlete /
  Member-detail) share one navigation contract:
  `router.back()` when there's history, `fallbackHref` when the page
  was opened cold (shared URL, push notification) so the user never
  hits a dead-end. Hand-rolled chevrons were removed; only `BackLink`
  renders the back icon now.
- **Persistent top nav** — Programming / Classes / Manage pills for
  staff; Book / Programming / Track for members. Inbox icon, theme
  toggle, avatar (account), Viewing-Staff / Viewing-Member switch on
  the right for users with both modes.
- **Light / dark mode** — system pref by default, user can override
  in the nav; OS chrome (Safari notch, Android URL bar) tracks the
  in-app preference.
- **Mobile + desktop** — every page responsive; mobile-specific
  tweaks for the body map, the programming matrix, the navigation bar
  pill layout, and the Manage tab strip.
- **PWA branding** — browser-tab favicon, iOS apple-touch-icon, web
  manifest (Chrome / Android "Install app"), document title and
  apple-mobile-web-app-title are all swapped at runtime from
  `useGymBrand`. A member who taps "Add to Home Screen" while signed
  into their gym gets an installed app whose icon IS their gym's logo
  and whose label IS their gym's name — falls back to the Temple
  defaults when no logo is configured. (Native App Store binaries
  stay Temple-branded; only the web/PWA install is per-gym.)
- **Crash screen** — production error boundary with stack +
  componentStack + route + try-again.
- **Capability matrix** — every staff feature is gated by a single
  capability key; owners can override default mappings per role
  (`gym_role_capabilities` table).
- **Soft delete + restore** — archive / restore semantics on class
  types, plans and members; hard delete is owner-only and blocked
  when dependent rows exist.

---

## Data protection (health data / GDPR Article 9)

PAR-Q and injury data are special-category health data. The protective
surround:

- **Consent gate** — every member (and staff) must record
  data-processing consent before entering: name + date of birth +
  three consent clauses, captured on the `/consent` onboarding screen.
  No consent, no entry. Bumping `CONSENT_POLICY_VERSION` re-gates
  everyone. (`member_consents` + `record_consent` RPC.)
- **Lawful-basis record** — each consent row stores the policy version,
  lawful basis, and timestamp.
- **Erasure on removal** — `leave_gym` (the single removal path for
  both self-leave and admin-remove) hard-deletes the member's PAR-Q
  responses + answers, injuries + updates, health staff-alerts, consent
  record, and clears the denormalised `health_flag` / `par_q_id` /
  `emergency_contact`. Members can also withdraw + erase from their
  account screen.
- **Retention purge** — `purge_expired_health_data()` sweeps health
  data for members who left more than 3 months ago (schedule via
  pg_cron or a nightly job; safe to run manually).
- **Waiver-signature purge** — `purge_expired_waiver_signatures()`
  deletes waiver signatures 6 years after the member left (statutory
  limitation window), scheduled nightly via pg_cron (`0108`/`0109`).
  Waivers are deliberately outside the health-data erasure sweep
  (lawful basis: defence of legal claims).
- **Access audit trail** — `health_data_access_log` records every
  health-data view / erase / purge with actor, subject, surface and
  timestamp, admin-readable only. Staff health surfaces call
  `log_health_data_access` on open; a guardian reading a child's
  waiver / PAR-Q state is logged too.
- **Breach detection** — `run_security_monitor()` (pg_cron, every 15
  min) scans for anomalous health-data access and privilege changes,
  records findings in `security_alerts`, and POSTs new alerts to the
  `security-alert` edge function, which emails ops when its shared
  secret is configured. Runbook: `docs/legal/breach-response.md`.
- **Under-18 members** — off by default per gym (`gyms.allow_minors`,
  set via `set_allow_minors`). When on, `record_consent` enforces the
  age floor server-side and captures date of birth + guardian details.
- **Company legal documents** — Terms of Service, Privacy Policy and
  DPA drafted for Temple Software Ltd (`docs/legal/`), surfaced
  in-app at `/terms` and `/privacy` with a sign-up consent notice. A
  web cookie banner (`CookieBanner`) records analytics consent ahead
  of product tracking. DPIA + lawful-basis register drafted in
  `docs/legal/` (still need owner sign-off, not engineering).

> Still pending (needs owner / DPO sign-off, not engineering): the
> DPIA and lawful-basis register are drafted in `docs/legal/` but
> need formal sign-off, and the legal docs carry a DRAFT banner with
> registered-office / effective-date placeholders to fill in.

---

## Technical platform features

- **Auth** — Supabase email/password with a consent gate + annual
  PAR-Q gate; invite codes for onboarding.
- **RLS everywhere** — every table is gated, every dangerous write
  is funnelled through a `security definer` RPC with explicit
  authorisation.
- **Cloud-only dev workflow** — push to main → CI (tsc + 403 vitest
  + 90 pgTAP files) → migrations auto-deploy to the hosted Supabase
  project → Vercel auto-deploys Production.
- **Vercel rewrites for dynamic routes** — `/join/:slug`,
  `/track/movement/:movement`, `/track/group/:group`,
  `/track/workout/:id`, `/inbox/direct/:peer`,
  `/management/members/:profile`.
- **Demo gym seeder** — `npm run seed:demo` creates a fully-populated
  demo tenant with real signable-in accounts (timetable + attendance
  history, progressing PRs, Hyrox races, injuries, leads, campaign
  draft, store, published website), deterministic per `--seed`, with
  a guarded `--teardown`. Runbook: `docs/demo-gym.md`.

---

## Roadmap / not yet shipped

Items the conversation has flagged but not implemented yet:

- **Health-data GDPR — owner sign-off remainder**: the DPIA and
  lawful-basis register are drafted (`docs/legal/`) but need formal
  owner sign-off, the in-app legal docs carry a DRAFT banner with
  registered-office / effective-date placeholders to fill in, and
  `purge_expired_health_data()` still needs scheduling in the hosted
  environment (the waiver-signature purge and security monitor are
  already on pg_cron). The engineering surround (consent gate,
  erasure, retention sweep, audit log) has shipped.
- Health-data reads hardened to definer-function access (today the
  audit log is written by the app surfaces, not enforced at the row
  level for raw API calls).
- Supabase preview branches + Vercel preview environments.
- Bigger themed BodyMap redesigns (Halloween / Christmas / Pride /
  New Year) — designs explored but parked.
- **Communications Suite — live delivery + extras**: the send /
  tracking / domain-authentication pipeline ships behind a pluggable
  ESP. Going live just needs `RESEND_API_KEY` (+ `RESEND_FROM_EMAIL`
  for the shared-domain fallback) on the `send-campaign` /
  `sending-domain` functions; until then sends are simulated.
  Per-gym sending domains are built (0048); scheduled sends, A/B
  subject testing, a hand-pick-members audience picker, and a reusable
  saved-segment / template library are scoped but not yet built.
