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
  trend sparklines, the 1RM percentages card (pure arithmetic on their
  own history), journal — minus the leaderboard + Record affordances.
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
  double-book race aborts rather than going negative. When the gym
  closes a range of dates outright, the same refund runs and the member
  is told — in-app and by email — rather than finding the class quietly
  gone.
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

- **Per-gym weight unit** — weights are stored in kilograms and displayed
  in the gym's unit (`gyms.weight_unit`, default `kg`; owner-gated
  `set_gym_weight_unit`, `useGymWeightUnit`, Manage → Settings). Storage
  was unit-tagged and never normalised until 0181: the CSV importer wrote
  `lb` through unconverted while every comparator — `bestOf`, the PR
  badge, both leaderboards, the gym-wide trends — ranked raw numerics, so
  a 315 lb import outranked a 200 kg lift and then suppressed that
  member's own later PRs. The importer still accepts `lb` and converts on
  the way in; existing rows were backfilled, including imports staged in
  `pending_member_workouts.payload` for members who had not signed up yet.
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
- **Percentages of your 1RM** — a card under Rep maxes on the movement
  detail page giving 50–100% in 5% steps, rounded to loadable 2.5 kg.
  A recorded `1rm` always wins; with none, it estimates from the
  member's 3/5/10RM (Epley) and takes the **highest** estimate, saying
  which rep max it came from so the member can judge it. Only for
  movements with a weight scheme, and shown in athlete mode too.
  `resolveOneRepMax` / `percentWeight` (`src/lib/one-rep-max.ts`),
  unit-tested. **Pounds limitation:** `bestOf` compares raw numerics
  and the CSV importer (0072) stores `lb` unconverted, so a movement
  with any non-kg row resolves to "recorded in pounds" and shows no
  numbers rather than contradicting the rep-max row directly above it.
  The real fix is a per-gym weight unit with kg stored canonically,
  which also has to cover the `strength_leaderboard` RPC.

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
- **Per-movement detail page** — rep-max best-of, the 1RM percentages
  card, full history merging direct PRs with section-tagged results,
  "session" badge.
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
  due, classes attended-but-not-logged, open staff alerts, unread lead
  notifications, and unread cover notifications. `useNotificationCount`
  (`src/lib/notifications.ts`). In-app only — there is no push anywhere
  in the app. Two of the sources (leads, cover) also send email, via
  their own queue tables and edge workers rather than through the badge.
- **Post-workout log nudge** — after a class you were marked in for
  (`class_bookings.attended_at`) with nothing logged that day, the Track
  home and the Inbox show a "log your results" prompt; on Track it opens
  the recorder pre-filled for that session (`useLogNudge`). Day-grained,
  so any log that day clears it.

### Programming
- **Programming view** — read-only calendar of what's been programmed
  each day; the same surface the recorder pre-fills from. Scoped to the
  gym, not to the member's own bookings or plan: `class_programming`'s
  select policy is a plain `user_belongs_to(gym_id)`, so anyone in the
  gym sees every class type's programming.
- **Percentage chips** — a section reading "Back squat 5×5 @ 75%"
  gains a `75% · 75 kg` chip underneath, resolved against the viewer's
  own rep maxes; tapping shows the provenance. Bodies are free text, so
  `findPrescriptions` (`src/lib/percent-prescription.ts`, unit-tested
  against the real demo bodies) recovers the grammar
  `<work> @ <pct>% [of <reference>]` — the reference comes *after* the
  percentage, so "4x3 clean pull @ 90% of clean" is 90% of the clean.
  A wrong number on a barbell being worse than none, it renders nothing
  for a percentage of a session max ("70% of today's 1"), of a non-load
  quantity ("90% effort", "70% max HR"), or of a movement it can't pin
  down. Bare family words ("clean", "squat") prompt **once** — the
  answer is stored per profile in `member_movement_preferences` (0168,
  no `gym_id`, self-only RLS, like movement favourites) and reused
  everywhere that word appears again. Rep maxes are fetched once per
  member (`useMyRepMaxes`), not per section or per day, so stepping
  through days never refetches. Gated on an explicit
  `showMyPercentages` prop set only by the member programming tab —
  the staff surfaces share the calendar component, and the viewer
  there is a coach.
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

### Timeline
- **The staff home** (`/timeline`, first pill in the staff nav; staff
  sign-in lands here) — one chronological stream per gym of what already
  happens, read-only (docs/roadmap.md phase 1, 0204). The
  `timeline_feed` RPC unions members joining, leads captured (plan-assign
  gate), failing payments (`can_see_money`), cover asked/claimed (cover
  gate), closures, and pending membership change requests — per-kind
  capability gating inside the function, tenancy checked against
  `can_access_staff_area`. `cron_run_log` stays out: no gym dimension.
- **One register** — every owner-visible sentence comes from
  `formatTimelineLine` (`src/lib/timeline.ts`, pure + unit-tested):
  one idea per line, first person only where Temple itself acted, no
  system vocabulary; amber dots mark live problems (a failing payment, a
  pending request). Day groups (Today / Yesterday / weekday), oldest at
  the top, like a conversation.
- **Questions decided in place** — pending membership requests render as
  the stream's only cards: one question, exactly two choices with the
  yes labelled by the action ("Yes, move Marcus"), member note behind
  "See the details", decided through the existing
  `stripe-modify-subscription` path (`useDecideChangeRequest`) — the
  standalone queue screen is unchanged underneath.
- **The talk bar** (owner only; roadmap phases 3+4) — a sentence becomes
  a change. One dispatch path, and only one: `parse-setup`'s `change`
  step names an action from the registry and fills its arguments, the
  Timeline sanitises them with that action's own sanitiser, previews it,
  and applies it on Yes. The screen holds no knowledge of any module —
  no per-verb branch, one card kind, one confirm handler. A sentence the
  registry doesn't cover gets a fixed "not from here yet" reply, never a
  guess. One sentence resolves to one action; sequencing several from one
  sentence is roadmap phase 3, where the order between them has to mean
  something.
- **The action registry** (`src/lib/actions/`) — the bar's verbs were
  hand-built: a field on the tool schema, a sanitiser, a resolver, a card
  and an apply path, per verb. That reaches five things, not a platform.
  An action now declares itself once — `name`, `kind` (`do` | `ask`),
  `capability`, `says` (when it's the right one, written as an owner
  would say it), typed `args`, `sanitise`, `preview`, `apply`,
  `invalidate` (which cached queries its write makes stale) — and
  everything else derives. `parse-setup` holds no vocabulary of its own:
  the client filters the catalogue through `useCanFn` and sends only what
  this person may do, so the tool's action enum, the argument shapes and
  the value conventions are built per call and the model is never told
  about an action it couldn't perform. Dispatch is one branch in the
  Timeline and one card: a `do` gets the two-choice confirm (labelled by
  the action — "Yes, close it") and a receipt, an `ask` renders as the
  answer. Two escapes from title-and-lines, both earned by moving real
  verbs across rather than guessed in advance: a preview may name a
  `card` the feed renders and hand it `data` (a member is a face and a
  standing, not two lines of prose), and it may return `choices` instead
  of an answer — one chip per candidate, each re-running the same action
  with the ambiguity settled. Both are generic. An `apply` that throws
  `ActionError` has its message shown as written; anything else is
  plumbing and gets the feed's own words. The capability filter is a
  convenience for the model, never the authorisation — the write still
  runs in the owner's session against RLS. Shared arg readers (`argMoney`
  takes 1, "1", "1.50", "£1.50" and refuses a third decimal rather than
  rounding someone's price; `argInt`, `argString`, `argEnum`) mean model
  output is re-validated per action. **Adding an action to the bar is
  adding one entry, and touches no screen.** Tests pin the registry's own
  invariants: unique dotted names, unique arg names per action, every arg
  described, every `do` has an `apply` and no `ask` does, `actionsFor`
  refuses on both `false` and `undefined` (not-yet-loaded is not
  permission), and every verb the bar answers to is present.
- **The modules on it** — `gym.ts` (`gym.change_rules`,
  `gym.add_classes`, `gym.add_plans`, `gym.close_dates`,
  `comms.draft_newsletter`), `classes.ts` (`classes.edit`), `members.ts`
  (`members.find`) and `store.ts`. Each spec reads what it needs through
  its context rather than being handed it, which costs a query per
  preview and buys the property that matters: an action works wherever
  the registry is dispatched from. Two of them re-resolve on both sides
  — a rule change filters no-ops against the live settings in preview
  *and* in apply, and a class edit re-finds its sessions before writing —
  so a card left open can't act on a gym that has since moved.
- **The store, as things you can say** (first registry module) —
  `store.add_product` ("add a water bottle for £1", "sell hoodies at £35,
  we have 20", "add the technique guide as a £12 download" — a download
  goes up hidden, since a digital product with no file attached would be
  a broken purchase), `store.set_price` ("make the water bottle £2" —
  resolves the product by what the owner called it, refuses to choose
  between two that both answer to "bottle", and drops the cached Stripe
  price id on a recurring product so new subscribers don't sign up at the
  old rate), and `store.sales` ("what are sales like in the store") over
  `store_revenue_summary` + `list_store_products`. All three write and
  read exactly what the store screen does.
- **Changing classes that already exist** — "cap Saturdays at 20", "move
  the Tuesday 6am half an hour later", "make Wednesday spin 45 minutes".
  `classes.edit` names the target (weekday list, class type, optional
  date range) and the change (capacity / duration / shift);
  `sanitiseClassEdit` (`src/lib/chat-lookup.ts`, pure + tested) re-checks
  every field against the bulk editor's own bounds and drops a request
  that changes nothing. The action resolves the actual sessions in the
  owner's session, previews them (`describeBulkEdit` + three real
  classes + the count), and confirming re-resolves and calls
  `bulk_edit_sessions` with explicit session ids — so the receipt is that
  RPC's own counters
  (`describeBulkEditResult`): what changed, what was left alone because
  more members are booked than the new capacity, what clashed, who was
  told. An open-ended request is capped at twelve weeks and the card says
  so before anyone confirms.
- **Asking about a member** — "show me Marcus", "what's Sarah on". The
  bar's first *read*, and the registry's only `ask` that isn't prose:
  `members.find` takes the name as said and matches it against the gym's
  own cohort (`matchMembers` — ranked, so an exact first or last name
  answers outright and a fragment comes back as `choices`, one chip per
  candidate, each re-running the action with the person's id instead of
  guessing), and one match renders a member card: status (`memberStatus` — lapsed / expiring in N days /
  on an intro / active / none), plan and price, credits, comps, a failed
  payment with its past-due date, tags, and the full profile a tap
  behind. A summary, not the profile — and deliberately no health or
  injury data, which stays behind the audited surfaces. Every read runs
  in the owner's own session under RLS, so the bar sees exactly what the
  screens see; each supporting fact is best-effort, so a staff member
  whose capabilities don't stretch to plans or tags gets a card without
  them rather than an error.
- **Putting a member on a plan** (0211, roadmap phase 2) — the first
  staff-side membership write Temple has ever had. `can_assign_plan` was
  sold to owners as "Put members onto plans and adjust subscriptions"
  since 0020 and nothing could do it: members self-served through Stripe,
  comp grants were displayed and never issued, and the only staff-side
  membership mutations were approving a member's own change request and
  refunding. `members.assign_plan` ("put Marcus on Unlimited", "give Dan
  the ten-class pack until the end of March") is a **continuation**, not a
  new signup — the same semantics the CSV importer has always produced:
  `status active`, no Stripe subscription, `imported_legacy` set, so the
  member can book immediately, no money moves, and their own membership
  screen later adopts *that row* through the existing `stripe-checkout`
  legacy branch rather than opening a second one. Already on something?
  The card names what they're on and offers two `choices` chips — move
  them, or add it as well — because a programming add-on alongside classes
  is a real second membership and guessing either way is wrong. Not yet
  claimed their account? It earmarks
  `pending_members.linked_membership_plan_id` instead, and the existing
  claim trigger lands the membership when they sign up. Card-billed
  members are **refused in words**: swapping the row behind Stripe's back
  would bill the old price forever, so that path stays with
  `stripe-modify-subscription`. How long it runs follows the plan's own
  shape — `period_length` where there is one, a month where there isn't,
  and no end date for a `credit_pack` because its credits are the limit,
  which is also why 0125's nightly lapse sweep already excludes packs.
  Four traps the migration's header documents because each is laid by
  existing code: the row must be **entitling**, never staged, because
  `_book_class_for`'s require-membership gate (0103:198-204) tests for the
  mere *existence* of a subscription row with no status filter, so a
  'pending' placeholder would permanently stop that member self-booking;
  `price_cents` must be written explicitly on a switch because its
  snapshot trigger is INSERT-only; the gate is `effective_can`, not
  `user_can_assign_plan` (raw role, no `left_at` guard); and the plan is
  validated against the gym, which `apply_pending_member_data` and
  `import_pending_members` do not do. pgTAP (`assign_member_plan.sql`,
  plan(29)) proves the assigned member can actually **book a class** —
  reading the columns back is not enough — and that a switch moves the
  price with the plan.
- **Comping, at last** — `members.comp` ("comp Sarah for a month", "give
  Dan 5 free classes", "put Jo on us for two weeks while she's injured")
  over `grant_member_comp`. `comp_grants` has existed since 0009 with
  nothing able to create one. It also settles a disagreement rather than
  inheriting it: the capability says owner + admin + coach but the only
  enforcement was `user_can_issue_comp_grant`, raw role owner|coach, so an
  admin with the capability ticked was refused by RLS — the RPC goes
  through `effective_can` so the capability means what the Team screen
  says. A comp with no credit count is unmetered inside its window; the
  card says up front that comping relabels them "On an intro" on the
  roster (`v_member_cohort.is_intro` is `has_live_comp and not
  is_paying`), because that is better said than discovered.
- **Tagging and messaging one member** — `members.tag` and
  `members.message` wrap writes that already existed as client inserts
  under RLS. The tag write checks for an existing label first rather than
  using `ON CONFLICT`: the unique index is case-*sensitive*
  `(gym_id, profile_id, label)` and 0047 exists because someone used
  `lower(label)` as the arbiter and turned the whole pgTAP suite red. The
  card notes that tag rules and any automation watching that tag pick it
  up on the next sweep, so a tag is not always a private note.
- **What the gym took** (roadmap phase 2) — `money.summary` ("what did we
  take last month", "how much came in last week", "what are we making")
  over `compute_revenue_summary` + `store_revenue_summary`, the same two
  RPCs the Money screen calls, plus a live join on
  `plan_subscription_dunning`. Three things, because an owner asking how
  the month went means all three: memberships, shop, and what is failing
  *right now* — a revenue figure with a broken direct debit behind it is
  a half-answer. Per currency throughout: both RPCs group by currency and
  adding two together produces a number that is not money in any
  currency. Both ends of a period or neither (`from` with no `to` falls
  back to 30 days rather than silently pairing a stated start with
  today), and the period is read back in words so the number is never
  floating free of what it counts.
- **What a plan costs** (0215, roadmap phase 2) — `money.set_plan_price`
  ("put Unlimited up to £60", "drop off-peak to £35"). The card's real
  content is the sentence about who *doesn't* pay the new price: members
  already on the plan keep their `plan_subscriptions.price_cents`
  snapshot, and the card says how many that is. The migration behind it
  fixes a bug that was invisible in the app and only visible in Stripe:
  `membership_plans.stripe_price_id` caches a Stripe Price minted at the
  first checkout, and nothing cleared it when the price changed — so an
  owner who put Unlimited up to £60 kept *selling* it at £50, with the
  plans screen, the website and Checkout all disagreeing and no surface
  saying so. A `before update` trigger clears the cache when
  `monthly_price_cents` moves and leaves it alone when the caller sets
  both (that write is the checkout filling it in). Same migration makes
  `can_manage_plans` real: the Team screen has offered "Create / edit /
  archive membership plans" per-role since 0020 while the table's RLS
  asked `user_is_owner_of`, so a granted admin was told yes by the screen
  and no by the database — the third of these found (`can_assign_plan`
  0211, `can_issue_override` 0213). Policies now ask `effective_can`,
  which is identical for a gym that granted nothing and stricter besides
  (it requires `left_at is null`). pgTAP `plan_price_changes.sql`
  (plan(11)) pins both halves, including the same admin refused before
  the grant and allowed after it.
- **Giving money back** (roadmap phase 2) — `money.refund` ("refund
  Marcus", "give Dan £20 back"), the only verb in the registry that moves
  money out of the gym's account. "Refund Marcus" is four different
  refunds — the unused part, all of it with access ending now, all of it
  with access running to the period end, or the money back with the
  membership untouched — differing by tens of pounds and by whether he
  can train tomorrow, so the mode is **not in the vocabulary the parser
  sees**: only the card's chips can send it, and each chip carries its own
  computed amount. A pro-rata that comes to £0 is dropped rather than
  offered, because refunding nothing while ending someone's access is not
  a refund. The maths is `src/lib/refunds.ts`, the same module the refund
  dialog previews with; `stripe-refund` recomputes server-side and this
  path adds no trust. The confirm says the refund does **not** come off
  revenue (`is_revenue_event` excludes `kind='refund'`, 0019) because an
  owner who expects the summary to drop will otherwise think it failed,
  and it distinguishes "I cannot see the payments on this account" from
  "they never paid" — `billing_events` SELECT is gated on `can_see_money`
  while `can_refund` is independent, so a coach who may refund but may
  not see revenue reads nothing and needs to be told which.
- **Four checks that named one thing and tested another** (0216) — found
  while wiring the money verbs, none of them new, all reachable long
  before the chat existed. **A former member could never drop in again**:
  `_book_class_for`'s "already holds a plan here" guard was an EXISTS with
  no status filter, so a gym that allows drop-ins refused anyone who had
  once paid and cancelled, while a stranger with no history walked in. The
  right predicate was already in the database and had been since 0015 —
  `is_terminal_subscription_status`, whose complement is exactly the app's
  own `CURRENT_SUB_STATUSES`. What the guard is actually for, no free
  booking past your credits, is untouched: a credit plan at zero balance
  is still `active` and `active` is not terminal. **`pending_members`
  could point at another gym's plan**: both plan columns are plain FKs to
  `membership_plans(plan_id)` with no gym constraint, and neither reader
  checked — `apply_pending_member_data` looks the plan up by id alone and
  creates a `plan_subscriptions` row for *this* gym carrying *that* gym's
  plan, and `my_agreed_plan` (security definer) shows a member the other
  gym's plan name. A trigger now refuses it on both columns whatever the
  path, existing mismatches are cleared, and `my_agreed_plan` joins on the
  gym as well. Not a composite foreign key, which is the obvious answer:
  its `ON DELETE SET NULL` would have to null `gym_id` too, and `gym_id`
  is NOT NULL, so deleting a plan would fail instead of clearing the link.
  **And the write grant on `pending_members` named no column**, which is
  the 0195 argument on a table 0195 missed: the update policy asks
  `effective_can(gym_id, 'can_manage_staff')` and nothing about *which*
  field, so a staff account could PATCH `imported_stripe_subscription_id`
  — the column the claim trigger copies onto a real subscription row —
  straight through PostgREST. INSERT is revoked outright (every staging
  path in the app is a definer RPC) and UPDATE is now column-level, listing
  the thirteen fields the imported-member screen actually edits. pgTAP
  `tenancy_and_entitlement_checks.sql` (plan(12)) covers all four, and
  `client_writes_match_code.sql` grew the standing privilege assertions.
- **Refunds are recorded in the currency they were taken in** — the
  refund edge function wrote `currency: 'GBP'` on every `billing_events`
  row it created and formatted the member's email with a hard-coded pound
  sign, regardless of what the original charge was in. It now reads the
  currency off the charge being refunded, records it, formats with it, and
  returns it so the chat receipt agrees.
- **The parser's gate widened** — `parse-setup` checked
  `effective_can(gym, 'can_edit_classes')` for every call, which locked
  staff out of actions they were explicitly granted (the shop, assigning
  a plan). It now checks `can_access_staff_area`: the function holds no
  write power and reveals nothing the caller didn't type, the per-action
  authorisation is the capability-filtered catalogue plus RLS on the write
  itself, and gating a whole registry on one feature's capability was the
  wrong shape.
- **A newsletter is a sentence** (roadmap phase 6) — "send a newsletter
  — Christmas hours and the new barbell club" drafts subject + sections
  in the same `parse-setup` call (`comms.draft_newsletter`, whose own
  argument description forbids invented dates/prices/names — only the
  owner's stated facts). `sanitiseNewsletter` + `newsletterDocument`
  (`src/lib/newsletter-draft.ts`, pure + tested) turn the surviving
  draft into the comms suite's own block document; "Yes, draft it"
  inserts an ordinary draft `email_campaigns` row (brand palette, logo,
  `DEFAULT_AUDIENCE`) and opens the existing editor — audience, topic,
  A/B, suppression and one-click unsubscribe all unchanged. The send
  button remains the approval; nothing sends from the bar.
- **"Send invites" now sends invites** (0218) — the fifth capability
  mismatch and the only one that *widened* access, which is why it was the
  owner's decision rather than a reading of a label. Two switches sit next
  to each other on the Team screen: `can_invite` ("Email invites to new
  members and staff") and `can_manage_staff`. The invite box on the
  Members screen shows itself on `can_invite`; `create_invite` asked for
  `can_manage_staff`. Both default to owner and admin, so nothing looked
  wrong until an owner turned "Send invites" on for coaches — the only
  situation the switch exists for — at which point the coach saw the box,
  typed an address, and the database refused. The gate is now `can_invite`.
  **The owner-only ladder does not move**: minting an owner or an admin
  stays owner-only, structurally, regardless of any capability, because it
  is now the only thing between the widened gate and a coach granting
  themselves admin. pgTAP `send_invites_means_send_invites.sql` (plan(10))
  spends six of its ten assertions on what did *not* widen, including that
  handing the coach every staff capability an owner could give them still
  does not open the ladder.
- **The conversation survives a refresh** (0221, roadmap step 3) — the
  bar's memory has been real but weightless: turns lived in React state,
  so a reload emptied it, a card left open vanished, and the Timeline had
  no past. `chat_turns` is deliberately small — who said it, what they
  said, when, and which member it was about if any. No card payloads and
  no action arguments: turns restore as words and never as cards, because
  a preview is a snapshot of a gym that has since moved and re-offering
  its confirm would ask somebody to agree to a world that no longer
  exists. **Restoring does not weaken the freshness rule** — `recentTurns`
  still drops anything past ten minutes before it is sent, so reopening
  tomorrow and saying "put him on Unlimited" fails to understand rather
  than resolving to yesterday's Marcus, which is the whole point of that
  bound and is now pinned by its own test. Three privacy properties, this
  being the first table in Temple that records what staff *asked* rather
  than what they did: you read your own and not the gym's; ninety days
  then purged, on the same cron shape as `purge_expired_leads`; and
  erasing a member deletes the turns naming them, added inside
  `_erase_member_health_data` because that is the path `leave_gym`, the
  self-serve withdraw and the retention sweep all already call. It
  deliberately does **not** write to `health_data_access_log` — that is a
  GDPR Article 9 trail, the bar's member card carries no health data by
  design, and a false entry in an audit whose value is being exactly true
  is worse than no entry.
- **The scaffolding around the programming** (0219, roadmap step 2) —
  `programming.block_out`, `move_block` and `drop_block` for the year plan
  ("Open prep runs 6 January to 15 March"), `programming.set_access` and
  `who_is_programmed` for who is on individual programming and what it
  costs them, and `plans.include_programming` for whether a plan carries
  it. Every card states the thing its screen never has to: a block is
  gym-wide and cannot be scoped to a class type; a block laid over another
  becomes the one every coach's week strip shows, because `blockForDate`
  breaks ties on the latest start; moving or dropping a block moves the
  label and not the programming, which lives in `class_programming` keyed
  on `(class_type_id, date)` with no relationship to a block at all;
  switching a member to paid **takes away access they have today**,
  because with no row at all a member is free by default; and a plan that
  includes programming grants it regardless. `who_is_programmed` sorts on
  days-written-ahead rather than name, so the answer is who runs out
  first — the question behind the question, which the list screen has
  never been able to answer. **The craft line held.** Nothing here writes a
  workout, and the three verbs that would have — copy a week forward,
  clear a day, put a WOD on the leaderboard — are deliberately absent:
  each is a wholesale replace of a `sections` array whose honest preview
  would have to render the coach-written content it is about to
  overwrite. That is a card renderer, not an argument list.
- **Three more gates that named one thing and tested another** (0219) —
  sixth, seventh and eighth of the class. `class_programming` and
  `programming_blocks` gated on `user_can_manage_classes` while the
  programming screen reads `can_edit_classes`; `coach_tasks` (three
  policies plus `complete_task` and `reopen_task`) gated on
  `user_can_admin_or_coach` while the tasks screen reads
  `can_manage_tasks`. Both helpers are raw role tests that ignore every
  override and have no `left_at` guard, so somebody who had left the gym
  kept writing its programming. The blocks table moved select *and* write
  together on purpose — a gate that lets somebody write a block they
  cannot then read is worse than either gate alone. The assignee-self
  branch in both task RPCs is untouched: ticking off your own task has
  never needed a capability. **And one asymmetry of my own making**:
  0215 moved `membership_plans` to `effective_can(can_manage_plans)` and
  left `plan_class_types` on `user_is_owner_of`, so a non-owner granted
  the capability who switched a plan to programming-only got a successful
  plan UPDATE and a class-type DELETE that removed nothing and reported
  nothing — a row-filtered DELETE returns 204 with `error === null`. The
  plan ended up programming-only while still carrying class types.
- **The website only shows what you chose** (0220) — hiding a plan from
  your website hid it from the page and not from the server.
  `hiddenPlanIds` was honoured only in the renderer while
  `gym_public_plans` returned every unarchived plan for a published site,
  and the anon key is embedded in that rendered page — so the name, kind,
  credit count and price of a plan an owner had deliberately taken off
  their site were one request away from any visitor. 0158 had already
  solved exactly this for hidden team members; this is that solution
  applied to the sibling it missed, same `jsonb_path_query` exclusion over
  the same `coalesce(published_design, design)`. Two more in the same
  migration: `gym_websites` still took a bare client UPDATE, which could
  set `published = true` without ever writing `published_design` — the
  public site serving a snapshot that was never taken — so the grant is
  revoked and the policy that guarded it went with it; and the website
  asset storage policies checked capability, bucket and folder but not
  whether the gym had the builder at all, nor `left_at`.
- **The team, and the labels that sort the members** (roadmap step 2) —
  `team.invite` ("invite Sam as a coach, sam@example.com") over the
  existing `send-invite` function, so the code is still minted as the
  caller and `create_invite`'s owner-only ladder still applies; the card
  warns about that ladder before an admin tries to invite an admin, and
  the receipt distinguishes "sent" from "the invite is ready but email
  sending is not set up" because the second is not a failure. `team.who`
  reads the roster back grouped by role. `tags.add_rule` is the other half
  of `members.tag`: that one labels a person, this one describes a kind of
  person — ten of the tag editor's twelve predicates, with the two that
  need a class type left off the enum rather than half-supported, so a
  sentence about one falls through to "not from here yet" instead of into
  a failing insert. The sanitiser mirrors the table's own CHECK
  (`no_recent_attendance` and `joined_within` need a number, `on_plan`
  needs a plan, and a number or plan supplied alongside a predicate that
  takes neither is dropped), so a rule the database would reject never
  becomes a confirm card. The rule is applied immediately via
  `apply_tag_rules` rather than waiting for the nightly sweep, so the
  receipt says how many it caught. **Not offered, because there is no
  write:** changing a role and removing somebody from the team — see the
  roadmap's known list.
- **The people who haven't joined yet** (0217, roadmap step 2) — the
  pipeline is the one board in Temple that is genuinely a queue of small
  decisions, and every card on it is one sentence of news whose only home
  was a form. `leads.add` ("someone rang, Sarah Jones, 07700 900123, found
  us on Instagram" — matching an existing enquiry first, because someone
  who rang twice is one person and not two rows), `leads.set_status`
  ("Sarah's booked her intro", "we lost Marcus"),
  `leads.assign` ("give Priya to Marcus") and `leads.pipeline` — the board
  as an answer, which surfaces the thing a board is worst at: who has been
  sitting untouched for more than two days. Nothing underneath changes;
  assignment rules still fire on capture, the notification queue still
  goes out, and the AI front desk works the same rows. `converted` is
  deliberately not a status the bar can set — `set_lead_status` refuses it
  without a member profile because a conversion is a link to a real
  account rather than a label, and a verb that could only ever fail is
  worse than no verb.
- **…and the pipeline honours its own switch** (0217) — fourth instance of
  the same class, and the last one on this capability. The leads screen
  gates on `useCan('can_assign_plan')`; all five RPCs behind it gated on
  `user_can_assign_plan`, a raw role test (owner/admin/coach/staff) that
  is not the capability at all. For a gym that has overridden nothing the
  two agree exactly — the capability's defaults are the same four roles —
  so the differences are the two that matter: an owner's override did
  nothing (turn "Assign plans" off for coaches and the board disappears
  from their screen while every write behind it still succeeds), and the
  raw helper has no `left_at` guard, so somebody who has left the gym kept
  write access to the names, emails and phone numbers of people who never
  joined. `record_lead`, `set_lead_status`, `set_lead_assignee`,
  `nudge_lead` and `clear_lead_follow_up` now ask `effective_can`. pgTAP
  `lead_pipeline_capability.sql` (plan(9)) proves the coach is allowed by
  default, refused once the switch is turned off, that the owner is never
  overridable, and that leaving the gym takes the pipeline with it.
- **A newsletter knows who it is for** (roadmap phase 6/step 2) — the
  newsletter has been a sentence since phase 6 and always drafted to
  `all_members`, so "tell the lapsed lot we miss them" produced a campaign
  addressed to everyone and the owner went to the screen to fix it, which
  was most of the work the sentence removed. `comms.draft_newsletter` now
  takes `tags` and `cohorts` and the card leads with who it goes to and
  how many that is (`comms_audience_count`, the same RPC the campaign
  screen's live count uses). Tags are matched case-insensitively against
  the gym's real labels, and a tag nobody has **does not fall back to
  everybody** — falling back would mail the whole gym because one word was
  misheard, so the audience stays empty and the card says "no tag here
  called X — nobody would get this". Naming a tag beats naming a cohort,
  because a tag is the more specific thing to have said. The audience is
  re-resolved on Yes rather than carried from the preview.
- **A sequence is described, not built** (roadmap step 2) —
  `comms.describe_sequence` ("when someone joins, welcome them and check
  in after a week", "email members who have not been in for a month",
  "when I tag someone VIP, send them the members' guide") over the
  automations engine (0116–0201) exactly as it stands: five triggers,
  per-email delays measured from the anchor, the comms suite's sending
  identity, topic suppression, unsubscribe. `sanitiseSequence` +
  `primaryRow` + `stepRows` (`src/lib/sequence-draft.ts`, pure + tested)
  are the untrusted-output boundary and the mapping — the first email
  becomes the automation row (0119's "the automation row stays the PRIMARY
  email"), the rest become `email_automation_steps`. **It lands switched
  off and the card says so**: this is the first thing the bar drafts that
  keeps running after the conversation ends, so describing a program is
  drafting it and turning it on stays a human act — the same rule as the
  newsletter's send button. Two traps the module encodes: for
  `member_inactive` and `lead_cold` the wait *is* the trigger
  (`knobToStorage` pins `delay_minutes` to 0 and puts the number in
  `params`), so a primary email claiming to go "14 days after" would have
  fired at the threshold instead — the number is read as the threshold;
  and a `member_tagged` sequence with no tag is refused outright rather
  than created, because it would match nobody for ever while looking like
  it worked. The card also refuses a tag no member actually holds.
- **The lead pipeline has its own switch** (roadmap step 2) —
  `can_work_leads` ("Work the enquiries: see and work the front desk
  pipeline — take enquiries, assign them, follow them up"), added in 0226
  and defaulting to exactly who held `can_assign_plan`: admin, coach and
  front desk, with owner true by short-circuit. The whole front desk used
  to run on `can_assign_plan`, which the Team screen describes as "put
  members onto plans and adjust subscriptions" — so an owner who wanted a
  coach on the phones had to hand them membership billing to do it, and
  one who wanted them off billing lost them the phones. Nothing changes on
  day one; from day two the two switches move apart.
  The half that fixes a live bug: nine policies across seven tables
  (`leads`, `lead_sources`, `lead_assignment_rules`, `lead_notifications`,
  `agent_conversations`, `agent_messages`, `gym_agent_settings`) still
  read `user_can_assign_plan` — the raw-role helper with no `left_at`
  guard and no override lookup. 0217 made the pipeline's *writes* honour
  the switch while its *reads* ignored it, so a coach whose switch an
  owner had turned off could still read every name, email and phone number
  in it, and somebody who left in March could read them in July. All nine
  now read `effective_can(gym_id, 'can_work_leads')`.
  `plan_subscriptions`, `comp_grants` and `membership_change_requests`
  keep `can_assign_plan` — membership machinery, where it is the only key
  it should ever have been.
- **One sentence, several actions** (roadmap step 4) — the talk bar's
  parser now emits `steps` rather than a single action, capped at three,
  so "put Marcus on Unlimited and tag him VIP" is one sentence. They are
  previewed together under one confirm, each step keeping its own title
  and evidence — collapsing them into "do 3 things?" would be asking
  somebody to approve a number. `travelTogether` (`src/lib/chain.ts`,
  pure + tested) is the rule: **every step must be a write that came back
  with something to confirm.** A step that resolved to a clarifying
  question cannot be agreed to in advance alongside something else, and a
  step whose sanitiser refused leaves the sentence with its middle
  missing; either way the chain collapses to its first step and the bar
  names how many were left. **On failure it stops and says exactly
  where** — no transaction, no rollback, no silent retry. These are
  separate writes across separate tables and some have already left the
  building (an email sent, Stripe having moved money), so the receipt
  carries what did happen and the line after it says nothing further was
  tried. The client and the edge function deploy separately, so the client
  also reads the older single-`action` shape for the minute between the
  two.
- **A shop order can be refunded** (roadmap step 2) —
  `store.refund_order` ("refund Marcus's hoodie", "give Sarah her money
  back for the water bottle") over a new `refund-store-order` edge
  function and `_refund_store_order` (0225). `store_orders` has carried a
  `refunded` status since the shop was built and nothing ever wrote it —
  no screen, no RPC, no function — so the only way to refund a shop
  purchase was the Stripe dashboard, and the order stayed `paid` in Temple
  for ever. Same shape as the membership refund: Stripe on the gym's
  connected account, the amount recomputed server-side rather than trusted
  from the request, gated on the same `can_refund` capability. Stripe
  moves the money first and the RPC runs after, because the other order
  leaves an order claiming a refund that never happened.
  Three decisions Stripe knows nothing about, all stated on the card:
  **stock comes back only if nothing shipped** (`_mark_store_order_paid`
  decrements it at purchase, so an unfulfilled order's goods are still on
  the shelf and a posted one's are not); **a digital delivery is revoked**
  — the select policy now requires `revoked_at is null`, so the download
  stops working, while what was already downloaded is gone and the card
  says so rather than implying otherwise; and **a partial refund still
  ends the order**, because a `partly_refunded` status would spread
  through every surface that reads status, and the amount belongs on the
  `billing_events` row (`kind = 'refund'`, excluded from revenue by
  `is_revenue_event`) where the money already lives.
- **Every class surface is on the gym's clock** — `classes.move` wrote
  its new time in `gyms.timezone` while `findClass` read "Friday's 7pm"
  through `Intl.DateTimeFormat().resolvedOptions().timeZone`, so the two
  halves of one sentence ran on different clocks for anybody who
  travelled. Six device-clock reads are gone: the three registry ones
  (`classes.edit`'s window, `findClass`, and `gym.add_classes`'s
  `applyTimetable`, which was creating a 6am class at 4am if you set the
  timetable up from abroad) plus the class-types editor, the create-class
  modal and `/setup`'s timetable step, all of which now read
  `useGymOperatingDefaults().timezone`.
  A second bug in the same family went with it: `new
  Date().toISOString().slice(0, 10)` is **today in UTC**, which is a
  different day from the gym's for part of every day — half past midnight
  in London is still yesterday in UTC — so "tomorrow's 6am" could resolve
  against a day nobody named. `todayIn(tz, now)` (`src/lib/send-time.ts`,
  pure + tested) replaces it, and the time filter that matched "07:00"
  against a device-rendered clock string now formats in the gym's zone
  too. Two vitest guards grep the registry for both patterns, because the
  failure is invisible in the common case and only bites the one person
  who left the country.
- **What actually happened to the email** (0229) — the report screen said
  "Delivered" from the day it was built and never meant it: the figure was
  the count Resend's API accepted, which is a promise to try. Three
  columns and three event kinds had sat unwritten since 0044 —
  `delivered_at`, status `bounced`, and the `delivered`/`bounce`/
  `complaint` event kinds — because the provider webhook they were built
  for was never stood up. **Bounce rate was structurally zero**, and
  "received" was really "opened".
  **The listener:** `resend-webhook`, verifying the Standard Webhooks
  (Svix) signature over `${id}.${timestamp}.${body}` against
  `RESEND_WEBHOOK_SECRET`, with a five-minute replay window and no
  unsigned path at all — an endpoint anyone could post to would let a
  stranger mark any address bounced and stop a gym's mail. It consumes
  `email.delivered`, `email.bounced` and `email.complained` and hands each
  to `comms_apply_delivery_event`, a service-role-only RPC that finds the
  recipient by `provider_message_id` — which is why it takes no gym id and
  a forged payload cannot aim at another tenant.
  **Three definitions, one function.** `comms_campaign_stats` now returns
  `sent` (what left, bounces included), `delivered` (what a mailbox took),
  and `successful` (delivered and not bounced) separately, plus
  `complained`, `skipped` and a `tracked` flag. Engagement reads against
  what arrived rather than what left, so a bad address list stops looking
  like writing nobody liked.
  **A hard bounce suppresses the address**, into `email_suppressions` —
  deliberately not `email_unsubscribes`, because "we cannot reach you" and
  "you asked us to stop" are different facts with different remedies, and
  collapsing them would show a typo on the member's own preferences screen
  as an opt-out. Subtracted inside `comms_audience_rows`, so the count an
  owner sees before pressing send is the number who will be mailed. A
  transient bounce is recorded and nothing more. A complaint outranks a
  bounce on the same address. Staff can clear one from Communications →
  Settings when the typo is fixed.
  **Unmeasured is not zero.** `delivery_tracked` starts false and is
  flipped by the first real event for that campaign, so a send whose
  webhook was never wired reads "not measured" rather than 0%.
  **Three surfaces:** the report screen, a `campaign_sent` line in the
  Timeline computed at read time (bounces land hours after the last email,
  so a row written at send time would be permanently wrong about them),
  and `comms.send_report` in the bar ("how did the Christmas email do").
  **Operator steps, without which nothing measures:** add
  `RESEND_WEBHOOK_SECRET` to the Supabase function secrets and register
  `<project>/functions/v1/resend-webhook` in Resend against those three
  events.
- **A dead address is a member fact** (0230) — 0229 holds a bounced
  address back from every send, which is all the comms surfaces need and
  not what the gym needs. The person is still a member: they still have a
  plan, they still go quiet, and the coach going to chase them had no way
  to know the email would land nowhere. `email_suppressions` gains
  `profile_id`, written by the same event handler from the recipient row it
  already holds — matching on the address at read time would mean every
  member surface joining on an email column, and member email is behind
  `can_see_email` (0178) precisely so most staff never see it.
  `gym_unreachable_emails(gym, profile?)` answers "can we email this
  person" without answering "what is their address": gated on
  `can_access_staff_area`, returns no email column, and serves both the
  one-member and whole-list shapes. It shows on the member profile as a
  red notice with what to do instead, on the members list as a badge
  ("Email dead" / "Marked spam"), and on the bar's member card as an Email
  fact — so "show me Marcus" says it before you write to him. The two
  reasons carry different advice on purpose: a bounce is usually a typo
  worth correcting, a spam complaint is a decision worth respecting.
- **A send going out can be stopped** (0228) — `comms.stop_send` ("stop
  the newsletter, the price is wrong") over a new `comms_stop_campaign`.
  `comms_unschedule_campaign` stops working the moment the dispatcher
  flips a campaign to `sending`, and after that there was no abort, no
  recall and no path to the `cancelled` status the CHECK has allowed
  since 0044. The window is real: the worker sends eight at a time
  through a queue that can be a thousand long.
  **Two halves, both needed.** The RPC flips the campaign to `cancelled`
  and marks everything still `queued` as `skipped` with the reason
  recorded — done here rather than left to the worker, because a
  timed-out invocation would otherwise strand those rows as `queued` for
  ever, indistinguishable from a send in progress. The worker polls the
  campaign's status every two seconds and stops pulling from its queue,
  because it holds its own copy in memory and would otherwise send the
  lot regardless; a vitest guard greps for that check, since a refactor
  could drop it silently and the symptom is an email nobody can stop.
  **What it cannot do is on the card:** mail already accepted by Resend
  is gone — no recall exists in SMTP or the API — so the card counts how
  many already have it before it asks, and the receipt says the ones who
  got it keep it. The campaign ends `cancelled` rather than `sent` or
  `failed`, because it did send, partly, on purpose, and both other words
  are wrong about that.
- **Members are told who is taking it** (0227) — `class_change_notifications`
  has announced a closed gym, a moved class, a reopened one and a
  cancelled one since 0169/0212, and never the change a member is most
  likely to care about: a coach is often why they booked. There was no
  kind for it and neither writer called anything. `claim_cover` has
  reassigned coaches since the cover flow existed and told the coach who
  asked and nobody else; `set_session_coach` (0224) added assignment and
  said so on its card. Both writers now call
  `_enqueue_class_coach_changed` — notifying on one path only would make
  cover and assignment behave differently for the same visible event.
  Shaped like `_enqueue_class_cancelled`: an in-app row marked sent and an
  email row queued per booked member, blanket unsubscribes recorded as
  `skipped` with the reason rather than dropped. **Future classes only** —
  mailing forty people about who taught a class they have already been to
  is noise dressed as service. The idempotency key is the session plus the
  incoming coach, so a retry cannot mail twice; the known edge is that a
  there-and-back does not re-announce a coach they were already told
  about, which is pinned by a test as the acceptable way to be wrong.
  Two client bugs went with it: the member inbox's kind union never gained
  `class_cancelled` when 0212 added it, so **a cancelled class has been
  announcing itself as "Class times changed" ever since** — the two-branch
  ternary fell through. It is a lookup table now, with a label per kind.
- **One class can move, and one class can change coach** (roadmap step 2)
  — `classes.move` ("push Friday's barbell club to Thursday at 6:30") and
  `classes.set_coach` ("Jo is taking Saturday's 9am") over
  `reschedule_session` and `set_session_coach` (0224). Before this,
  `bulk_edit_sessions` was the only writer of a session's time and it is
  a *relative* shift over a date range that refuses anything crossing
  midnight, so moving one class to a different day had no expression at
  all; and `coach_id` had exactly one writer in the schema, `claim_cover`,
  which sets it to `auth.uid()` — a coach could volunteer for a class,
  nobody could be given one. The client could not do either: 0195 revoked
  UPDATE on `class_sessions`.
  The move refuses a class that has already run (its attendance is a
  record of who was there), a time in the past, a slot inside a live
  closure — the suppression trigger is BEFORE INSERT only, on purpose, so
  the RPC is the only guard there — and a slot already held by a sibling
  of the same recurrence (`class_sessions_recurrence_starts_unique`,
  caught and said in words). Anyone booked in keeps their place and gets
  a `classes_rescheduled` notification, keyed on the resulting time so a
  double-tap does not mail twice.
  The coach change replicates `claim_cover`'s two checks — no
  double-booking, and nobody put in front of a class type they are marked
  unqualified for — and adds the roster rule that only an owner or a coach
  can take a class (admins do not coach, which is `user_can_cover`'s own
  rule). Both gate on `effective_can(gym_id, 'can_edit_classes')`;
  `can_bulk_edit_classes` stays what 0169 wrote it for, which is blast
  radius over a range.
  Two things they deliberately do not do, both stated on the card rather
  than hidden: they **do not rewrite the repeating schedule** (0170
  refuses to rewrite a pattern from a partial selection, and one session
  is the most partial there is — so editing the schedule later puts the
  class back), and a coach change **tells no members**, matching
  `claim_cover`, which tells the requesting coach and nobody else. Both
  are in the roadmap's known list.
- **The roster can change** (roadmap step 2) — `team.set_role` ("make Jo
  an admin", "Dan is not coaching any more, just a member") and
  `team.remove` ("Marcus has left") over `set_member_role` and `leave_gym`
  (0223). Nothing in Temple wrote `gym_memberships.role` after an invite
  was accepted, so a role change meant deleting the person and
  re-inviting them — losing the membership row and everything hanging off
  it. The two verbs stay separate deliberately: a demotion keeps the
  membership, the bookings and the history; a removal cancels the lot and
  erases the health answers, and the removal card counts what it is about
  to cancel rather than describing it ("their 4 upcoming bookings are
  cancelled") because a number reads as a decision and boilerplate does
  not. Three rules live in SQL, not the client, because they are what
  makes granting the capability safe: only an owner mints or changes an
  owner or an admin, only an owner removes one, and **a gym always keeps
  at least one owner** — a gym whose only owner walked out has nobody who
  can administer it. A role change also clears that person's
  `gym_member_capabilities` rows, since a per-person switch was granted
  for the job they had.
- **Leaving stops meaning admin** — `user_can_admin` read the membership
  row without asking whether the person still worked there, so an admin
  who left in March could still remove members in July. It backs thirteen
  policies across eight tables and it was the last raw-role holdout on
  the destructive path; `effective_can` has required `left_at is null`
  since it was written. 0223 adds the guard and moves `leave_gym` itself
  onto `effective_can(gym_id, 'can_archive_members')` — the key the
  Remove button on the members screen has always read, while the server
  asked a different question.
- **A send can be booked and called off by sentence** (roadmap step 2) —
  `comms.schedule_send` ("email everyone about the Christmas hours on
  Friday morning") and `comms.cancel_send` ("don't send the Christmas
  hours email") over 0183/0193's machinery. The standing rule was that
  nothing sends from the bar, because the send button *is* the approval;
  a scheduled send breaks that, since nobody is at the screen at seven on
  Sunday. So the approval moves to a card that shows what is being
  approved: the compiled email itself, the audience with its count, and
  the exact local time stamped above the subject with how far away it is
  ("Tuesday 4 August at 09:00 — in 3 days"). Two writes, deliberately not
  one transaction — a draft that saves and a schedule that fails leaves a
  real, openable draft and a receipt saying exactly that, because rolling
  the draft back would leave nothing. Cancelling goes through
  `comms_unschedule_campaign`, which is gated on `status = 'scheduled'`;
  the */15 dispatcher closes that window by flipping the row to
  `sending`, and losing the race is reported as losing it ("it has
  already gone out") rather than as a cancellation.
- **A scheduled time is the gym's, not the device's** — nothing in the
  comms path read `gyms.timezone`. The campaign editor resolved the typed
  time through `new Date(...)` in the *device's* zone and its hint text
  said so, so a coach scheduling next week's newsletter from a beach
  booked the wrong hour for the members — the one surface in Temple not
  following the gym's clock, when the timetable, the closures and the
  cancel cutoffs all do. `src/lib/send-time.ts` (pure + tested) parses a
  wall time, resolves it in `gyms.timezone` through `wallTimeToEpoch`, and
  labels it back in the same zone; both the chat verb and the editor go
  through it, so a send booked on either surface lands at the same
  instant. It also refuses a day that does not exist (31 April) rather
  than rolling it forward, and anything more than a year out.
- **The draft, in the chat** — a confirm card that read "Rehab class starts
  Monday — A new small-group session for anyone…" told an owner it was
  roughly about the right thing, which is not the question they have. Both
  comms cards now render the draft through the registry's generic `card`
  escape (`card: 'email'`, the second renderer after `member`). On web it
  is **the email**: the compiled HTML the send worker will post, in the
  same sandboxed read-only iframe the campaign editor previews with, so
  the logo is the logo, the widths are the widths and the brand colours
  are the brand's. On native there is no WebView in this app, so the card
  shows the subject and the sections as text — a downgrade in fidelity,
  not in content, which is the right way round for a surface whose
  question is "does this say the right thing". A sequence renders every
  email in it, each stamped with when it goes. `ProposalCard` gained an
  optional body so a named renderer and the two choices can live on the
  same card; a `do` with a renderer is no longer mistaken for a preview
  with nothing to show.
- **One builder for the card and the write** — the preview and the apply
  each had their own copy of the four lines that turn a draft into the
  block document, which is how a preview and the thing actually saved get
  to disagree without anyone noticing. They are now one function, so the
  campaign stored is byte-for-byte the email that was on screen.
  Rendering the real thing immediately found what the summary had been
  hiding: that copy fell back to `textColor: '#FFFFFF'` — white body text
  on the white content panel. `gyms.text_color` is `NOT NULL` so it never
  bit in production, but it fires the moment that select comes back empty,
  and an unreadable draft is not something a fallback should be able to
  produce. The fallbacks are now the block kit's own
  (`FALLBACK_BRAND_SEED`), and a test pins the rendered body colour.
- **Nothing walks the owner out of the chat** — `ActionContext.navigate`
  is gone, replaced by `offer(label, href)`. Every use of it was comms
  (the newsletter and the sequence both jumped to their editor on Yes),
  and navigating on the owner's behalf empties the conversation they were
  in the middle of — the exact complaint that shaped this surface when the
  import did it. The action now offers the way through and the receipt
  carries it as a chip ("Open it to send"), so the send button stays the
  approval without the chat being abandoned to reach it. A test walks
  `src/lib/actions/` and fails on any `router.push` or `ctx.navigate`, so
  it cannot come back by accident.
- **Your rules, permanently** — the day-one rule sheet (extracted to
  `src/components/RuleSheet.tsx`, shared with `/setup`) opens from a
  chip above the bar with the gym's *current* settings, read back by
  `choicesFromGym` (`src/lib/rules-read.ts`, pure + tested; late-cancel
  derived from the class types' effective policies by majority, ties
  strictest-first). Tapping a value applies that one field immediately —
  per-action saves, a receipt line in the stream, the sheet refetches.
  The tap goes through `gym.change_rules` like a spoken change does, so
  there is one path to a rule change rather than a tap path and a
  sentence path.
- **The ledger seed** — `agent_actions` (loop-1 spec's table) exists and
  is unioned into the feed: staff read behind `can_see_money`, no client
  write path at all (`Insert: never`).
- **The money loop** (roadmap phase 2, 0206 — spec in
  `docs/loop-1-payment-recovery.md`). Off by default per gym:
  `agent_authority` rows ARE the flag, written by owner-only
  `set_money_job` — surfaced as a Timeline card ("Failed payments — want
  me to chase them?") that appears only while a payment is failing, and
  taking the job on is reading its rules and saying "sounds right".
  Hourly `agent-revenue-tick` (pg_cron, `cron_run_log`-logged) works
  each dunning row as an `agent_cases` case through a deterministic
  policy — no model anywhere: touch 1 is the existing 0175 notice;
  touch 2 a warm chase 3+ days in while Stripe still retries; touch 3,
  when Stripe gives up, the cheaper-plan offer (existing active cheaper
  recurring plan only) or a final note. Proposals are `agent_actions`
  rows: `approval` level renders as a Timeline question card (reasoning
  sentence, SQL-derived evidence behind "See the details", exactly two
  choices); `decide_agent_action` (capability-gated) executes on
  approve, and "Always allow this" flips `agent_authority` to
  `autonomous` in the same transaction. Execution fills an
  owner-approved `agent_message_templates` body (placeholders only — no
  model text ever reaches a member) into `agent_outbound_messages`
  (named to avoid the front desk's `agent_messages`), drained by the
  `send-agent-messages` worker (Resend, 3-retry budget, address resolved
  at send time) via the `dispatch-agent-messages` cron — with quiet
  hours (09:00–20:00 gym-local) enforced at the send, so a 10pm approval
  waits rather than refuses. Hard rules in SQL: one open case per
  subscription (partial unique), max two agent touches per case, one
  open question at a time, a rejection ends that case's asks for good,
  proposals expire visibly after 7 days, and no code path cancels a
  membership or invents a discount. Cases close from the dunning row
  vanishing: recovered / lapsed / left by subscription + membership
  state. pgTAP: `money_loop.sql` (18 assertions).
- **Keeping members** (roadmap phase 8, 0208) — `set_retention_job`
  (owner-only, Roster take-on card) writes a `retention_message`
  authority row + owner-approved template. The daily
  `agent-retention-tick` finds regulars gone quiet — attended within 90
  days, nothing for 21+, still on an active plan — and proposes one
  warm note each: three per gym per day at most, never the same member
  twice inside 45 days (a rejection blocks the window too), never about
  health, and writing anyone off stays human. Approval/autonomous flows,
  execution and the send worker are the money loop's, unchanged.
- **Finding cover** (roadmap phase 7, 0208) — `set_cover_job` writes a
  `cover_ask` authority row (no template: the execution isn't a member
  email). The hourly `agent-cover-tick` finds cover offers nobody has
  claimed on classes inside the gym's own `cover_warning_hours` window
  and proposes re-asking; execution (`_agent_cover_reask`) inserts
  targeted `cover_notifications` for the claimable coaches (0165's
  recipient rule verbatim, date-stamped idempotency, blanket-unsub
  honoured on email only) — drained by the existing worker into the
  same Cover inbox and email as a fresh request. The agent never
  assigns a coach, never moves or cancels a class; one ask per request
  per day. pgTAP: `more_jobs.sql`.

### The Roster and Goals
- **The Roster** (`/management/roster`, chip beside the Timeline's talk
  bar) — people (with a Manage chip into the Team editor) and Temple's
  jobs in plain names: the front desk ("on its own", links to its
  screens) and the money job — one line of what it does, a rope pill,
  and for the owner two dials (payment nudges / plan offers, "asks
  first" ↔ "on its own") backed by `set_agent_job_level` (0207,
  owner-only, refuses when the job isn't on) plus a two-tap switch-off
  via `set_money_job(false)`. When the money job isn't on, the shared
  `MoneyJobCard` renders inline.
- **Goals** (`/management/goals`, chip beside the talk bar) — "200
  members by December" as a brief: `gym_goals` (0207; kind `members`
  only for now, owner writes, admin reads — the audience the old
  `gym_insight_targets` had). The score is computed from the live
  roster (active member count), never typed; the card reads "143 today
  — 57 to go, 5 months left." pgTAP: `roster_and_goals.sql`.

### Programming
- **The roadmap** (roadmap phase 5, 0205 — `programming_blocks`) — a year
  of named training blocks ("Squat strength — 8 weeks", "Open prep") set
  by the owner or head coach, visible to the whole team. Lives inside
  the programming calendar, not a new surface: a Week | Year toggle on
  the staff Programming screen; Week shows a block strip above the day
  circles ("Squat strength · week 3 of 8" + the block's note) computed
  by `blockForDate`/`blockStripText` (`src/lib/programming-roadmap.ts`,
  pure + tested); Year is a twelve-month band plus the block list with
  add/edit/delete (`ProgrammingRoadmap.tsx`, name/dates/note/colour).
  Reads and writes both behind `user_can_manage_classes` — coaching
  material, RLS-hidden from members. Sharing is existence: a block saved
  in Year is on every coach's strip immediately.
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
- **Money block on Analysis** [`can_see_money`, owner-only by default —
  so it is absent for the coaches the rest of the page is aimed at] —
  four tiles for the current calendar month off one RPC,
  `compute_finance_summary(gym, month_start)`:
  **Confirmed** (settled `billing_events` this month, with a delta vs the
  named previous month rather than the generic "previous period"),
  **Pending** (recurring memberships whose `paid_period_end` falls before
  the month rolls over — the charges Stripe is scheduled to attempt),
  **Month projected** (confirmed + pending, the mid-month number), and
  **Expected monthly** (what the memberships already sold are worth per
  month, each at `plan_subscriptions.price_cents` — the grandfathered
  snapshot, so a price rise never re-rates an existing member).
  `credit_pack` is excluded from both forward-looking figures: it is a
  one-off purchase with no renewal, the same reason `0125`'s lapse sweep
  skips it.
  **Pending is scheduled money; At risk is money already failing.**
  `stripe-webhook` handles `invoice.payment_failed` (0174) and records
  dunning on `plan_subscription_dunning` — `past_due_since`,
  `payment_failure_count`, `last_payment_error`, `next_payment_attempt`.
  Its own table, behind `can_see_money`, because `plan_subscriptions`'
  staff policy is `user_can_assign_plan` (every coach, no capability term)
  and Stripe's verbatim decline reason is not roster data (0176). A row
  exists only while a run of failures is live, so presence IS past-due and
  recovery is a delete.
  A failing renewal moves out of Pending into **At risk** and is kept out
  of Month projected, because counting a declined card is how a forecast
  lies. Underneath the tiles, **Needs chasing** lists who
  (`gym_overdue_memberships`, `can_see_money`, deep-linking to the
  member).
  **The membership deliberately stays `active` while Stripe retries.**
  `ps.status = 'active'` is what gates booking eligibility
  (`0011_eligibility_predicates.sql`, `0050_multi_membership_booking.sql`),
  Stripe's smart retries run about two weeks, and most recover — so a
  `past_due` state would bar someone from training over a card that
  expired. The grace period is the point; the dunning columns carry the
  visibility instead. Recovery (`invoice.paid`, or the subscription
  returning to `active`) drops the dunning row and the invoice link
  together via `_clear_payment_failure`.
  **Member side**: the member is told (0175) — an in-app notice the DB
  writes instantly, plus a queued email drained by
  `send-payment-notifications`. **One notice per dunning run, not per
  retry**: Stripe attempts a failing card three or four times over about
  two weeks, and mailing each would train the member to ignore the sender
  by the time it matters, so the idempotency key carries `past_due_since`.
  Stripe giving up earns its own `payment_final_notice`, because the
  consequence changes from "we'll try again" to "your membership will be
  cancelled" — and the two are never sent together, which a gym with
  retries disabled would otherwise trigger. **Recovery unsends what it
  can**: paying marks a still-queued email `skipped` and the in-app row
  read, so a member who fixes it in ten minutes is neither mailed nor left
  with a badge. A blanket email unsubscribe is deliberately NOT honoured —
  a failing payment is not marketing. Unlike the cover and class-change
  workers there is no client to drain the queue (the failure arrives from
  Stripe with nobody watching), so `stripe-webhook` invokes the worker
  itself and the Money block nudges it as a backstop; a send that fails at
  the provider is retried up to three times rather than left terminal,
  since one-notice-per-run means nothing would ever replace it. The
  worker authorises on `can_see_money`, not membership — its response
  counts are an oracle for how many people at the gym have a failing
  card.
  **The copy tracks the plan kind**, three ways (0176/0191). An
  `unlimited` member keeps booking. A `credit_period` member keeps the
  credits they already hold — the failure means the next batch has not
  arrived, not that the balance is zero — so the copy says the top-up is
  on hold rather than that they cannot book. A `programming_only` member
  does not book classes at all, so neither sentence applies.
  **It expires.** `leave_gym` deletes the dunning row, the notifications
  and the invoice link, and `purge_expired_payment_data` (weekly, 0177)
  sweeps stale links after 30 days and notifications after a year.
  **The notice outlives the subscription.** It renders at Membership screen
  level off the dunning row rather than inside the current-subscription
  card, because Stripe giving up means `customer.subscription.deleted` and
  a `cancelled` status — the moment the member most needs to see why. Past
  the cancellation the copy switches to past tense and keeps Pay now, since
  `invoice.paid` sets status `active` unconditionally, so paying really
  does reinstate. Marking read waits for the notice to be on screen.
  **The inbox banner tracks the failure, not the read.** It is shown while
  a dunning row exists, so it survives being read on day 1 and stays up for
  the rest of Stripe's fortnight; the badge stays read-based, because a
  badge means "new" and the banner means "ongoing".
  **Chasing is actionable.** Each chase row carries a Message chip into the
  existing DM thread, and the member's own screen gains a Payment trouble
  card (`can_see_money`) with the dunning detail plus Email / Call /
  Message. Contact details come from `gym_member_contact` (0178), which
  gates email on `can_see_email` and phone on `can_see_full_pii` — the
  first place `can_see_email` is enforced anywhere in the app.
  The Membership screen shows what happened, when Stripe
  will retry, and a **Pay now** button. That link lives on its own
  `membership_invoice_links` table with a self-only RLS policy —
  deliberately NOT on `plan_subscriptions`, whose staff select policy is
  `user_can_assign_plan` (owner/coach/staff), because the Stripe-hosted
  invoice is a bearer URL rendering the member's billing address and
  coach/staff hold neither `can_see_full_pii` nor `can_see_email`.
- **Programming Analysis page** — reorganised "headline first, detail
  second" (the 12-week injury map and per-movement member trends fold
  into the page's third group rather than standing alone):
  - **Verdict tiles** — three at-a-glance answers above everything:
    Push:Pull ratio, top time domain, heavy share. Green inside a
    healthy band, amber when drifting (`src/lib/programming-verdicts.ts`,
    pure + unit-tested: push:pull ok 0.8–1.25, a time domain over 50%
    flags concentration, heavy ok 20–40% of loaded pieces). Derived
    from the same aggregations as the cards, so a tile can never
    disagree with the card below it; captions carry the underlying
    counts.
  - One **scope row** (date-range pill + class-type chips, including
    archived types) drives every programming stat on the page,
    verdict tiles included.
  - Cards grouped under three labelled questions:
    - **What you're training** — Pattern × Energy matrix, Energy
      system bars, Movement pattern volume
    - **How it's dosed** — Time domains (AI-read conditioning lengths
      bucketed <5 / 5–10 / 10–15 / 15–20 / 20+ min; strength formats
      deliberately excluded) + Load balance (heavy / moderate / light
      / bodyweight, AI-read from loading cues)
    - **Bodies & people** — Region load vs open injuries as ONE card
      (programmed-volume silhouette above the open-injuries
      silhouette, so the cross-reference is built in; degrades per
      capability to either half alone), the open-injury list, and the
      movement trends
  - **Untagged sections demoted to a housekeeping footer** — a slim
    row stating the count, expanding to the detail card on Review.
  - Desktop widens to `max-w-4xl` with two-column groups (matrix
    beside the mix cards, Time domains beside Load balance, bodies
    beside trends); phones keep the single stack.
  - Every card keeps its (i) toggle revealing a "What this shows /
    Why it matters" plain-language panel.
  - **AI section tagging (0203)** — the dimensions Boxmate makes
    coaches tag by hand, read by AI from what the coach already wrote.
    The `classify-programming` edge function sends each distinct
    section (format + title + body, deduped by content fingerprint) to
    Claude Haiku once and caches the result in `programming_ai_tags`
    (per-gym, hash-keyed, service-role-only — the vocab arrives from
    the client, so the cache is deliberately not cross-tenant), gated
    on `effective_can(gym, 'can_see_workout_logs')` — the same
    capability that gates the block. Each tag carries movement keys
    (vocabulary-constrained; the vocabulary spans **both catalogs** —
    CrossFit and Hyrox — and every `hyrox_*` station is classified in
    `MOVEMENT_CLASSIFICATIONS`, so a Hyrox gym's programming lands in
    the same matrices), an estimated `duration_minutes` and a
    `load_level`. Client-side (`src/lib/programming-ai-tags.ts`, pure
    + unit-tested) the AI read merges into the rule-based
    classification: AI movements union into the matrices and flip
    lexicon-missed sections off the Untagged card, AI durations beat
    the "NN min" regex (falling back to it when AI is unavailable),
    and long AI-estimated for_time/amrap pieces upgrade to oxidative
    exactly like the regex path. No ANTHROPIC_API_KEY → the block
    renders the rule-based view unchanged; nothing blocks on AI.
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
  sessions on the calendar, extended to a horizon. The walk is clamped
  to `starts_on` (0170); the cursor alone used to drive it, so a
  schedule whose `materialized_until` had been rewound behind its own
  start date — which the class-types editor does on every save — would
  materialise backwards over dates it does not own.
- **Cover requests** [`can_request_cover` / `can_claim_cover`] — a
  coach can hand a class to another coach; first-claim wins; refunds
  and waitlist promotion handled correctly on cancellation. **Claims
  are gated on class-type qualification** — a coach explicitly
  disqualified for that class type can't claim it (enforced in the
  `claim_cover` RPC and surfaced as a disabled state in the UI). Two
  ways in: **pick individual classes**, or **pick dates**
  (`request_cover_range`) for "cover me from 22 Dec to 3 Jan". A date
  range is a **standing window** — the requested dates live on the
  request, so classes scheduled into the window *after* it was lodged
  are offered automatically, and a window with nothing in it yet is a
  valid request. The range flow materialises the gym's recurrences out
  to the end date first (`extend_gym_recurrences`), so a window past
  the 12-week materialisation horizon still finds real classes. The
  preview list lets a coach untick a class they'll still teach.
  Partially-claimed requests **can** be withdrawn — cancelling drops
  the unclaimed offers and leaves the claimed ones alone. A nightly
  `expire_cover_requests` sweep (pg_cron) closes out windows that have
  passed and clears offers for classes that already ran.
- **Cover notifications** — `cover_notifications` is a queue + audit log
  on the `lead_notifications` pattern (in-app row delivered instantly,
  email enqueued and drained by the `send-cover-notifications` edge
  worker, every attempt logged and retryable). The worker is invoked two
  ways: best-effort from the client at the moment of a request or claim,
  and — because the nightly sweep has no human present to trigger that —
  by the `dispatch-cover-notifications` cron every 15 minutes (0198),
  which drains any queued cover email per gym with the Vault worker key.
  Before 0198 the nightly warning email only sent if someone happened to
  open the Cover screen afterwards. Three events: **cover requested**,
  fanned out to every coach who could claim it; **cover claimed**, back to
  the coach who asked; and **still uncovered** — a nightly
  `warn_uncovered_cover` sweep chasing the requester and the gym's
  owners/admins about classes nobody has claimed. The lead time is
  the per-gym **`cover_warning_hours`** setting (Operating defaults →
  Cover; default 48, max two weeks, **0 turns the warning off**). That
  last one **repeats daily** while the problem persists
  (the idempotency key carries the gym-local date) and is mirrored by a
  live amber banner on the Cover screen, computed on read so it never
  goes stale between sweeps. Requested notifications are
  **one digest per request**, naming the window and the class count —
  never one per class. Coaches disqualified for every class type in the
  request aren't told, and neither is the requester. A **blanket** email
  unsubscribe suppresses the cover email (recorded as `skipped`, not
  silently dropped) but never the in-app notification. Surfaced as a
  **Cover tab in the Inbox** and counted in the nav badge; opening
  either the tab or the Cover screen marks them read. Email delivery
  sits behind the same gate as the rest of the comms pipeline. That gate
  is **open** — `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set and a real
  campaign send was confirmed delivered on 2026-07-17
  (`docs/gym-outreach-checklist.md`), so this sends for real. The
  simulated path (rows marked sent, worker reports `mode: 'simulated'`)
  is the fallback when no key is configured, not the current state. The
  in-app half always lands either way.
- **Class detail modal** — roster, attendance marking (check-in / no-
  show / unmark), leaderboard for that session.
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
- **Bulk class edits across a date range** [`can_bulk_edit_classes`,
  owner/admin] — the **Bulk** button on the Classes calendar. Two modes
  over a From/To window, both previewing the matching classes with
  untick-to-exclude (same shape as the cover range picker, and the same
  timezone arithmetic in `src/lib/date-range.ts`):
  - **Close the gym** — "we're shut 22 Dec to 3 Jan". Cancels every
    class in the window with the normal refund + waitlist handling
    (`_cancel_session_internal`), and records a **`gym_closures`** row.
    The closure is a **standing window**, not a one-shot sweep: a
    BEFORE INSERT trigger on `class_sessions` silently suppresses
    recurrence materialisation into the window (silently, so
    `extend_recurrence` doesn't abort mid-walk) and raises a plain
    error for a hand-added one-off, so the operator is told why it
    didn't stick. The range materialises out to the end date first
    (`extend_gym_recurrences`), so a Christmas closure entered in July
    still finds real classes past the 12-week horizon.
  - **Change classes** — capacity / length / start-time shift across the
    window for a reduced holiday timetable. Blank means "leave
    unchanged". Per-class outcomes are counted rather than raised: a
    class with more members booked than the new capacity is left alone,
    a shift into the past is skipped, and shifts are applied away from
    the direction of travel so a whole series stepping over itself never
    trips the `(recurrence_id, starts_at)` unique index.
    **The repeating schedule is updated too** (0170), otherwise the
    pattern and the calendar disagree and the pattern wins the next time
    it is walked — either via the 0078 reset-on-pattern-edit trigger or
    the class-types editor's delete-future-and-re-extend save. A window
    covering a schedule's whole life rewrites it in place; a window
    covering part of it **splits the schedule into up to three** (before
    / window / after), reparenting the sessions so re-materialisation is
    a no-op instead of a duplicate factory. Two refusals, both because
    the alternative is a pattern that lies: a **partial selection**
    leaves the schedule alone and says so in the result (there is no
    recurrence for "these three Tuesdays but not that one"), and a shift
    that would push any class **past midnight** is rejected before
    anything is applied, since it would change which days the pattern
    fires on.
- **Reopening a closure, class by class** — the **Closures** card on Gym
  settings opens a picker of the classes that would come back, ticked by
  default and **grouped by day**, so a fortnight of a busy timetable is
  tickable a day at a time (plus Select all / none). The day boundary is
  `preview_closure_reopen`'s `local_date`, resolved in the gym's timezone,
  not derived client-side — otherwise a staff member signed in from
  another country groups onto the wrong day. Grouping and tick logic are
  pure functions in `src/lib/closure-reopen.ts`. The classes do not exist
  to be listed (the closure deleted them), so `preview_closure_reopen`
  recomputes them from the schedules — and the restore inserts from that
  same function, so the list ticked is the list created.
  - **Everything ticked** ends the closure: `reopen_closure` rewinds each
    recurrence's materialisation cursor over the window and re-extends,
    and the dates are open for new classes again.
  - **Anything left unticked** keeps the closure **live**, so the dates it
    still covers stay shut against classes created later as well as the
    ones it removed. That is the "shut 22 Dec – 3 Jan, but open gym on the
    28th" case, and it is the same shape as the create flow's
    `p_exclude_session_ids` — the closure holds, with named exceptions.
    The restore itself gets past the suppression trigger via a
    transaction-local `temple.restoring_closed_class` GUC, the same device
    as `temple.skip_booking_refund` (0065).
  - Bookings are never restored by either path — those members were
    refunded and have to book again, and **they are told** (0172,
    `classes_reopened`). This is the notification that needs an action
    from the member, so its email says so and links to booking. It works
    because `close_gym_dates` snapshots the bookings it cancels into
    **`closure_cancelled_bookings`** keyed on `(recurrence_id, starts_at)`
    — the pattern slot, not the session id, because the session it deletes
    and the one that comes back are different rows. One digest per member
    per reopen, keyed on a digest of the restored slots, so a second
    reopen bringing back different classes tells them again while a retry
    of the same one does not.
- **Class-change notifications** — closures and bulk reschedules tell
  the affected members: one in-app row (delivered instantly, shown in
  the Inbox Classes tab and counted by `inbox_unread_summary`) plus one
  queued email drained by the `send-class-change-notifications` edge
  worker. **One digest per member per change, never one per class.**
  Same queue shape as `cover_notifications` (0165), except the message
  text is stored on the row: the classes it describes have been deleted,
  so there is nothing to join to at send time. A blanket email
  unsubscribe marks the email `skipped` (visible, not silently lost) and
  never suppresses the in-app row.

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
  owner with required steps still pending is redirected to
  **conversational setup at `/setup`** on sign-in (below); the
  full-screen `/onboarding` checklist survives as its escape hatch
  ("Prefer the checklist?") and via **Skip for now**, which permanently
  dismisses the redirect (`gyms.onboarding_dismissed_at`, set via
  `dismiss_gym_onboarding`) — the inline Manage card stays available
  regardless, for whenever they want to finish.
- **Conversational setup** (`/setup`, owner-only) — day one as a
  conversation that takes the fastest input per step, not prose for
  everything. A fixed script running **the checklist's nine steps in the
  checklist's own order** — logo → settings → classes → health screening
  → payments → plans, then the optional three (team → members across →
  workout history) → go live — so `/onboarding` and the conversation can
  never disagree about what comes next. Settings before classes earns its place: the class builder seeds
  its capacity and duration from the defaults just saved. Payments
  before plans because a plan can only sell on the gym's own connected
  account; the card starts the OAuth itself and the state row's
  `return_path` (0210) brings the owner back to the conversation, rendered inside the staff shell (TopNav encases it; the thread
  anchors to the ask bar on tall viewports). The **logo step** is an
  inline card reusing the branding screen's picker, upload and
  `set_gym_branding` write — one tap, or "Skip for now" (the checklist
  keeps the step open). The **class step** embeds the real
  `RecurrenceEditor` (the class-types screen's own component, with a
  `hideRepeat` prop since day-one schedules are ongoing) in a builder
  card — name, colour, day chips, times, duration, capacity; "Add this
  class" stacks the week, "That's my week" applies the lot — while
  *describing* the week in the bar remains the alternative ("CrossFit
  at 6, 7 and 9:30 weekday mornings, 6pm evenings, 9am Saturday, cap
  16"; a failed parse re-offers the builder). The **plans step** repeats that container shape — name, kind chips
  (Unlimited / Classes a month / Class pack), price, classes, notice —
  stacking plans before one apply. Both paths land on the same apply,
  and the **ask bar is persistent through every step**: tap-first steps
  answer a typed message by pointing at the faster control rather than
  presenting a dead box. The feed wears the **checklist's own design
  language**: the `N of 6 done` progress header with the primary-filled
  bar (counting the same required keys `/onboarding` counts), each step
  opening with its shared `StatusDisk`, checklist label and `~N min`
  estimate, and each finished step collapsing to the emerald tick with
  the label struck through — the completed-row treatment verbatim.
  **A step that failed is not a step that happened**, and the
  strike-through means done exactly: a *skipped* step gets the receipt
  without the struck label, a *failed* one gets no receipt at all and its
  card stays open with the reason. Two holes were fixed to make that
  true. Stripe's OAuth leaves the app, and on failure the billing return
  handler consumed the "came from setup" flag *without* navigating —
  stranding the owner on Billing with the flag spent, so a retry wouldn't
  return either; it now lands on `/setup?stripe=error`, which adds one
  sentence to the conversation ("nothing was saved, so that step is still
  open") while the script reopens the step by itself, since its place
  derives from `get_gym_setup_progress` and a failed step was never
  recorded. And the CSV import treated a zero-row result as success —
  `import_pending_members` returns without error when every row is a
  duplicate — so it ticked the step off having staged nothing; it now
  keeps the card open and says which it was. The same audit fixed the
  inverse: a logo that uploaded and rules that saved weren't striking
  their labels, so the tick understated real work.
  **Every checklist step has a container in the chat**: logo
  (branding's picker), classes (`RecurrenceEditor`), payments (handoff
  to billing's OAuth), plans (kind chips + price), **health screening**
  (the same PDF → `gym-waivers` → `publish_waiver` path, with "Build a
  PAR-Q instead" one tap away), settings (rule chips + sheet), and the
  optional three: **inviting the team** (the Team screen's own
  `InviteSection`, verbatim), **bringing members across** and
  **importing workout history**. The member CSV import **runs in the
  chat**: `MembersImportCard` picks or pastes the file, then drives the
  wizard's own libs — `parseCsv` reads it, `autoDetect` matches the
  columns, `buildImportRow` shapes each row, `import_pending_members`
  stages them — and reads the file back as a sentence ("84 rows in
  mindbody-export.csv. Matched: Email, First name, …"). Unrecognised
  columns are the quiet part: a count with a "bring one in" link, not a
  cloud, because an export full of postcodes and country codes needs no
  decision from anyone. Expanding shows the columns; tapping one replaces
  that list with Temple's fields under "Bring 'X' in as…", so **only one
  list is ever on screen** and each sits under a line naming it (the first
  version stacked two identically-styled clouds of 25 chips with nothing
  to distinguish a source column from a destination field). An email column is
  the one hard requirement, so it is the only loud thing in the card: it
  never hides behind the disclosure, the button names the missing piece
  rather than sitting inert, and tapping a column assigns it as the email
  directly rather than opening a picker whose answer the prompt already
  gave. When Stripe is connected the card says to bring
  Stripe subscribers across from Stripe first, since that path adopts the
  subscription and avoids a double bill. The receipt carries the join
  link, because staged rows attach themselves to whoever signs up through
  it. The full wizard keeps its screen for the fussy cases it exists for —
  plan mapping, fuzzy duplicates, the cross-gym corrections learning —
  reached from a quiet line at the bottom of the card, and `?backTo=setup`
  returns the owner to the conversation. **Workout history runs in the chat too**:
  `WorkoutsImportCard` over the same libs — `buildResults` sorts every row
  into weighted lifts / scored WODs / Hyrox splits and the three import
  RPCs take them — reading the file back as "312 rows. Ready: 208 lifts,
  104 scored WODs." Movement names are the hard part, so it does what the
  screen did: names the ones it doesn't recognise, offers "Match them for
  me" (`resolveMovements` + `overridesFrom`), and anything still unplaced
  is *held* by the RPC rather than dropped, so an import is never
  all-or-nothing and the receipt says how many were held and why.
  **The finish card reopens a step in the thread** rather than pushing to
  a Manage page — its rows carry a `Step` instead of a URL and the
  conversation gained `openStep`, since leaving the chat to finish a chat
  step was the thing being avoided. **Health screening is fully
  conversational**: the waiver PDF, or "Use the standard PAR-Q instead",
  which publishes the ACSM screening seven on the builder's own two
  inserts (version bumped, prior version left intact so historical answers
  keep pointing at the wording the member saw).
  **The one step that deliberately keeps a screen is Stripe adoption.**
  A CSV only stages rows — nobody is charged, nothing is adopted — but
  pulling from Stripe creates a Temple plan per Stripe price and takes
  over live subscriptions, so every price needs a name, a kind and a
  credit count and every one is somebody's money. That review belongs on
  a page, and the link says which job it is rather than pretending it's
  the same as dropping in a CSV. Everything else that still leaves the
  thread is a labelled deep case at the bottom of its card: name movements
  by hand, map plans or sort duplicates, write your own PAR-Q wording.
  `backTo` now names which surface sent them: `setup` back to the chat,
  `checklist` back to `/onboarding` (`BackLink`, `useSetupAutoReturn`,
  and the Stripe round-trip's `sessionStorage` hand-off all read it).
  The **finish card** lists only what was actually left, each row opening
  its Manage page and returning here.
  **Setup is never lost** — and that took fixing, because every route in
  was conditional on setup being *unfinished*: the Timeline card hid once
  the required six were done, the Manage checklist hid when dismissed,
  and the root redirect only fires while something required is missing, so
  finishing six of nine steps closed the last visible door. Now
  **Manage → Settings carries a permanent owner-only "Set up your gym"**
  card that never hides; the Timeline's card **survives the required
  list**, staying a full card with the progress bar while something
  required is missing (a real warning — members can't join yet) and
  collapsing to one quiet line once only optional steps remain; and
  `GymSetupChecklist` now offers "Rather be walked through it?" so the two
  setup surfaces point at each other instead of the list only ever
  leading down into Manage pages. Beyond those, typing "continue setup"
  (finish / resume / back to setup…)
  in the talk bar routes there — matched client-side, no model
  round-trip, with the pattern's negative cases pinned in
  `src/lib/setup-intent.test.ts` so "set up a new class type" still
  reaches the parser. Either way the conversation resumes at the right
  step, since its position derives from `get_gym_setup_progress`.
  For the described path the `parse-setup` edge function
  (Claude Sonnet, tool-forced JSON, gated on
  `effective_can(gym, 'can_edit_classes')`, 503 without an API key)
  turns each into a proposal; the client sanitises it
  (`src/lib/setup-flow.ts` — clamped times/days/prices, no invented
  classes, a recurring plan with no price is dropped rather than sold
  free) and renders a preview card with exactly two choices. **Nothing
  is written until the owner confirms, and every write then runs
  through the owner's own session on the manual editors' exact paths**
  (`src/lib/setup-apply.ts`: `class_types` + `class_recurrences`
  inserts + `extend_recurrence`, `membership_plans` inserts,
  `set_gym_operating_defaults`) — setup holds no write power of its
  own. The rules step is five one-tap chip questions asked inline in
  the chat — booking window (3d/7d/2w/no limit), when late-cancel starts
  charging (9pm night before / 2h before / never), how close to the
  start booking stays open, membership-to-book, and week start — with
  the best practice as the first (pre-lit) chip and each answer echoed
  as a chat bubble. **The presets are the fast answer, not the whole
  answer**: every rule whose column takes an off-menu value ends its chip
  row with `CustomRuleChip` — a number, the unit the owner would say it in
  (tap to cycle: days/weeks/hours, minutes/hours, months), and an arrow.
  It is **one more chip, not a mode**: the presets stay visible and
  tappable throughout, because a picker that hides the choices in order to
  let you type is worse than the short menu it was meant to widen. One
  component, two sizes, so it sits level with the question chips or the
  sheet's smaller ones; a field with a single sensible unit shows it as
  plain text with nothing to cycle. Values convert to whatever the column
  stores and are *refused with the range* rather than clamped, since a
  booking window quietly halved is worse than being told the limit. The
  same chip closes the rule sheet's token options, so a value reads
  identically however it was set.
  **Late-cancel became a value rather than three presets**: the
  class-type columns behind it hold either an absolute time the night
  before or any number of minutes, and the old three-option enum was our
  flattening, not the schema's. It is now encoded `never` /
  `abs:HH:MM` / `rel:<minutes>` (a string, so every option table and
  equality check keeps comparing primitives), read back off whatever the
  class types actually hold — `lateCancelFromClassTypes` returns the real
  time or minutes and breaks ties toward the stricter rule — and spoken
  by `lateCancelLabel` ("from 10pm the night before", "from 30 minutes
  before"). `sanitiseRuleChanges` checks it by shape rather than
  membership, and the parser is told it is not a fixed menu, so typing
  "30 minutes before" sets 30 minutes instead of rounding to a preset. **Chips and typing are the same conversation**: an
  answer that isn't on the menu goes to `parse-setup`'s `change` step
  carrying *the question it answers*, so "30 minutes before" can't be
  read as a booking cutoff when what was asked about was cancelling.
  The parser is instructed not to round an off-menu enum onto the
  nearest option — it names what it couldn't take in `cannot` — and
  `sanitiseRuleChanges` drops anything that doesn't validate anyway, so
  what survives is read back in the rule sheet's own sentences
  (`ruleSentence`). Nothing is written until the end of the step, so a
  mis-read shows up in the read-back before it reaches the gym. One
  sentence can settle several rules, including questions not yet asked,
  so the run resumes at the first question still open
  (`nextRuleQuestion`) rather than the next in line. When the cancel
  question is the one that can't be answered from the menu, the reply
  names the real escape: that rule lives on the class type, so a single
  class can have its own once the timetable is in. The read-back is one
  sentence — "Everything else is
  set the way most gyms run it" — with **Carry on** applying the lot and
  **Have a look** opening the **rule sheet** on demand: the whole
  settings surface as grouped sentences (Booking / Your gym / The small
  print, that last collapsed behind "5 sensible defaults") where every
  value is a tappable token — tap "7 days" in "Classes can be booked
  7 days ahead" and that field's options open as chips under the
  sentence, current value filled, one tap to change, sentence rewrites.
  Sixteen fields, one token each (pinned by test), sharing one option
  table (`RULE_FIELD_OPTIONS`) with the question chips, and every
  field's default is its first option (also pinned). "Use these"
  commits the lot through the same setters the Settings cards use:
  `set_gym_operating_defaults` (window, close cutoff, week start,
  expiring-soon window, PAR-Q expiry, health retention, lead window,
  cover warning), the late-cancel policy onto every class type
  (gym-level `day_before` is retired), plus
  `set_require_membership_to_book`, `set_allow_minors`,
  `set_gym_weight_unit`, `set_dm_scope`, `set_leaderboard_config`,
  `set_gym_public_signup` and `set_gym_public_lead_capture`. Steps whose
  setup-progress rows are already done are skipped, so a returning
  owner isn't re-asked. Go-live lists what still needs a real button
  (Stripe, waiver, logo) as deep links, then "Go to your gym" or "I'll
  finish these later" (the same permanent dismiss). Parse failures and
  the no-API-key path degrade honestly to the checklist. Pure logic
  unit-tested (`setup-flow.test.ts`, `setup-apply.test.ts`).

The Manage page presents a tab strip:

- **Members** [`can_manage_tags`, or `can_see_insights` /
  `can_view_attendance` for the stats alone] — the member cockpit, with
  the former standalone **Insights** tab folded in. One shared **date
  range** picker sits at the top and drives every stat beneath it:
  - **Insight KPIs** [`can_see_insights` / `can_see_money` /
    `can_view_attendance`] — the three top-line tiles: Revenue (all
    sales — memberships, store, individual programming), Members, and
    Attendance % (share of members who attended a class in the period),
    each with a delta vs the previous period. **The Revenue tile read
    zero for every gym from `0080` until `0173`** — `is_revenue_event`
    matched Stripe's own event names (`charge.succeeded`, `invoice.paid`)
    while `stripe-webhook` writes its own shorter kinds (`checkout`,
    `invoice`, `store_order`, `store_subscription`), so nothing matched
    and an empty result read as "no revenue yet" rather than as a fault.
    `0173` matches the kinds actually written and
    `supabase/tests/revenue_event_kinds.sql` pins them, so the next
    rename fails a test instead of silently zeroing the dashboard.
    Lead/lifecycle metrics live
    on the **AI Front Desk** tab; the retired Targets editor and
    Expiring/Expired/Paying/Conversion/Retention tiles remain unsurfaced
    (`gym_insight_targets` and `compute_insight_summary` still exist
    server-side).
  - **Attendance summary** [`can_view_attendance`] — Attended / No-show /
    Unmarked over the same range.
  - **Action CTAs** — compact tiles that keep the member list high on the
    page: **Invite a member** [`can_invite`] opens a modal with the
    email-invite form and the shareable/branded signup link + QR; **Import
    data** [`can_manage_staff`] opens a modal with Members / Workouts tabs
    linking onward to the Stripe, CSV and workout-history importers; **Tag
    rules** [`can_manage_tags`] opens the auto-tag rule editor in a modal;
    **Export members CSV** [`can_export_members`] downloads the roster.
    Front-desk staff who can't invite (coaches/staff) keep the shareable
    signup link + QR inline instead of in the modal.
  - **Member tagging** [`can_manage_tags`] — manual tags per member
    (`/management/tags?profile=<id>`: label + colour, removable chips)
    plus auto-tag rules (the Tag rules modal or `/management/tags`).
    Twelve rule predicates: the six cohort kinds (Intro / Expiring soon /
    Expired / Paying / Inactive / Never paid) and, since `0200`, six
    class- and membership-driven kinds — **booked a class type** (future
    bookings always count; optional look-back window), **attended a class
    type** (optional look-back), **no recent attendance**, **on a
    specific plan**, **cancelling** (gave notice), **joined recently**.
    Rules recompute nightly via pg_cron (`recompute-auto-tags`, logged to
    `cron_run_log`) as well as on demand ("Recompute now" →
    `apply_tag_rules`); nightly-applied tags attribute `created_by` to
    the rule's author. The recompute is **incremental** (`0201`): a member
    who still matches keeps their existing `member_tags` row, so
    `created_at` genuinely means "when the member gained the tag" — the
    anchor the `member_tagged` email-automation trigger relies on.
    **Member visibility** (`0202`): every tag and rule carries a
    `member_visible` flag (default off). No member surface shows tags yet,
    but the read boundary is enforced now — the old tenant-wide
    `member_tags` SELECT let any member read every member's tags via
    PostgREST; the replacement policy allows `can_manage_tags`,
    `can_manage_comms` (audience/automation tag pickers), or a member's
    **own** flagged-visible tags only. Staff set the flag per manual tag
    (checkbox on add, tap the eye on a chip to flip) and per rule
    (checkbox in the rule editor); rule flips propagate to existing tags
    in place without re-anchoring `created_at`. Tag/rule writes are gated on the
    `can_manage_tags` capability via `effective_can`, so per-gym role
    overrides apply (e.g. a gym can grant coaches tagging).
  - **Member list** [`can_manage_tags`] — searchable + filterable, with
    PAR-Q, Injury and cohort badges (Intro / Active / Paying / Expiring /
    Expired), plan chips and tag chips. A second **tag chip row** (one
    chip per distinct tag label, coloured dot, tap to toggle) filters the
    list to members carrying that tag; it ANDs with the cohort filter and
    search, also matches imported members' tag labels, and persists per
    gym alongside the cohort filter (`useMembersFilter`). **Membership requests** surface
    here too: a **Requests** filter [`can_assign_plan`] isolates members
    with a pending plan-change or cancellation, each marked with an amber
    **Request** badge and an inline **Approve / Reject** control (backed by
    `staff_membership_change_requests`, which now also returns
    `profile_id`, and the shared decide mutation). **Imported members**
    [`can_manage_staff`] that haven't signed up yet (`pending_members`
    rows, status `pending`/`invited`) are surfaced inline in the list,
    interleaved by name with live members, each carrying an amber
    **Imported** / **Invited** badge, their imported plan + credits + tags,
    and a per-member **Send invite** action (`send-member-join-invites`
    scoped to that one row, which flips it to `invited`); an **Imported**
    filter chip isolates them, and a caption above the list counts how many
    haven't signed up. `invited` rows show "waiting for sign-up" with no
    re-send (the edge function only targets `pending`). Tapping an imported
    card opens a **detail/edit page** (`/management/members/imported/<id>`)
    where staff review and correct the staged account before inviting —
    name, email, phone, DOB, emergency contact, plan/credits/dates, tags,
    notes and a "do not email" toggle, saved with a direct RLS-gated
    `pending_members` update; the page also **sends the invite**
    (auto-saving edits first) and can **delete** the staged row (e.g. to
    clear junk from a test import).
  - **Plan changes** [`can_assign_plan`] — roles without the member list
    (coaches/staff) get a **Membership requests** card linking to the
    standalone queue; Leads live on the AI Front Desk tab. The standalone
    `/management/members`, `/management/tags` and
    `/management/membership-requests` routes still exist for deep links.
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
  assuming USD. This reaches the whole product, not just the revenue
  surfaces: `formatPrice(cents, currency)` takes the currency as a
  required argument, so plans, setup, the shop, the talk bar's cards, the
  member's membership screen, the refund dialog and every price input
  label all follow the gym — and a vitest guard scans the source for a
  symbol glued to an amount or baked into a label so the next one can't
  be typed in by hand. The money job formats server-side through
  `money_text(cents, currency)`, because `{offer_price}` is substituted
  into the email the member receives.
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
    lead conversion window, and the **Cover** warning lead
    (`cover_warning_hours` — how far ahead to chase an uncovered class;
    0 turns the warning off). Same editor as the standalone
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

[`can_assign_plan`] Reachable from Manage → AI Front Desk
(`/management/leads`), a top-level section (renamed from "CRM", then
"Leads" — the nav category key is still `crm` internally). Track prospects
from
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
Captured rows land in Manage → AI Front Desk as `cold` with no
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
is never silently dropped. Owners can change the strategy at Manage →
AI Front Desk → Settings (`/management/leads/settings`): `round_robin` (default),
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

Staff surfaces [`can_assign_plan`]: Manage → AI Front Desk → Conversations lists
every thread (AI replying / With a coach / Opted out); the thread view
polls live, and Take over / reply / Hand back to AI go through the
`lead-agent-staff-send` edge function (JWT + RLS-proven authorisation —
staff replies send from the gym's number and implicitly pause the agent).
The lead detail modal deep-links to its conversation. Owner settings live
on Manage → AI Front Desk → AI Agent: enable toggle, voice toggle (disabled until
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
The step's mode toggle, five answer fields, tone picker and
generate/regenerate button live in a shared `AgentBriefBuilder` component
(`src/components/AgentBriefBuilder.tsx`), taking `gymId`/`value`/`onChange`
so any surface can host the same drafting flow over whatever text state it
owns. The AI Agent tab's "What the agent knows" card reuses it: a "Rewrite
with AI" chip opens a modal with the same fields over a scratch draft
seeded from the current notes; "Use this" copies the draft back into the
card's own textarea (still requires the card's own "Save notes" to
persist) so a half-finished AI rewrite can never overwrite the saved brief.

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
(AI Agent tab, owner-only): `agent-interview/start` rings the owner via a
Vapi outbound call — a transient interviewer assistant (in the gym's
chosen voice) asks about the offer, beginners, parking and FAQs; the
end-of-call transcript is distilled by Claude into a DRAFT brief stored
on `agent_interviews`, which the owner edits and applies (or discards)
from the hero card — a call never rewrites the live agent directly. Needs
`VAPI_INTERVIEW_NUMBER_ID` (a platform-wide outbound Vapi number); "No
phone needed — talk to it in your browser instead" runs the identical
interview with no outbound telephony at all: `agent-interview/browser-start`
hands the client an inline assistant config (deliberately with no
`server`/secret in it, since it goes straight to the browser) for
`@vapi-ai/web` to call directly — the shared `useVapiCall` hook (factored
out of `TalkToAssistant`) drives ready → connecting → live → ended the same
way "Talk to it" does. The browser already has the live transcript from
Vapi's client-side `message` events, so `agent-interview/submit-transcript`
(owner-JWT authorised, gym_id derived from the interview row rather than
trusted from the request) stands in for the phone path's webhook and runs
the same Claude distillation. A "Cancel" link on both a stuck phone call and
mid-interview marks the row discarded via the existing
`set_agent_interview_status` RPC. pgTAP: `agent_interviews`.

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

**Self-serve front-desk provisioning, phase 1 voice (0152, entitlement
defaults on since 0163).** A gym owner can turn the AI front desk on
without ever touching Vapi or Twilio — Temple owns both accounts and
provisions per gym on demand. `front_desk_entitled` defaults to `true`
(Temple charges a flat monthly fee per gym, not per-feature, so there's
no billing reason to gate this); `set_gym_front_desk_entitled`
(service-role only) is a manual off-switch for a specific gym, not
something a gym has to be granted. `provision-front-desk` buys a GB
local voice number under Temple's
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
secondary link), and the AI Agent tab's "Talk to your AI" hero, under its
Test tab.
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
starting over, and a brand-coloured "You're live" moment with the number,
a copy button, and an "Add to your website" chip linking to the website
builder, before returning to Leads. The former single
"Automation" page is split across two owner-only tabs in the Leads
section's left sidebar (`LeadsShell`/`LeadsNav`), ordered Leads → AI
Agent → Conversations → Settings (non-owners with `can_assign_plan` see
only Leads/Conversations). **Settings**
(`/management/leads/settings`) holds the operational/policy cards under
plain (non-collapsible) section labels — When A Lead Comes In
(assignment strategy + "text the coach too"), Lead Sources (opens the
same add/archive `SourcesEditorModal` the pipeline's source picker reads
from — no longer its own sidebar tab), Call Recording & Consent, Usage &
Data (usage stats, outcomes, daily message cap, conversation retention),
Data Retention (lead retention window). **AI Agent**
(`/management/leads/agent`) holds the assistant's behaviour and persona:
a "Talk to your AI" hero leads the page, with a Teach/Test tab switch
inside one container rather than two separate "talk to it" cards —
**Teach it** is the interview (step bar + large icon avatar carrying the
call → review → apply arc, plus a transient "Applied — the agent is live"
confirmation), **browser-only** — no outbound telephony, so teaching the
agent never touches the Twilio bill; the calling state itself reads as an
actual phone call (pulsing ring icon, live mm:ss timer, circular red
hang-up button) even though it's WebRTC under the hood. **Test it** is
the live sales assistant preview, offered two ways: in-browser (same
Vapi Web SDK call as the teach flow) and, once the gym has a live number,
a tap-to-call link that dials the gym's real AI Front Desk number —
useful for hearing exactly what a prospect hears over an actual phone
line, and the one path here that also works from the native app. Below
the hero: AI Front Desk (answer texts/calls toggles, number
provisioning, voice picker), **Share your number** (only shown once
the front desk is fully live — copy the number for emails/social bios,
"Open Google" to business.google.com so an owner can paste the number
into their Google Business Profile by hand (no API/OAuth — Google
requires per-listing owner consent to automate this, not worth
building until number churn makes manual upkeep a real problem),
"Open builder" to add the website's Call & text block, and "Copy embed
code" — a self-contained, inline-styled HTML snippet with tel:/sms:
links for a gym hosting its site off-platform, built by
`buildCallWidgetSnippet`), and Knowledge & Coaching (agent notes,
coaching rules), with the destructive "turn off & release number" card
in Danger Zone at the bottom.

### Member import

[`can_manage_staff`] Reachable from Manage → Members → "Import data"
modal → Members tab → Import members (`/management/members/import`), and
surfaced as an optional checklist step on the setup card. Drop a CSV from a
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

[`can_manage_staff`] Reachable from Manage → Members → "Import data"
modal → Workouts tab → Import workout history
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
Members-tab "Import data" modal lists **Import from Stripe** ahead of
the CSV importer on its Members tab. The overlap check only runs for owners (the `stripe-import`
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
- **Scheduled sends** — pick a time and the campaign goes out without
  anyone at a keyboard (`comms_schedule_campaign`, swept every 15 minutes
  by `dispatch_scheduled_campaigns` via pg_cron, 0183/0184). Everything
  that decides what goes out is frozen when it is scheduled, not when it
  sends — the compiled document (0183) plus subject, subject variants,
  audience and topic in `scheduled_snapshot` (0193) — so the editor stays
  live and late edits land on the next send, not this one. Status
  transitions are RPC-only: `authenticated` holds column-level UPDATE on
  the eleven fields the editor writes and nothing else (0194).
  Authorisation splits accordingly — the capability is checked at
  scheduling time, while a user exists, and the cron path authorises on
  the campaign row because `auth.uid()` is null under cron. A send stuck
  in `sending` for ten minutes is re-poked if recipients are still queued
  and closed out if none are (0187/0191).
- **A/B subject testing** — up to four subject lines per campaign (0185).
  Recipients are split evenly and deterministically at snapshot time, so a
  retry cannot put two subjects in front of the same person, and the
  report shows open rate per line — the only thing a subject can move.
- **Hand-picked audiences and saved segments** — `{"kind":"manual"}` has
  been in the resolver since 0044 with no UI to produce one; the builder
  now has a member picker, and saves the current audience under a name in
  `email_audiences` (also built in 0044, also never used).
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
sender identity / sending domain carry the send. Five triggers (0116, 0201):
`member_joined` (welcome, N days after joining), `member_first_class`
(follow-up after the earliest attended `class_bookings` row),
`member_inactive` (win-back after N days with no attendance), `lead_cold`
(nurture a still-cold, consented lead N hours after capture), and
`member_tagged` (`params.tag` names a member-tag label; fires N days after a
member gains that tag, whether added by hand or by a tag rule — anchored on
`member_tags.created_at`, which `0201` made stable by turning the recompute
incremental: surviving tags keep their row, so a nightly recompute can't make
old tags look freshly gained. Fired once per member per automation — the
idempotency key has no date segment, so losing and regaining the tag never
re-sends). Each trigger fires only for anchor events at or after the
automation's `created_at`, so enabling one never blasts the back-catalogue.

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
  reorder, duplicate, delete), for 10 block types: Hero, About, Class
  schedule, Pricing, Team, Testimonials, Photo gallery, Hours &
  location, Contact, Call & text. Schedule, Pricing, Team and Call &
  text are read-only content-wise — they render the gym's real class
  sessions, membership plans, staff roster and AI Front Desk number at
  view time (Pricing/Team can each hide specific rows without touching
  the source) rather than storing a copy, so none of the four can drift
  stale. Schedule rows are colour-coded by class type. **Call & text**
  (`gym_public_ai_phone`, 0162) shows the gym's live AI Front Desk
  number with tap-to-call/text links, and renders nothing on the public
  page unless the front desk is fully live (enabled, voice on, a number
  assigned) — a block advertising a number that won't answer would be
  worse than no block.
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
  just the gym name. Nav links are path-absolute (no origin), so they
  resolve on whichever host actually served the page (platform path or
  a connected custom domain) via `vercel.json`'s host-agnostic
  `/site/:slug/:page` rewrite; the hero's join CTA stays absolute to the
  platform origin on purpose (a relative `/join/<slug>` on a custom
  domain would land on the Expo app shell there, where Supabase auth
  redirect emails can't be allowlisted per-gym).
- **SEO** — a per-page `<link rel="canonical">`: Home points at the
  gym's verified custom domain when one is connected (via the new
  `gym_website_canonical_domain` RPC, migration `0161`, the anon-safe
  slug→domain mirror of `gym_slug_for_domain`), else the platform path;
  every other page is self-canonical, since a connected custom domain
  doesn't serve non-home pages yet. `canonicalPageUrl` (`site-blocks.ts`)
  is the single shared implementation of that Home-vs-subpage rule —
  both `api/site/[...path].ts` (the canonical tag) and
  `/site/<slug>/sitemap.xml` (`api/site-sitemap/[slug].ts`, so a
  connected custom domain's Home URL is what actually gets listed there
  too) call it, so the two can't drift apart. Each page also gained an
  optional owner-editable **meta title** (`SitePage.metaTitle`, "Search
  title" in the Pages manager, capped at 70 chars vs. the description's
  300) overriding the auto-generated `<title>` — which also drives
  `og:title`/`twitter:title`, since a page's `<title>` IS what a search
  result shows, there's no separate tag for it. **LocalBusiness (`ExerciseGym`)
  JSON-LD** renders once a location block's structured address is
  filled in — `LocationBlock` gained optional `street`/`city`/`region`/
  `postalCode`/`country` fields, separate from the free-text
  `address`/`hours` that still render on the page unchanged;
  `findStructuredAddress` (`site-blocks.ts`) scans the whole document
  for the first one (home page first), and emits nothing at all rather
  than a half-populated schema when neither `street` nor `city` is set.
  No `openingHoursSpecification` — the hours field is free text an
  owner can phrase however they like, and guessing a structured
  schedule out of it risked feeding search engines wrong hours.
  **Open Graph / Twitter Card tags** grew `og:type`, `og:site_name`,
  `og:url`; `og:image`/`twitter:image` fall back to the page's own hero
  photo when no gym logo is set (previously omitted entirely with no
  logo). A per-gym **`robots.txt`** (`/site/<slug>/robots.txt`,
  `api/site-robots/[slug].ts`) points crawlers at the gym's sitemap.
  Hero/About blocks gained an optional owner-editable `imageAlt` field
  (falls back to the gym name / block heading); About/Team images now
  render `loading="lazy"`. A `searchConsoleVerification` site setting
  (Theme & ownership panel) renders a `google-site-verification` meta
  tag so an owner can verify the site with Google Search Console and
  submit its sitemap.
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
- **Cover** [`can_request_cover`, `can_claim_cover`] — request cover by
  picking classes or a date range, claim other coaches' open offers
  (qualified-only), and a **Cover inbox tab** for the notifications.
  Full detail under Classes & scheduling.
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
- **Cover inbox tab** [`can_request_cover` / `can_claim_cover`] — cover
  requested / claimed / still-uncovered cards, the last in amber, each
  linking through to the Cover screen. Opening the tab marks them read.
  See Cover notifications under Classes & scheduling.

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
  pg_cron (`0095`). Cron-only since `0192`: it, the waiver purge and
  the payment purge were all reachable with the publishable key.
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

- **Nothing surfaces `cron_run_log`.** Every scheduled sweep now records
  what it did (0189/0190) — counts, durations, and for the two dispatchers
  the difference between "nothing to do" and "could not do anything". It is
  read from the SQL editor; there is no screen. `select job_name, ran_at,
  result from cron_run_log order by ran_at desc limit 40;` is the whole
  interface today.

- **Two capability toggles do nothing.** `can_issue_override` and
  `can_issue_comp_grant` are in the capability matrix and in the Team
  screen's editor (`team.tsx:69-70`), so an owner can grant and revoke
  them — but nothing reads either one, because neither action exists.
  `comp_grants` is read in four places (`MembersList`,
  `RemoveMemberDialog`, the member detail screen, `insights.ts`) and
  written by nothing at all: no client insert, no RPC, no migration.
  Either build the grant flow or take the toggles out; showing a switch
  that governs nothing is the worse of the two.

- **Some capabilities are enforced at the surface, not in RLS.** 105 of
  the 287 policies check `effective_can`; 45 still say
  `user_can_admin(gym_id)` or `user_is_owner_of(gym_id)` instead of the
  specific key, so revoking one of those from an admin changes what the
  app offers rather than what the database permits.
  `can_hard_delete` is the sharpest case: it gates the delete buttons on
  `class-types.tsx:180` and `plans.tsx:183` and appears in no policy at
  all. The DELETEs behind those buttons are authorised by
  `user_can_manage_classes(gym_id)` and `user_is_owner_of(gym_id)`, so
  revoking the capability hides the button and leaves the row deletable.
  The four of these that were also client-*writable* are now closed
  (0195): `plan_subscriptions`, `direct_messages`, `gym_announcements`
  and `class_sessions` each granted a table-wide write the client never
  issued, with an RLS policy that pinned the row but not the columns —
  the 0194 pattern. The revoke leaves the definer/service-role writers
  untouched. `plan_subscriptions` was the worst: its `user_can_assign_plan`
  guard is raw-role with no `left_at` guard, so a removed coach kept write
  access to every subscription's `status` and `price_cents`. What remains
  in this bullet is the read-and-surface-only set, where the grant is not
  writable and the gap is cosmetic.

- **The scheduled-send path has never run end to end.** Everything
  around it is proven — pgTAP covers the dispatcher, the Vault
  credential, the stall recovery and the snapshot — but no real campaign
  has gone from `scheduled` through `send-campaign` to a delivered
  Resend event, because the credential only landed on 2026-07-28.
  Schedule one to the demo gym a few minutes out and watch
  `cron_run_log` plus the report. Demo accounts are
  `@demo-ironworks.temple.test` — IANA-reserved, so nothing can route
  out of the building.

- **`profiles` is still one row for everyone in the gym.** `phone` moved
  to `member_contact_details` (0179) and `same_gym_as_caller` now requires
  the CALLER to be a current member, but `date_of_birth` still rides along
  on a row every gym-mate can read. It is read cross-profile by
  `useDependents` (a guardian reading their child's DOB), so moving it is
  its own change.
- Supabase preview branches + Vercel preview environments.
- Bigger themed BodyMap redesigns (Halloween / Christmas / Pride /
  New Year) — designs explored but parked.
- **Legal — a person, not engineering.** The DPIA and lawful-basis
  register are signed (2026-07-10), the placeholders are filled and the
  DRAFT banners are gone. What remains is a solicitor review of the ToS
  and DPA, and the consumer cancellation flow if a paid solo tier ever
  launches. See `docs/legal/README.md`.
