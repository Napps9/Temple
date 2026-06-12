# Temple — feature inventory

A snapshot of every feature live in the platform as of this writing.
Organised by **who** uses it. Capabilities in brackets show the
permission gate that controls visibility for staff features.

---

## Member-facing features

### Bookings & classes
- **Calendar (Day / Week / Month views)** — browse the gym's class
  schedule with class-type colour coding, coach avatars, capacity and
  remaining spots.
- **Quick-book recommendation** — surfaces the member's next eligible
  class of their most-attended class type; respects plan class-type
  allowlists, credit balance, paid period and active comp grants.
- **Next class card + My bookings** — combined tile showing the
  member's upcoming class plus a route into the full bookings list.
- **Waitlist** — automatic queue + promotion when a slot opens, honest
  rank shown to the member (computed over the full queue regardless
  of RLS).
- **Self-cancel bookings** — credits refunded according to the plan
  type (unlimited gets none; credit packs / comp grants do).
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

### Tracking & training
- **Workout journal** — every recorded session with date, title,
  programmed sections + recorded results, route into a detail view.
- **Record workout modal** — pre-fill from today's programming for
  the class types the member is permitted to see, then a
  format-driven entry form per section (For time / AMRAP / EMOM /
  Intervals / Strength sets / Max load / No score / Other).
- **Movement tagging** — at log time, tag a section with the
  movements it contained + a rep-max scheme so it counts on the
  movement / leaderboard.
- **Per-movement detail page** — rep-max best-of, full history merging
  direct PRs with section-tagged results, "session" badge.
- **Per-group page** — best-of per movement in a group (Squats,
  Pushing, Pulling, Cleans, Snatch, Aerobic, Bodyweight).
- **Leaderboards** — class-session leaderboards (for-time + AMRAP)
  and strength-movement leaderboards (rep-max per scheme), honouring
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
- **Inbox unread badge** — one number rolled up across DMs,
  announcements and broadcasts via `inbox_unread_summary`.

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
- **Class types editor** [`can_edit_classes`] — name, colour, recurring
  schedule (days, times, duration, capacity, end-on or indefinite),
  archive / restore / hard-delete.  **Archiving cascades**: blocks new
  bookings, new programming, future materialisation.
- **Recurrence materialisation** — schedules turn into individual
  sessions on the calendar, extended to a horizon.
- **Cover requests** [`can_request_cover` / `can_claim_cover`] — a
  coach can hand a class to another coach; first-claim wins; refunds
  and waitlist promotion handled correctly on cancellation. **Claims
  are gated on class-type qualification** — a coach explicitly
  disqualified for that class type can't claim it (enforced in the
  `claim_cover` RPC and surfaced as a disabled state in the UI).
- **Class detail modal** — roster, attendance marking (check-in / no-
  show / unmark), cover request, broadcast, leaderboard for that
  session.
- **Cancel session** — refunds credits, drops waitlist, deletes the
  session.

### Manage tabs

- **Gym setup checklist** (owner-only, auto-hides when complete) —
  shown above the tab strip on a new gym. Steps derived live from the
  data: add a logo, add a class type, schedule a class, set up health
  screening (a waiver **or** a PAR-Q satisfies it), create a membership
  plan, plus an optional invite-your-team step. Each step is a deep
  link to the page that completes it. The card disappears once every
  required step is done. Backed by `get_gym_setup_progress(gym_id)` so
  it never drifts from reality — delete a class type and the step
  flips back open.

The Manage page presents a tab strip:

- **Insights** [`can_see_insights`] — one date range driving every
  KPI: Revenue, Members, Attendance %, Intros new, Expiring soon,
  Expired, Paying, Conversion vs target. Each tile delta vs previous
  period.
- **Members** [`can_manage_tags`] — Attendance summary (Attended /
  No-show / Unmarked) by class type, **shareable signup link** card
  (Copy / Share, with archived state when public signup is off),
  searchable + filterable member list with PAR-Q badge, Injury badge,
  cohort badges (Intro / Active / Paying / Expiring / Expired), plan
  chips, tag chips; **Export members CSV**; **Tag rules** editor.
- **Team** [`can_manage_staff`] — staff roster with inline open-task
  + open-cover-request counts; per-coach earnings + class-type
  qualifications; SOPs card; Invite codes card (one-time codes to
  add owner / admin / coach / staff / member). Walk-in QR card
  encodes the public signup URL for the front desk; every issued
  invite code has a scannable QR pointing at `/accept-invite?code=…`
  so staff invites can be sent as a single image.
- **Plans** [`can_manage_plans`] — Unlimited / Credit period /
  Credit pack plans with monthly price + notice period (days);
  Class-type allowlist per plan; Archive / Restore / Hard delete
  with dependent-row protection.
- **Settings** — collapsible cards:
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
  and Acknowledge actions.

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
- **Access audit trail** — `health_data_access_log` records every
  health-data view / erase / purge with actor, subject, surface and
  timestamp, admin-readable only. Staff health surfaces call
  `log_health_data_access` on open.

> Still pending (needs legal / DPO input, not engineering): formal
> lawful-basis sign-off + DPIA, the consent-text legal copy, and
> scheduling the purge job in the hosted environment.

---

## Technical platform features

- **Auth** — Supabase email/password with a consent gate + annual
  PAR-Q gate; invite codes for onboarding.
- **RLS everywhere** — every table is gated, every dangerous write
  is funnelled through a `security definer` RPC with explicit
  authorisation.
- **Cloud-only dev workflow** — push to main → CI (tsc + 297 vitest
  + 62 pgTAP files / ~178 assertions) → migrations auto-deploy to the
  hosted Supabase project → Vercel auto-deploys Production.
- **Vercel rewrites for dynamic routes** — `/join/:slug`,
  `/track/movement/:movement`, `/track/group/:group`,
  `/track/workout/:id`, `/inbox/direct/:peer`,
  `/management/members/:profile`.

---

## Roadmap / not yet shipped

Items the conversation has flagged but not implemented yet:

- **Health-data GDPR — policy-dependent remainder**: formal
  lawful-basis sign-off + DPIA, the consent-text legal copy, and
  scheduling `purge_expired_health_data()` in the hosted environment
  (pg_cron / nightly job). The engineering surround (consent gate,
  erasure, retention sweep, audit log) has shipped.
- Health-data reads hardened to definer-function access (today the
  audit log is written by the app surfaces, not enforced at the row
  level for raw API calls).
- Supabase preview branches + Vercel preview environments.
- Bigger themed BodyMap redesigns (Halloween / Christmas / Pride /
  New Year) — designs explored but parked.
