# CRM / Retention surface — codebase reconnaissance (NOTES, read-only)

> Research notes only. No code, schema, or product changes were made in
> producing this. Every claim cites a file / table / column / migration.
> Written to answer one question: *what do we already have, where does it
> live, and what's missing* — for a possible consolidated retention/CRM area.
> UK English.

---

## 1. Stack overview

- **App**: Expo Router (Expo 56) on React Native + React Native Web. Routes
  live under `src/app/`, grouped into three route groups:
  `(auth)/`, `(member)/`, `(staff)/`, plus a top-level `athlete/` area and a
  root `index.tsx`/`onboarding.tsx`. `_layout.tsx` files define nav.
- **Client data**: `@tanstack/react-query`. The single Supabase browser
  client is `src/lib/supabase.ts`; screens either `.from(<table>).select()`
  (read, RLS-scoped) or `.rpc(<fn>)` (writes, almost always through a
  `security definer` function).
- **Backend**: Supabase — RLS Postgres, Storage, Auth. **Schema is
  migration-driven**: `supabase/migrations/NNNN_*.sql`, append-only, numbered
  0001 → 0115. A hand-maintained TS mirror lives in `src/types/database.ts`
  (3,973 lines). Server-side compute that can't be a SQL function lives in
  Deno **edge functions** under `supabase/functions/` (18 of them, incl.
  `send-campaign`, `send-lead-notifications`, `stripe-webhook`).
- **Business logic** is split deliberately: dangerous writes + tenant
  authorisation in SQL `security definer` RPCs; pure derivations (cohort
  classification, recommend scoring, streaks) in `src/lib/*.ts`, unit-tested
  with vitest and, where they mirror SQL, run against shared fixtures to
  prove SQL↔TS parity (e.g. `src/lib/insights.ts` mirrors `v_member_cohort`).
- **Tests**: vitest (JS/TS) + pgTAP (`supabase/tests/*.sql`, ~90 files).
- **Deploy**: trunk-based, push-to-`main`; CI → hosted migration deploy →
  Vercel. `middleware.ts` at repo root handles custom-domain rewrites.

**One-paragraph structure summary.** Temple is a multi-tenant gym SaaS where
every row is `gym_id`-scoped and guarded by RLS; near-all mutations funnel
through `security definer` RPCs that re-check tenancy via helpers like
`user_belongs_to`, `user_can_assign_plan`, `user_is_owner_of`. The member's
world (`(member)/`) is book / track / inbox / account; the staff world
(`(staff)/management/`) is a tab strip (Insights, Members, Team, Plans,
Comms, Store, Website, Settings, Leads). Retention-relevant primitives —
cohort classification, leads, a lifecycle-aware email suite, an insights KPI
RPC, pg_cron sweeps — **already exist but are scattered across those tabs and
were each built for a different job**; none of them is assembled into a
"who's about to churn and what do I do about it" surface.

---

## 2. Data inventory (CRM-relevant)

| Concern | Table(s) & key columns | Written by | Surfaced in UI |
|---|---|---|---|
| **Member identity / contact** | `profiles` (`id`, `full_name`, `phone`, `avatar_url`) — **no email here**; email lives in `auth.users.email` and is only exposed via `can_manage_comms`/`can_export_members`-gated definer RPCs. Health denorm on `gym_memberships` (`health_flag`, `emergency_contact`, `par_q_id`, added 0008). | Auth signup → `on_auth_user_created` trigger; `record_consent`; account screen. | `(member)/account.tsx`; staff `management/members/[profile].tsx`. |
| **Membership relationship / state** | `gym_memberships` (`gym_id`, `profile_id`, `role` ∈ owner/admin/coach/staff/member, `created_at`, **`left_at`** = soft-delete). Original `status` column was **dropped** in 0008 — state is now derived, not stored. | `join_gym_by_slug`, `accept_invite`, `create_dependent`; `leave_gym` sets `left_at`. | Members list + profile; roster. |
| **Billing lifecycle** | `plan_subscriptions` (0008): `status` (`plan_sub_state` enum: pending/active/paused/cancelled_at_period_end/lapsed/cancelled/refunded_retained — **no `past_due`**), `paid_period_end`, `credit_balance`, `stripe_subscription_id`, `notice period`. `comp_grants` (0009): `starts_at`/`ends_at`/`revoked_at`. `billing_events` (0010): immutable Stripe ledger, `kind`, `amount_cents`, `occurred_at`. | `stripe-webhook` (service role); `staff_book_member`, comp RPCs. | `(member)/membership.tsx`, `purchases.tsx`; staff `billing.tsx`, `plans.tsx`; member profile shows plans + expiry. |
| **Class-pass balance** | `plan_subscriptions.credit_balance` (non-negative CHECK); comp credits on `comp_grants`. | Booking burn/refund triggers on `class_bookings` (0065); webhook resets on renewal. | Membership self-view; booking picker (`list_booking_entitlements`). |
| **Leads / enquiries** | **Yes — a full lead concept exists.** `leads` (0056): `full_name`, `email`, `phone`, `source_id`, `status` (`lead_status` enum: cold→contacted→intro_booked→trial_attended→converted\|lost), `captured_at/by`, `converted_at`, `converted_profile_id`, `archived_at`. 0114 added `assigned_coach_id`, `assigned_at`, `marketing_consent`, `consent_at`, `lawful_basis`, `consent_policy_version`. `lead_sources` (per-gym vocab). `lead_assignment_rules` (round_robin/single_default/manual). `lead_notifications` (audit+queue backbone). | `record_lead` (staff), `capture_public_lead` (anon, 0064/0114), `assign_lead`, `set_lead_status`. | `management/leads.tsx`, `leads/settings.tsx`; public `(auth)/lead/[slug].tsx`; auto-attribute on signup (0057). |
| **Bookings & attendance** | `class_bookings` (0006): `class_session_id`, `profile_id`, `created_at`, unique(session,profile). 0013 added `attended_at`, `no_show`, `no_show_marked_at`, `booked_by_profile_id`, index on `(gym_id, attended_at) where attended_at is not null`. `class_sessions` (0003): `starts_at`, `class_type_id`, `capacity`, `coach_id`. Waitlist separate. | `book_class`/`_book_class_for`, `staff_book_member`; check-in RPCs set `attended_at`. | `(member)/book.tsx`, `bookings.tsx`; staff `attendance.tsx` (gym-wide buckets), class detail roster. |
| **Workout / performance (WODBoard)** | `tracked_workouts` (parent, `profile_id`, `performed_at`, `gym_id` nullable for solo), `tracked_workout_sections`, `tracked_section_entries`, `tracked_movement_results` (`track_key` e.g. `1rm`), `tracked_hyrox_races`/`_splits`. **Self-only RLS, keyed by `profile_id`, membership-independent** — history survives `leave_gym`. | Record modal; importer `import_member_workouts`. | `(member)/track/*`; PR badges, sparklines, 12-wk heatmap; coach sees via `can_see_workout_logs` on member profile + `analysis.tsx`. |
| **Comms / notifications** | **Email suite**: `email_campaigns`, `email_audiences` (saved segments, `definition` jsonb), `email_recipients`, `email_topics`, `email_unsubscribes`, `gym_sending_domains` (0044/0048/0058). **Lead notifications**: `lead_notifications` (0114). **In-app only**: DMs, `gym_announcements`, class broadcasts, `staff_alerts`; rolled up by `src/lib/notifications.ts` → nav bell. **No transactional email/push** except campaign + lead-notify + invite + receipts. | `comms_send_campaign` → `send-campaign` edge fn (Resend, simulated w/o key); `enqueue_lead_notifications` → `send-lead-notifications`. | `management/communications/*`; member `email-preferences.tsx`; inbox. |
| **Automation / jobs** | **pg_cron** (4 jobs): `purge-expired-health-data` (0095, daily), `purge-expired-waiver-signatures` (0109, weekly), `run_security_monitor` (0112, every 15 min), `purge-expired-leads` (0115, daily). Client-invoked **edge workers** drain queues best-effort. **No general job-runner / workflow / scheduler abstraction** — cron jobs are hard-coded single-purpose sweeps; Postgres makes no outbound HTTP by convention (0114 header comment). | Migrations register cron; `stripe-webhook`, `send-*` edge fns. | Not user-facing (infra). |

---

## 3. Signal audit for at-risk detection

Verdict shorthand: **Captured** = raw data exists · **Queryable** = clean to
read today · **Derivation** = data exists but needs computing · **Missing**.

1. **Booking-frequency decay (vs member's own baseline)** — **Captured,
   needs derivation.** Raw attended history is queryable per member
   (`class_bookings` filtered `profile_id` + `attended_at is not null`,
   indexed; see `src/lib/notifications.ts` `useLogNudge` doing exactly this
   over a 3-day window). But **no per-member frequency or rolling baseline is
   computed anywhere**. `src/lib/attendance.ts` aggregates **gym-wide** by
   class-type and by day, not per member. No "last visit", "sessions/week",
   or "vs their own average" concept exists (grep for `last.seen`, `baseline`,
   `decay`, `churn`, `at_risk` returns nothing product-relevant). This is the
   biggest derivation gap.

2. **Attendance streaks breaking** — **Captured, self-only.** Streak logic
   exists but only member-side and workout-based: `src/lib/workout-streak.ts`
   (`workoutStreak`, `weekStreak`, `sessionsThisMonth`) drives the member's
   own 12-week heatmap from `tracked_workouts`, self-only RLS. There is **no
   attendance-streak computation for staff**, and workout logs are self-only
   (staff need `can_see_workout_logs` and read one member at a time). No
   "streak just broke" event or query.

3. **Membership expiry / renewal approaching** — **Queryable today.** This is
   the one at-risk signal that's first-class. `v_member_cohort`
   (0014) computes `days_until_expiry` (min across active
   `plan_subscriptions.paid_period_end` and live `comp_grants.ends_at`) and
   `is_expiring_soon` (0–7d, window configurable via
   `gyms.expiring_within_days`), plus `is_expired`. Surfaced on the member
   profile as an "Expires in Nd" badge (`members/[profile].tsx:330`), counted
   on Insights (`compute_insight_summary` → `expiring_soon`/`expired`), and
   already a comms audience cohort + tag-rule predicate. Renewal-approaching
   ≈ `is_expiring_soon`.

4. **Performance plateau / drop-off in tracked workouts** — **Captured, no
   plateau detection.** Per-movement trend primitives exist
   (`src/lib/movement-trend.ts` `trendPoints`/`normaliseForPlot`; PR logic in
   `movement-journal.ts` `prRowIds`; `analysis.tsx` shows per-movement member
   trends to coaches). But these render *progression*; **nothing flags a
   plateau or regression** as a churn signal, and the data is self-only RLS,
   so a gym-wide "who's stalling" query would need new definer access + new
   derivation. Effectively missing as a retention signal.

5. **Payment failures / declined mandates** — **Largely missing / invisible.**
   Two concrete gaps:
   - `billing_events` only records **successes** (`kind` in
     `charge.succeeded`, `invoice.paid` — grep of migrations + functions
     confirms no `invoice.payment_failed`/`charge.failed` writer).
   - The `plan_sub_state` enum has **no `past_due`**, and in
     `stripe-webhook`, `customer.subscription.updated` is a **no-op for
     membership subs** (`index.ts:741` — it only syncs `store_subscriptions`).
     The `past_due` mapping at `index.ts:258` is inside
     `ensureStoreSubscription`, i.e. **store** subs only. A failing
     membership mandate therefore leaves no trace until Stripe finally emits
     `customer.subscription.deleted`, which flips the sub straight to
     `cancelled`. So "member's card is failing" is not observable in-app
     today for memberships.

---

## 4. Information-architecture map

**Top-level areas** (from `src/app/`):
- `(auth)/` — sign-in, get-started, create-gym, join/[slug], **lead/[slug]**
  (public enquiry), accept-invite, start-solo.
- `(member)/` — book, bookings, programming, track/*, inbox/*, membership,
  purchases, store, account, consent/parq/waiver/family/injury-check.
- `athlete/` — gymless users.
- `(staff)/` — programming, classes, analysis, and **`management/`** tab strip.

**`management/` tabs** (the staff cockpit, `management/_layout.tsx` +
`index.tsx`): `index` (Insights), `members` (+ `members/[profile]`, imports),
`membership-requests`, `team`, `plans`, `billing`, `communications/*`,
`store`, `website/*`, `tasks`, `sops`, `coach-earnings`, `attendance`,
`cover`, `leads` (+ `leads/settings`), `tags`, `parq`, `messaging`,
`branding`, `leaderboards`, `operating`, `class-types`, `hours`.

**Where the retention-relevant pieces live today (scattered):**
- **Leads / pipeline** → `management/leads.tsx` (reached via Manage → Members
  → Leads) + `leads/settings.tsx` (automation) + public `lead/[slug]`.
- **Member records + cohort badges** → `management/members.tsx` (filter by
  cohort: Intro/Active/Paying/Expiring/Expired) and `members/[profile].tsx`.
- **Lifecycle segments for outreach** → `management/communications/*` (the
  email suite; audience resolver `comms_audience_rows` already supports
  `cohort` kind over `is_intro/is_active/is_paying/is_expiring_soon/is_expired`
  + `tag` kind — 0044).
- **KPIs** (Revenue, Attendance %, Expiring soon, Expired, Retention rate,
  Conversion, Lead conversions) → Insights = `management/index.tsx` +
  `compute_insight_summary` (0102).
- **Auto-segmentation** → `tag_rules` (0013): predicates
  `intro/expiring_soon/expired/paying/inactive/never_paid`, materialised by
  `apply_tag_rules`, edited at `management/tags.tsx`.
- **Nudges (in-app only)** → `src/lib/notifications.ts` rolls up DMs, injury
  check-ins, log-nudges, staff alerts, unread lead notifications into the nav
  bell. All member/staff-inbox; none is a retention workflow.

**Natural home?** The building blocks are real but **cut across at least four
surfaces**: Leads (Members sub-page), Members (list + profile), Insights
(`index`), and Communications. The lifecycle vocabulary is already unified in
**one place** — `v_member_cohort` — and three consumers (Insights, tag rules,
comms audiences) already read it, which is the strongest existing seam. There
is no single screen that shows a member's lifecycle state *and* their
recent-activity signal *and* a next action. (Description only; no IA proposed,
per scope.)

---

## 5. Per-job feasibility (gap read only — no design)

### Job 1 — Lead → coach pipeline (capture → assign → notify → track)
**Almost entirely built.** Capture: staff `record_lead` + anon
`capture_public_lead` (with 30-day dedup + marketing consent). Assign:
`assign_lead` (deterministic least-loaded round-robin, `single_default`,
`manual`; owner-configured `lead_assignment_rules`; owner/admin fallback so a
lead is never dropped). Notify: `enqueue_lead_notifications` writes in-app
(instant, drives `count_unread_lead_notifications` nav badge) + queued email
(drained by `send-lead-notifications`, idempotency-keyed) + SMS **seam**
(`gyms.lead_sms_enabled`, stubbed `skipped`). Track: fixed status pipeline +
per-source attribution + Insights "Conversions by source" + retention purge
(`purge_expired_leads`, 0115).
**Gaps:** SMS provider unwired; email delivery is *simulated* without
`RESEND_API_KEY`; no scheduled/automated follow-up cadence beyond the manual
`nudge_lead` + a "Needs follow-up" filter (cold + untouched >24h); no
lead-side booking of the intro session (intro_booked is a manual status, not
linked to a `class_booking`).

### Job 2 — At-risk detection + a nudge
**Partial — detection is the weak half.** What exists: expiry/renewal
(`is_expiring_soon`, `days_until_expiry`) is clean and already segmentable;
comms can already target the `expiring_soon`/`expired` cohorts; tag rules can
auto-tag them. What's missing: (a) **no engagement/attendance-decay signal**
per member (§3.1/§3.2 — needs new derivation over `class_bookings`, and a
staff-visible query since attendance is queryable but not aggregated per
member); (b) **no payment-failure signal** (§3.5 — needs a webhook change to
capture `past_due`/failed events, which doesn't exist yet); (c) **no
"nudge" primitive aimed at a member** — every current nudge is in-app to the
member themselves or to staff; there's no "flag this member to their coach"
or scheduled outbound. Transactional/scheduled send infrastructure exists in
spirit (Resend via edge fns, pg_cron for timing) but no wiring targets an
individual at-risk member.

### Job 3 — Renewal / reactivation
**Data present, workflow absent.** Renewal timing is derivable
(`paid_period_end`, `days_until_expiry`, `is_expiring_soon`) and the change
machinery exists (`stripe-modify-subscription`, `membership_change_requests`,
self-checkout). Reactivation targets are identifiable (`is_expired`;
`gym_memberships.left_at is not null`; `ever_had_plan/comp`; the importer's
`pending_members` for never-activated). Outreach rails exist (comms cohorts
`expired`, tag rules). **Missing:** any *triggered* renewal reminder or
win-back sequence — no scheduled job reads `is_expiring_soon` and sends
anything; a `left_at` member drops out of `v_member_cohort` entirely (the
view filters `role = 'member'` and is "today"-shaped, and expired-cohort
membership depends on `is_active` being false while the row still exists), so
a *long-lapsed* ex-member is not a standing, queryable "reactivation" segment
without new derivation.

---

## 6. Open questions / unknowns

- **Ex-member reachability for win-back.** After `leave_gym`, health data is
  erased and the membership carries `left_at`; `v_member_cohort` filters to
  `role='member'` and is "as of today". Unclear whether a lapsed ex-member
  remains a durable, queryable reactivation segment or effectively falls out
  of every existing surface. Needs a closer read of `leave_gym` + what
  survives (`billing_events.member_id` is retained as a tombstone).
- **Email consent for lifecycle sends.** Member email is gated behind
  `can_manage_comms` RPCs and honours `email_unsubscribes` (blanket + per
  `email_topics`). Whether retention/renewal nudges are "transactional"
  (exempt) or "marketing" (suppressible) under the current topic model is a
  policy call not settled in code.
- **Payment-failure capture is a real webhook gap, not just un-surfaced.**
  Confirming intended behaviour: is membership `past_due` deliberately
  unhandled, or an oversight? (`stripe-webhook` `customer.subscription.updated`
  is a no-op for membership subs; `plan_sub_state` lacks `past_due`.)
- **Attendance baseline definition.** No existing notion of a member's
  "normal" cadence. Any decay signal needs a defined window/threshold; none
  is implied by current data shapes.
- **Solo/athlete rows.** `tracked_workouts` with `gym_id = NULL` (solo
  athlete tier) are self-only and gym-invisible — confirm they're out of
  scope for any gym-side retention signal.
- **`is_paying` semantics.** `has_ever_paid` reads `billing_events` (only
  `charge.succeeded`/`invoice.paid`). Imported/adopted subs and comp-only
  members may never produce a billing event, so `is_paying` can understate —
  relevant if a retention surface keys off "paying".
- **Scale of per-member derivation.** Cohort + any decay signal is currently
  computed row-at-a-time in a view / client; whether that holds for a
  gym-wide at-risk list (hundreds–thousands of members) without a
  materialised layer is untested.
