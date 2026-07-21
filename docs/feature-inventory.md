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
  branded product grid; each item shows a swipeable photo gallery (dots
  when there's more than one) that opens a **full-screen viewer** on tap —
  swipe between images, pinch or double-tap to zoom. Plus price, stock
  ("3 left") and a **Sold out** state once a tracked item hits zero. Buy opens Stripe Checkout on
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
  hide / remove products, mark one recurring, upload up to 8 photos (drag
  to reorder; the first is the cover) and (for digital) the download file,
  set stock; an orders queue with the buyer,
  items, shipping address and a **Mark shipped / done** action; a **Sales
  this month** tile [`can_see_store_revenue`].
- **Owner settings** — switch the store off/on (on by default for
  every gym since 0154) and set the shipping fee (`gyms.store_enabled`
  / `store_shipping_fee_cents`, RPC `set_store_settings`). Owners pick
  who manages the store and who sees revenue from the Team →
  role-permissions editor.
- **Under the hood (0085–0087)** — `store_products` / `store_orders` /
  `store_order_items` / `store_digital_deliveries` / `store_subscriptions`,
  all `gym_id`-RLS; products carry an ordered `image_urls` gallery (0135,
  capped at 8; `image_url` kept as the cover for Stripe + thumbnails); the
  member catalogue reads through `list_store_products`
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
- **Individual programming (member side)** — when a coach has written
  a personal programme for the member, an "Individual programming"
  card renders in the same day list as the class-type cards (same
  shell, brand-coloured dot; present only when the member actually has
  one — no card, no trace otherwise). It shows that day's personal
  sections plus a "Programme documents" footer listing any uploaded
  PDFs (opened via a short-lived signed URL on the private
  `member-programming-files` bucket). Access is per member: **free**
  (default) or **paid** — unlocked by an active/one-off purchase of a
  linked store product **or** a current subscription to any plan
  flagged `includes_individual_programming`. Locked members see a
  persistent locked card ("your coach has written you a personal
  programme") with an Unlock button into the store's Stripe checkout
  and/or a View-memberships link; RLS hides the rows themselves
  (`has_individual_programming_access` in the self-select policy), and
  `my_programming_access` is what tells the locked card a programme
  exists at all. The recorder offers a "Your programme" pre-fill chip
  for the day's personal sections (`tracked_workout_sections.
  source_member_programming_id` links the log back; personal sections
  never enter class leaderboards).

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
- **Individual programming (staff side)** [`can_program_members`,
  owner + admin + coach by default] — write a personal programme for
  ONE member on a calendar, using the same week-strip calendar +
  section editor as class programming (`member_programming`: one row
  per gym × member × date, same `Section[]` jsonb shape; leaderboard
  toggle hidden — leaderboards are class-session concepts). **Two
  entry points, one editor**: an "Individuals" chip on the staff
  Programming page opens `/management/member-programming` (members
  with a programme + a search to start one — no setup step, the first
  save materialises it), and a "Programming" card on the member's
  profile deep-links to the same member-scoped calendar. From there a
  **Documents** chip uploads/removes programme PDFs (private storage
  bucket, rows in `member_programming_files`), and an access chip
  (Free/Paid) opens the access modal: free, or paid with an optional
  linked store product (picker reads the member catalogue via
  `list_store_products`, so coaches don't need `can_manage_store`) —
  written through the `set_member_programming_access` RPC. A hint in
  the modal notes that flagged membership plans always unlock.
  Removed members: existing rows stay staff-visible, new writes are
  refused (RLS WITH CHECK on `left_at`).
- **Programming-only plans (PT memberships)** — `membership_plans.kind
  = 'programming_only'`: a recurring plan that sells individual
  programming and **cannot book classes** (the booking-entitlement
  predicates only admit unlimited or credit kinds, so it's excluded by
  construction; the class-detail "membership required" upsell filters
  it out). It always carries `includes_individual_programming` (CHECK-
  enforced); any other kind can also tick the flag in the plans editor
  ("Unlimited + individualised programming"). Subscribers still count
  as active/paying for cohorts, and checkout/change/cancel ride the
  existing Stripe rails (every non-credit_pack kind is subscription
  mode).
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

- **Insights** [`can_see_insights`] — trimmed to three top-line KPIs
  driven by one date range: Revenue (all sales — memberships, store,
  individual programming), Members, Attendance % (share of members
  who attended a class in the period), each with a delta vs the
  previous period. Lead/lifecycle metrics (new leads, intro sessions,
  conversion to member) live on the **Leads** tab instead — see below.
  The **Targets** editor [`can_set_targets`] and the retired
  Expiring/Expired/Paying/rate-based-Conversion/Retention tiles are no
  longer surfaced anywhere; `gym_insight_targets` and
  `compute_insight_summary` still exist server-side.
- **Members** [`can_manage_tags`] — Attendance summary (Attended /
  No-show / Unmarked) by class type, **shareable signup link** card
  (Copy / Share, with archived state when public signup is off),
  searchable + filterable member list with PAR-Q badge, Injury badge,
  cohort badges (Intro / Active / Paying / Expiring / Expired), plan
  chips, tag chips; **Export members CSV**; **Tag rules** editor.
  **Imported members** [`can_manage_staff`] that haven't signed up yet
  (`pending_members` rows, status `pending`/`invited`) are surfaced
  inline in the list, interleaved by name with live members, each
  carrying an amber **Imported** / **Invited** badge, their imported
  plan + credits + tags, and a per-member **Send invite** action
  (`send-member-join-invites` scoped to that one row, which flips it to
  `invited`); an **Imported** filter chip isolates them, and a caption
  above the list counts how many haven't signed up. `invited` rows show
  "waiting for sign-up" with no re-send (the edge function only targets
  `pending`). Tapping an imported card opens a **detail/edit page**
  (`/management/members/imported/<id>`) where staff review and correct
  the staged account before inviting — name, email, phone, DOB,
  emergency contact, plan/credits/dates, tags, notes and a "do not
  email" toggle, saved with a direct RLS-gated `pending_members` update;
  the page also **sends the invite** (auto-saving edits first) and can
  **delete** the staged row (e.g. to clear junk from a test import). The Members screen (`/management/members`) also hosts
  **member invites** [`can_invite`] — email a member, generate a code +
  QR, or use the front-desk walk-in QR (same card UI as staff invites
  on Team).
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
  **Accepting an invite skips the email-confirmation step**: clicking the
  link already proves the invitee owns the address, so the `accept-invite`
  edge function creates the account **pre-confirmed** (`admin.createUser`
  with `email_confirm: true`, gated on a valid unused code) and the client
  signs straight in and binds membership via `accept_invite` — no second
  confirmation email to wait on. Self-serve gym and member signups still
  confirm as before.
- **Billing & payments** [owner] — Manage → Plans → Billing &
  payments (`/management/billing`). Connect the gym's own Stripe (Connect
  **Standard**, via OAuth) so it can charge members directly; Temple
  takes no application fee. Phase 1 (built) stores the connected account
  on `gym_stripe_accounts` via the `stripe-connect-start` /
  `stripe-connect-callback` edge functions. Member checkout and the
  subscription-recording webhook are built (`stripe-checkout` /
  `stripe-webhook`). Needs `STRIPE_SECRET_KEY`
  + `STRIPE_CONNECT_CLIENT_ID` secrets — see `docs/stripe-setup.md`.
  **Connection health + disconnect/reconnect** (`stripe-account` edge
  function, owner-only): the billing screen no longer trusts a
  `gym_stripe_accounts` row to mean "connected" — it asks Stripe
  (`accounts.retrieve`) whether the account is actually reachable by the
  platform key and `charges_enabled`, and shows **Connected / Finish
  setup / Needs attention** accordingly (a revoked grant or a
  wrong-account/mode key surfaces as "needs attention" instead of a false
  green). **Disconnect** best-effort OAuth-deauthorizes then always
  clears the row (service role — mirrors sending-domain / custom-domain,
  so a gym can never get stuck on a dead link); **Reconnect** clears then
  re-runs the OAuth start. The shared health check lives in
  `src/lib/stripe-health.ts` (type + query key + fetch) so billing and
  plans reuse one cached result. The **Plans** screen gates plan creation
  on this health, not row-existence — a broken/unreachable connection
  shows a "needs attention → Fix in Billing" banner and blocks creating
  new plans (optimistic while the check loads/errors, so a transient blip
  never over-blocks).
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
- **Refunds** [`can_refund`] — a **Refund** action on each plan in a
  member's staff detail screen (`members/[profile]`). Opens a dialog with
  four modes, each previewing its amount live (`src/lib/refunds.ts`, pure +
  unit-tested; pro-rata = credits-remaining ratio for packs, days-remaining
  ratio for time-based plans):
  **pro-rata + end now** (refund the unused slice, cut access, stop
  renewals — the default), **full refund keep-to-period-end**,
  **full refund end-now**, and **refund + keep** (goodwill; full or a
  custom amount, access and renewals untouched → sub goes
  `refunded_retained`). The `stripe-refund` edge function
  (`can_refund`-gated — its own capability, owner-only by default but grantable per-role or per-teammate in Team → permissions, independent of `can_see_money`) recomputes the amount server-side, refunds the
  most recent settled charge on the gym's connected account
  (`POST /v1/refunds`, Stripe-Account header), cancels the Stripe
  subscription per mode, updates `plan_subscriptions`, and records a
  `billing_events` `kind='refund'` row (excluded from revenue by
  `is_revenue_event`). An **"Email the member" toggle** (default on) sends
  the member a branded refund email (`templeEmailHtml`, from the gym's
  verified sending domain or the platform `RESEND_FROM`) whose access line
  varies by mode — ended / ends at period end / carries on. Best-effort and
  idempotent (`Idempotency-Key: refund:<id>`); only fires when money
  actually moved, and a Resend hiccup never fails the refund. A refunded
  plan carries a rose **Refunded** badge (+ the amount and date on the detail
  line) on the member's staff detail screen — driven by the `kind='refund'`
  `billing_events`, so an end-now refund reads as refunded rather than an
  indistinguishable plain `cancelled`.
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
    class capacity / duration, plan-resolution
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

[`can_assign_plan`] Reachable from Manage → Leads
(`/management/leads`), a top-level section (renamed from "CRM" — the
nav category key is still `crm` internally). Track prospects from
first contact through conversion. A date-range-scoped stats row up
top shows **New leads** (captured in the period, straight off the
`leads` table), **Intro sessions** and **Conversion to member** (both
from the same `compute_insight_summary` RPC the Insights tab uses).
Each lead row stores name, email, phone, source (from a
per-gym `lead_sources` vocabulary), a notes field, and a fixed status
pipeline: `cold → contacted → intro_booked → trial_attended →
converted | lost`. `record_lead` and `set_lead_status` RPCs gate
writes; tenant RLS uses `user_can_assign_plan`. Moving to
`converted` requires a member profile to link to (the rule is
enforced in the RPC), so the conversion dashboard can attribute
revenue to its source. The page is a **pipeline board** — a column
per stage (Cold → Contacted → Intro booked → Trial attended, plus
Converted/Lost under an "All stages" toggle), leads as cards; tap a
card to open the detail modal and move it between stages. An
owner-only **AI Sales Agent** CTA launches the setup wizard
(`/management/leads/agent-setup`). The detail modal exposes a manual "Converted" flow
with an inline member search for cases where auto-attribute on
signup didn't fire.

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
`captured_by`. The public form also carries an explicit marketing-consent
tick (unticked by default); ticking it records `marketing_consent`,
`consent_at` and a `consent_policy_version` on the lead, while the enquiry
record itself rests on `lawful_basis = 'legitimate_interest'`. IP-level
throttling is a noted follow-up (would need an edge function in front).

### Lead-to-coach automation

Every captured lead (staff-entered or public) is auto-assigned to a coach
and the coach is notified, so nothing falls through the cracks. Assignment
is deterministic and zero-config: with no rule set, `assign_lead`
round-robins across active coaches (least-loaded first, longest-idle
tie-break), falling back to an owner/admin if a gym has no coaches — a lead
is never silently dropped. Owners can change the strategy at Manage → Leads
→ Settings (`/management/leads/settings`): `round_robin` (default),
`single_default` (one named coach), or `manual` (no auto-assign). Rules live
in `lead_assignment_rules`; the setter and page are owner-only.

Notifications are logged in `lead_notifications` — the reliability backbone.
On assignment `enqueue_lead_notifications` writes an in-app row (delivered
instantly; drives the assignee's nav badge via
`count_unread_lead_notifications`) and a queued email row, deduped by an
`idempotency_key` so retries never double-fire. The `send-lead-notifications`
edge function drains queued email rows via Resend (from-address + live-vs-
simulated gating identical to `send-invite`), invoked best-effort by the
client after capture and re-invokable from the owner screen. Failed sends
show on the lead detail with a Retry (`requeue_lead_notification`). SMS is a
seam: gated on `gyms.lead_sms_enabled` (owner toggle) and stubbed as
`skipped` in the worker until a provider is wired.

The Leads screen adds a per-lead assignee, a Reassign control
(`set_lead_assignee`, cross-tenant-guarded), a "Needs follow-up" filter
(cold + untouched > 24h) and a Nudge action (`nudge_lead`) that re-notifies
the assignee. GDPR retention: unconverted leads past
`gyms.lead_retention_days` (default 365, owner-configurable) are deleted by
`purge_expired_leads`, scheduled daily via `pg_cron` (0115) alongside the
health-data purge; converted leads are kept as members.

### AI front desk

An AI agent that answers and sells memberships to inbound leads over SMS
and phone calls on a platform-provisioned per-gym Twilio number. Setup and
rollout runbook: `docs/ai-front-desk.md`.

Inbound texts hit the `lead-agent-sms` edge function (Twilio-signature
guarded, no JWT): it resolves the number to a gym via `gym_agent_settings`,
dedups on MessageSid, stores the turn in `agent_conversations` /
`agent_messages`, returns empty TwiML immediately, then finishes in
`EdgeRuntime.waitUntil` — a Claude tool loop (`LEAD_AGENT_MODEL`, default
`claude-sonnet-5`; static handoff reply when `ANTHROPIC_API_KEY` is unset)
answers from live `membership_plans` + next-7-days `class_sessions` plus
owner-written notes, and replies via the Twilio REST API. Tools:
`capture_lead` (→ `agent_capture_lead`, internal SECURITY DEFINER — gym and
phone derive from the conversation row, phone-dedup 30 days, auto-creates a
per-gym "AI front desk" `lead_sources` row, `assign_lead` round-robin),
`send_join_link` (the real `/join/<slug>` URL, only when
`public_signup_enabled`), and `request_handoff` (→ `agent_request_handoff`:
pauses the thread, notifies the assigned coach through
`enqueue_lead_notifications` with a date-stamped `agent-handoff` key).
STOP/UNSUBSCRIBE closes the thread via `agent_stop_conversation` and
withdraws `marketing_consent` on the linked lead.

Voice: a managed Vapi assistant fronts calls on the same number and hits
`lead-agent-voice` (`x-vapi-secret` guarded) for the same tools — from a
call, `send_join_link` texts the link and logs it into the SMS thread — and
posts its end-of-call transcript into the `voice` conversation. Gyms
without voice enabled point Twilio's voice webhook at the `/missed-call`
path: a short "we're texting you" TwiML answer plus an automatic opening
SMS.

Staff surfaces [`can_assign_plan`]: Manage → Leads → Conversations lists
every thread (AI replying / With a coach / Opted out); the thread view
polls live, and Take over / reply / Hand back to AI go through the
`lead-agent-staff-send` edge function (JWT + RLS-proven authorisation —
staff replies send from the gym's number and implicitly pause the agent).
The lead detail modal deep-links to its conversation. Owner settings live
on Manage → Leads → AI Agent: enable toggle, voice toggle (disabled until
Vapi is provisioned), and the free-text "what the agent knows" card
(`set_gym_agent_enabled` / `set_gym_agent_voice` / `set_gym_agent_context`,
all owner-only; `phone_number` and `vapi_assistant_id` are service-role
only — Temple provisions them). pgTAP: `agent_front_desk_settings`,
`agent_conversations_isolation`, `agent_capture_lead`,
`agent_stop_consent`.

**Call review, coaching & voice (0137)** [`can_review_ai_calls`, owner/admin].
Voice calls are recorded (Vapi artifact) and pulled into a private
`agent-call-recordings` Storage bucket at `/end-of-call`; `call_recordings`
points at the object and per-turn `secondsFromStart`/`duration` land on
`agent_messages`. The conversation screen becomes a QC surface: web-first
`<audio>` playback with the transcript highlighting and seeking in sync
(native degrades to transcript-only), and every playback writes
`agent_recording_access_log` via `log_recording_access` (admin-only read,
mirroring `health_data_access_log`). **Coaching loop:** "Coach this turn" on
any AI message writes `agent_coaching_corrections` via
`record_agent_corrections` (tenancy-guarded, `can_review_ai_calls`); the agent
loop reads this gym's active corrections back in `fetchCoachingText` and
`buildSystemPrompt` injects them (standing rules + approved examples) into
every future call — the per-gym analogue of `import_inference_corrections`.
Owners manage the ruleset (turn rules off via `set_agent_correction_active`),
pick a regional voice (`set_gym_agent_voice_selection` → `{provider, voiceId,
region}` on `gym_agent_settings`, applied to the Vapi assistant), and control
recording + retention (`set_gym_call_recording`, floor 30 days). Recordings
are treated as health-grade: consent line at call start, honoured on STOP, and
a nightly `purge_expired_agent_recordings` cron that also deletes the Storage
object. **Highlight-to-comment (web only):** selecting a phrase inside an AI
bubble auto-pauses playback and surfaces an inline "Comment on ..." popover
anchored under that turn, reusing the same kind/scope fields and
`record_agent_corrections` call as "Coach this turn" but with
`ai_suggestion` set to the exact excerpt rather than the whole message;
native keeps the original tap-the-bubble flow (`window.getSelection` has no
native equivalent). pgTAP: `agent_qc_backend`.

**Setup wizard (AI Sales Agent).** The Leads page's "AI Sales Agent" CTA opens
`/management/leads/agent-setup` — a stepper (welcome → prompt → voice →
recording → go live) over the same owner RPCs. The prompt step either takes
manual text or **generates a brief from platform data**: the
`generate-agent-prompt` edge fn (owner/admin, `effective_can`) gathers the
gym's plans, schedule, class types, coaches and waivers, plus a few owner
answers (class levels, where beginners start, onboarding, location), and
Claude drafts the agent's brief (`AGENT_PROMPT_MODEL`, default
`claude-sonnet-5`; deterministic template fallback with no key) — saved to
`gym_agent_settings.context` via `set_gym_agent_context`, fully editable.

**Onboarding at close (0138).** When the agent closes, the `start_onboarding`
tool stages the member via `agent_stage_onboarding` (service-role, tenancy from
the conversation; reuses `pending_members` keyed on `(gym, lower(email))`) and
texts + emails a pre-filled `/join/<slug>?email=&name=` link (the join screen
seeds those fields). The member creates their own account and **personally**
signs the waiver and PAR-Q through the normal entry gate (`index.tsx`:
consent → waiver → PAR-Q) — the agent never signs or answers health questions,
which is structurally enforced (those writes are RLS-locked to `auth.uid()`).
No `linked_membership_plan_id` is set (that grants an unbilled plan, for
imports), so a new paying member checks out normally. pgTAP:
`agent_stage_onboarding`.

**Full close via one-time link.** The `enroll_member` tool is the hands-free
version: once the prospect commits and reads back their email, it mints a
single-use Supabase Auth link (`generateLink` `invite`, falling back to
`magiclink` for an already-registered email) pointing at the same pre-filled
`/join/<slug>?email=&name=`, stages them with `agent_stage_onboarding`, and
**emails the link only** (`sendMagicLinkEmail`, RESEND). The link is a bearer
credential, so it is never texted — the SMS is a heads-up ("check your email")
only; if email delivery isn't configured it degrades to texting the ordinary
pre-filled signup link (safe, since they create their own account there). No
password is ever generated or sent. The member still personally signs the
waiver + PAR-Q and pays through the entry gate. Note: the link's `redirectTo`
must be an allowed Redirect URL in the hosted Supabase Auth config for it to
land on `/join`.

**Voice parity via assistant sync (0140).** `sync-vapi-assistant`
(owner/admin, `effective_can`) PATCHes the gym's Vapi assistant with the
live system prompt (owner notes + coaching corrections), all six tools
including the close tools, the picked voice, and a greeting that disclosed
the AI and — when recording is on — the recording notice
(`recording_notice_at` backs an honest `consent_state`; needs
`VAPI_API_KEY`). Every agent-related save in the app triggers a sync, so
the phone channel no longer drifts from SMS.

**Close hardening (0141-0144).** The close records the agreed plan
(`pending_members.agreed_plan_id`, never the unbilled
`linked_membership_plan_id` — which agent staging now actively clears on
imported rows) and advances the lead to the new `committed` board stage;
`my_agreed_plan` routes the member to Membership where their pick is one
tap from checkout ("Not now" clears it). `/join` recovers expired or
scanner-consumed one-time links and "already registered" signups with a
fresh emailed link. Replies into handed-off threads ping the coach
(hour-throttled, owner fallback; "Waiting on you" badge in the inbox).
Guardrails: agent email capped 3/day per conversation and per address
(`agent_email_send_allowed`), per-gym `daily_message_cap` (over it the
thread hands off instead of burning spend, usage strip on settings),
STOP holds across channels (no voice-triggered texts to an opted-out
number), `conversation_retention_days` + nightly purge age transcripts
out, and Vapi end-of-call retries dedupe on the call id. pgTAP:
`agent_stage_onboarding`, `agent_handoff_reply`, `agent_guardrails`.

**Setup wizard v2, voice previews, interview mode (0146-0147).** The
wizard's questions are sales-first (intro offer leads; tone pick
friendly/professional/high-energy; most-asked-questions field; the
platform-run onboarding question is gone), the welcome step shows live
counts of what the brief already contains, the voice list groups the
gym's own region first (from timezone/currency) with the top match
preselected, "Regenerate" warns before replacing hand edits, and go-live
is a test-drive step. The voice catalogue is ElevenLabs (Vapi provider
`11labs`, rendered through Vapi's bundled access — no per-gym key). Each
voice row can have a play button: with an `ELEVENLABS_API_KEY` set,
`voice-sample` synthesises the clip once (ElevenLabs TTS, allow-listed
ids) into the public `agent-voice-samples` bucket; without it the buttons
are hidden. "Teach it by talking"
(settings, owner-only): `agent-interview/start` rings the owner via a
Vapi outbound call — a transient interviewer assistant (in the gym's
chosen voice) asks about the offer, beginners, parking and FAQs; the
end-of-call transcript is distilled by Claude into a DRAFT brief stored
on `agent_interviews`, which the owner edits and applies (or discards)
from the settings card — a call never rewrites the live agent directly.
pgTAP: `agent_interviews`.

**Outcomes + health flag (0148).** The settings usage card now shows
results, not just activity: agent-sourced leads captured (30d), joined
(30d), and the attributed monthly value of those members' current
recurring plans (`agent_outcomes`, owner-only). And when a prospect
mentions an injury on a call, the `flag_health_mention` tool writes one
fixed marker line on the lead and pings the coach (daily-deduped) — the
tool takes no free text, so the model structurally cannot record the
medical details (Article 9 boundary). pgTAP: `agent_outcomes`.

**Objection handling + cold-lead signal (0150).** The agent now actively
works hesitations instead of only staying helpful: a prompt rule tells it
to acknowledge a concern, answer with one concrete fact (the intro offer or
the right class), and offer a low-pressure next step, then call
`log_objection` with the reason and where they landed
(considering/deferred/declined). `agent_record_objection` stores a fixed
**category** label (price/time/location/nerves/comparing/not_ready/other —
never free text, so no health detail or injected prose can land in this
un-erased lead field; 0151) on `leads.objection` (shown on the board card and
the lead detail) and sets `leads.follow_up_at`
— the cold signal: a deferral schedules a chase in 3 days, a decline flags
it due now and pings a coach (never auto-`lost` — that stays a human call).
`flag_stale_leads` (cron 05:15) flags any un-converted lead with no edit and
no inbound message for 7 days and notifies its coach; `set_lead_status`
clears the flag when staff act (as does `clear_lead_follow_up` from the lead
detail's "Mark followed up"); the sweep skips opted-out (closed-conversation)
leads and terminal ones; the board's "to chase" count and per-card "Follow up"
badge read from `follow_up_at`. pgTAP: `lead_objection_and_cold`.

**First class auto-booked (0149).** The close tools accept the class the
prospect agreed to try (`first_class {name, day, time}`, resolved
timezone-aware against the next 14 days of real sessions — fuzzy
descriptions stage nothing rather than guessing). It stages on
`pending_members.first_session_id`; when the member's membership
activates after checkout, the membership screen books it as the member
through `book_class` — every entitlement/capacity/window gate still
applies, the agent never inserts a booking — then shows "You're booked
into …" (or routes to the Book tab if the class filled up, clearing the
staging either way). `my_staged_first_class` / `clear_my_first_class`
are the member-facing RPCs. This completes the hands-free close: call →
committed lead → one-time link → forms → pre-selected plan checkout →
booked first class.

**Self-serve front-desk provisioning, phase 1 voice (0152).** A gym owner
can turn the AI front desk on without ever touching Vapi or Twilio —
Temple owns both accounts and provisions per gym on demand. Gated on an
operator-set `front_desk_entitled` flag (`set_gym_front_desk_entitled`,
service-role only — no platform billing yet, so this is the manual "is
this gym paying" switch; a future billing webhook flips the same flag).
`provision-front-desk` buys a GB local voice number under Temple's
regulatory bundle, creates the gym's Vapi assistant, imports the number
onto it, and syncs prompt/tools/voice — resumable step-by-step, so
retrying a `failed` run never buys a second number or assistant.
`deprovision-front-desk` tears it down (churn or the owner turning it
off). Entry points: the setup wizard's go-live step and the AI Agent tab's
"AI front desk" card both show a "Set up my number" button when
entitled-but-not-provisioned; the AI Agent tab also has a destructive "Turn
off & release number" card (`ConfirmDialog`-gated) once a number exists.
Voice-only for now (a UK local number can't take SMS) — the SMS agent
stays dark for auto-provisioned gyms until phase 3. The live end-to-end
path is gated on Temple's UK Twilio regulatory bundle (multi-day
approval); see `docs/ai-front-desk-provisioning.md`. pgTAP:
`front_desk_provisioning`.

**Talk to your AI — in-app browser voice calls.** A second, client-side
Vapi integration, distinct from the server-side telephony one above: the
`@vapi-ai/web` SDK opens a live browser call straight to a gym's existing
Vapi assistant using a public key (`EXPO_PUBLIC_VAPI_KEY`, safe client-side,
never confused with the private `VAPI_API_KEY` edge-function secret). No
phone number and no new edge function needed — `lead-agent-voice`'s
`resolveGymByAssistant` fallback already resolves the gym from the
assistant id alone, which is exactly the no-phone-number browser-call case.
The shared `TalkToAssistant` component (`.web.tsx`/native-fallback split,
so `@vapi-ai/web`'s WebRTC internals never reach the native bundle) drives
a ready → connecting → live → ended flow with a live transcript, and
appears in three places: a hero card on the Leads dashboard (docked,
floating over a dimmed pipeline rather than navigating away), the setup
wizard's go-live step (primary action, text-yourself testing demoted to a
secondary link), and the top of the AI Agent tab's AI Front Desk section.
Browser calls flow through the existing `agent_conversations` pipeline
like any other call (upserted under the synthetic `phone='web-test'` row)
so a test is reviewable afterward under Conversations — it just never
creates a lead or touches the pipeline. A gym's first genuine (non-`web-
test`) conversation surfaces a one-time, session-dismissible milestone
banner on the dashboard — derived from `agent_conversations` having
exactly one such row, no new column, matching this codebase's existing
preference (0039) for deriving "first time" state rather than persisting
a flag. The wizard's go-live step also got: a simulated 3-step
provisioning checklist (client-side only — `provision-front-desk` has no
real progress signal to instrument) instead of a bare spinner, "your
progress was saved" copy on a failed-retry so resuming doesn't read as
starting over, and a brand-coloured "You're live" moment with the number
and a copy button before returning to Leads. The former single
"Automation" page is split across two owner-only tabs in the Leads section
sidebar (`/management/leads/settings`, `/management/leads/agent`), both
using `LeadsShell`/`LeadsNav`. **Settings** holds the operational/policy
cards under plain (non-collapsible) section labels — When A Lead Comes In
(assignment strategy + "text the coach too"), Call Recording & Consent,
Usage & Data (usage stats, outcomes, daily message cap, conversation
retention), Data Retention (lead retention window). **AI Agent** holds the
assistant's behaviour and persona: a "Teach it by talking" card leads the
page as a hero (step bar + large icon avatar carrying the call → review →
apply arc, plus a transient "Applied — the agent is live" confirmation),
followed by AI Front Desk (Talk-to-it preview, answer texts/calls toggles,
number provisioning, voice picker) and Knowledge & Coaching (agent notes,
coaching rules), with the destructive "turn off & release number" card in
Danger Zone at the bottom.

### Member import

[`can_manage_staff`] Reachable from Manage → Members → "Bring data
across" → Import members (`/management/members/import`), and surfaced
as an optional checklist step on the setup card. Drop a CSV from a
previous platform (Mindbody, PushPress, Glofox, Wodify or a
spreadsheet). The parser sniffs the delimiter from the header line, so
comma, **semicolon** (EU/UK Excel's default) and tab exports all read
correctly instead of collapsing to one unsplit column; date fields
accept ISO (dash/slash/dot), day- or month-first slash forms, spelled-out
months ("15 Jan 2024", "Jan 15, 2024") and bare Excel serials, and a
surname-first "Smith, John" full-name column is stored natural-order. The
column mapper pre-fills via an AI pass — `infer-import`
in `map_columns` mode reads each column's header plus a privacy-safe
profile (value kind, fill rate, distinct ratio; never raw cell values)
and maps it to a Temple field, falling back to the alias heuristic
(`autoDetect`) when the AI key is unset or the call fails. Mappable
fields cover name/email/DOB, **phone**, a single free-text
**emergency contact** (concatenated when a source export splits it
into separate name/number columns), plan name/start/end, **next bill
date** (the fallback source for `paid_period_end` when plan-end is
blank — the normal case for an ongoing recurring membership), credits
remaining, tags, unsubscribed and notes. The preview counts staged
vs. skipped rows, and commit writes them into `pending_members`. A
trigger on `gym_memberships` insert links the pending row when the
matching email signs up via `/join/<slug>` — applying the imported
plan metadata onto the membership, writing phone onto the profile and
the emergency contact onto the membership, copying tags into
`member_tags`, and propagating "no marketing" into the Comms Suite
`email_unsubscribes` list. The handover screen shows the gym's join
URL + QR, a one-click per-member CSV (email, name, join URL) the
owner can blast from their existing newsletter tool, an opt-in "Send
the welcome email from Temple" button that creates a campaign with
`audience.kind = 'pending_members'` and lands the owner in the editor
to preview before send, and a "Send join invites" button
(`send-member-join-invites` edge function) that immediately emails
every still-`pending` row a branded join-link email and flips it to
`invited` — no campaign editor required. That "N members haven't
signed up yet" summary persists outside the wizard session too: any
time the owner reopens the import screen with unclaimed rows left
over from an earlier import, a banner offers the same one-click send.
A live linking-progress counter ticks up while members sign up.
Plan-name → membership_plan mapping happens in the Review step below
— a CSV plan name that case-insensitively matches a plan the gym
already has is pre-selected to "Map to existing" (flagged "Matched by
name") rather than defaulting to create a duplicate.

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

The `apply_pending_member_data` trigger (extended in 0076, then 0124)
auto-creates a `plan_subscription` on signup when
`pending_members.linked_membership_plan_id` is set: `status='active'`,
`credit_balance` = `imported_credits_remaining` (for credit-based
plans), `paid_period_end` = `imported_plan_end` falling back to
`next_bill_date` when the plan is ongoing (no end date), and
`stripe_subscription_id` `NULL` — Temple billing is bypassed for the
imported continuation so a migrated member can't be double-charged
against whatever their old system still has running. Because there's
no Stripe subscription behind an `imported_legacy` row, it never
receives a webhook to fail a charge or cancel it, so `status` would
otherwise sit at `'active'` forever regardless of `paid_period_end`.
`expire_unbilled_legacy_subscriptions()` (0125), run daily via
`pg_cron`, closes that gap: once `paid_period_end` passes on an
`imported_legacy`, non-`credit_pack` row still at `status='active'`, it
flips to `'lapsed'` — the same terminal-for-booking state a real failed
renewal lands in — so the booking gate then refuses the next booking
with no changes needed there.

**Legacy billing continuation (0124).** A CSV-only import (no adopted
Stripe subscription, see below) is flagged `imported_legacy = true` on
the `plan_subscription` row. The member's `/membership` page renders
this distinctly for recurring plans (`unlimited` / `credit_period` —
one-off credit packs have no renewal to continue): an amber "carried
over from your old gym — not yet billed through Temple" card with an
"Add payment method to continue" button, and the normal switch/cancel
actions are hidden for that row (they'd otherwise hit
`stripe-modify-subscription`'s "not a recurring subscription" error,
since there's no real Stripe subscription behind it yet). The button
calls `stripe-checkout` with the existing `plan_subscriptions.id` as
`legacy_subscription_id`; `stripe-webhook`'s `checkout.session.completed`
handler updates that row in place (and flips `imported_legacy` back to
false) instead of inserting a second row, so the member ends up with
one subscription, now really billed. Staff see a "Not yet billed"
badge next to the plan on the member's profile.

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

### Stripe plan + member import (adopt live subscriptions)

[owner] Reachable from Manage → Plans → "Import plans & members from
Stripe" (`/management/members/import-stripe`), shown once the gym has
connected Stripe. **Plan creation itself is now gated on a connected
Stripe account** — the Plans screen prompts you to connect first (members
are charged on the gym's own connected account), keeping existing plans
editable.

The importer brings a gym's **Stripe plan catalogue and existing
subscribers** across and **adopts live subscriptions** — same billing, no
re-charge, and the member (and owner) manage it in-app afterwards. The
`stripe-import` edge function (owner-gated, read-only) pages both the
connected account's subscriptions (active / trialing / past_due,
email-keyed) **and its active prices (recurring and one-time)**, returning
every distinct price — including ones with **no current subscriber (count
0)** — plus a row per subscriber. Each price carries a `recurring` flag;
**one-time prices map to `credit_pack` plans** (off by default so unrelated
one-off Stripe charges don't become packs), recurring prices to
unlimited / credit_period. The review screen reuses the member-import AI
brain (`runInference`), fed one row per subscriber plus a synthetic row per
zero-subscriber price so every price still gets a name / kind / credit
suggestion; the owner edits them and **ticks which prices and which
members** to import. Commit creates one `membership_plan` per included
price (caching `stripe_price_id`) — so a gym with no subscribers yet can
still import its plan catalogue — and stages the chosen members through
`import_pending_members`, carrying the live
`imported_stripe_subscription_id` / `imported_stripe_customer_id` and the
renewal date. **A plan already imported is reused, never duplicated**: the commit reuses
the existing active plan by `stripe_price_id` first, then by name
(case-insensitive), so two prices that share a name collapse to one plan.
Two partial unique indexes enforce this at the DB regardless of client
races or re-runs — `membership_plans_gym_stripe_price_unique` (0130, one
active plan per `(gym_id, stripe_price_id)`) and
`membership_plans_gym_name_unique` (0131, one active plan per
`(gym_id, lower(btrim(name)))`). The manual Plans editor maps the name
collision to a friendly "a plan named X already exists" message. A
plans-only import (no active subscribers) is a valid success — the plans
are created and no members are staged.

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

**Sequencing + double-bill guard.** Because both importers upsert
`pending_members` on `(gym_id, lower(email))`, the same email in both
merges into one row (Stripe ids fill in / survive) — but a member with a
live Stripe subscription brought in via the **CSV** path lands as unbilled
legacy and would be double-charged if they later add a card. So the CSV
importer now cross-checks each email against the connected account's live
subscribers (via `stripe-import`) and, by default, **skips the overlap**
(owner can override), surfacing it in the preview counts; it also shows an
"Import from Stripe first" banner while Stripe is connected. The
management "Bring data across" hub lists **Import from Stripe** ahead of
the CSV importer. The overlap check only runs for owners (the `stripe-import`
read is owner-gated), and fails open on any error so a Stripe blip never
blocks a CSV import.

**Cross-email fuzzy duplicates.** The overlap guard joins on email, so a
member whose Stripe/CSV emails differ slips past it. `src/lib/import/dedup.ts`
(pure, unit-tested) fuzzy-matches people by normalised name (diacritics
stripped, tolerant of an added middle name/initial) and, where both sides
have one, date of birth. At preview the wizard matches every CSV row —
skipping those already caught by the exact-email overlap — against the
connected account's Stripe subscribers (name-only, since Stripe carries no
DOB → flags a possible double-bill under a second email) and against the
gym's already-staged `pending_members` (name+DOB, so a hit means a second
row for someone already imported). Hits surface in an amber **"possible
duplicates"** callout with a per-row skip toggle. Default is keep, not
drop — a name-only match can be a coincidence, so the owner reviews and
ticks the ones to skip; skipped rows leave the commit and show in the
preview counts.

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
  **Undo/redo** covers every edit (add/remove/reorder, inspector and
  canvas typing, theme swaps, colour + settings tweaks); a run of
  keystrokes coalesces into one step, the history lives above the editor
  so it survives the Preview toggle, and Cmd/Ctrl+Z · Shift+Z · Ctrl+Y
  drive it on web (`src/lib/email/history.ts`).
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

### Email automations

[`can_manage_comms`] Event-triggered emails an owner configures once and the
platform fires unattended, reachable from Comms → Automations
(`/management/communications/automations`). Built on the Comms Suite: the
same block editor + renderer author the email, `comms_audience_rows`
resolves recipients and applies per-topic/blanket suppression, and the gym's
sender identity / sending domain carry the send. Four triggers (0116):
`member_joined` (welcome, N days after joining), `member_first_class`
(follow-up after the earliest attended `class_bookings` row),
`member_inactive` (win-back after N days with no attendance), and `lead_cold`
(nurture a still-cold, consented lead N hours after capture). Each fires only
for anchor events at or after the automation's `created_at`, so enabling one
never blasts the back-catalogue.

An automation can be narrowed to a segment via `email_automations.conditions`
(jsonb, 0118): `plan_ids` gates the member triggers to members on a current
subscription to those plans, `class_type_ids` scopes `member_first_class` to
the first attended class *of those types*, and `lead_source_ids` limits
`lead_cold` to those `lead_sources`. Any key absent or empty = fire for
everyone (the default), so existing automations are unchanged. Owners pick
these in the editor's "Only send to" card; cross-tenant ids are inert because
every predicate is gym-scoped.

An automation can also be a **sequence**: the automation row is the primary
email, and `email_automation_steps` (0119) holds follow-ups, each with its own
`delay_minutes` (measured from the trigger anchor, same clock as the primary),
body, and send-time. The sweep cross-joins the primary + each step per subject
via `_automation_emails`; `email_automation_runs.step_id` records which email a
run is (null = primary, content read from the automation; set = a step, read
from the step). The primary's idempotency key is unchanged (only steps get a
`:step:<id>` segment) so a running automation never re-sends its primary. Each
email also carries optional **send-time** controls (`send_hour` 0-23 +
`send_days` ISO weekdays): `_automation_send_slot` rolls the due moment forward
to the next matching hour/weekday in the gym's timezone, so "3 days after
joining, at 9am on a weekday" is expressible; a null `send_hour` keeps the
send-as-soon-as-due default. Owners add follow-ups and set send-time in the
editor; each follow-up has its own block-designed body.

There is no event bus, so the engine is a `pg_cron` sweep
(`dispatch-email-automations`, every 15 min, 0117): `enqueue_due_automation_runs`
inserts `email_automation_runs` (the ledger + queue, once-only via a unique
`idempotency_key`), then `dispatch_email_automations` best-effort
`net.http_post`s the `send-email-automations` edge worker (URL + secret from
GUCs, skipped when unset — same pattern as the security monitor). The worker
drains queued runs via Resend (per-send idempotency key, live-vs-simulated
gate) and also serves the public one-click unsubscribe link carried in each
email — a member run adds an `email_unsubscribes` row (blanket or per-topic)
via `automation_unsubscribe`; a lead run withdraws consent via
`lead_withdraw_marketing_consent`. Owners get a "Send a test to me"
(`send_automation_test`) and an Enable switch gated on a valid body. The email
body is compiled to HTML on save (no human at fire time). v1 tracks delivery +
unsubscribe; per-recipient open/click analytics are a noted follow-up. Real
unattended sending needs the two GUCs, the worker deployed, and a Resend key;
until then automations enqueue and simulate.

### Website

[`can_manage_website`, owner + admin by default] A public marketing
page per gym, reachable from Manage → Website
(`/management/website`). `gyms.website_builder_enabled` gates every
surface below; since 0153 it defaults to true and is on for all gyms
(it launched as a paid add-on flipped per-gym by Temple staff, so the
column and its RLS checks remain).

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
- **Targets** [`can_set_targets`] — conversion / intro targets per
  month or quarter; the capability and its `gym_insight_targets` table
  still exist, but no screen currently surfaces the editor (dropped
  from Insights, see above).
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
  `subscription_resolution`,
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
  (`gym_role_capabilities` table) and, above that, per individual
  teammate (`gym_member_capabilities` table). Per-person overrides win
  over the role config, so one full-time coach can see revenue and
  issue refunds while a part-timer on the same role gets neither.
  Both editors live on Team (owner-only); `effective_can` resolves
  member override → role override → role default.
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
  data for members who left more than 3 months ago, scheduled via
  pg_cron (`0095`); safe to run manually.
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
  of product tracking. DPIA + lawful-basis register in `docs/legal/`,
  signed off by the director 2026-07-10.

> Still pending (owner config, not engineering): the customer-facing
> legal docs (Terms/Privacy/DPA) carry a DRAFT banner with
> registered-office / effective-date placeholders to fill in, and the
> DPIA's two tracked residual actions — configure the breach-alert
> email (A1) and confirm sub-processor transfer mechanisms (A2).

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
  owner sign-off, and the in-app legal docs carry a DRAFT banner with
  registered-office / effective-date placeholders to fill in. The
  engineering surround (consent gate, erasure, retention sweep + its
  pg_cron schedule, audit log) has shipped.
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
