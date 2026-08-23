# Temple — what it is and what's built

A multi-tenant gym SaaS. Owners run their gym, staff coach, members book
and train. Web-first via Vercel, with native iOS/Android sharing one
React Native codebase.

**The governing idea:** the chat is the spine, containers are the hands.
The Timeline replaces the admin, not the tools. A screen survives where
craft, judgement or evidence lives — writing programming, running a class,
listening to a call, signing a waiver. A screen dissolves when it exists
only so a human can operate machinery.

**Scale:** 246 migrations · 256 pgTAP files · 41 edge functions · 92 app
screens · 66 sentences · 7 jobs · 12 cron jobs · 1,630 JS tests across 108
files.

---

## The member app

Everything a member touches, and none of it changed by the above — members
feeding the system its data is what makes every loop possible.

- **Booking** — calendar and agenda views, quick-book recommendation,
  waitlist with automatic promotion, multi-membership picker, family
  accounts. Booking windows, cancel cutoffs and credit forfeiture are
  per-gym rules enforced in SQL.
- **Track** — training journal, live recorder, PR badges, sparklines, 1RM
  percentages, streaks and a heatmap, a movement library, leaderboards,
  Hyrox mode. Sold as a separate athlete tier; the full history is
  exportable free regardless of subscription.
- **Athlete mode** — the tracking product standalone, for people without
  a gym.
- **Programming** — the member's view of what's written, with percentage
  chips resolved against their own numbers. Individual programming where
  their plan includes it.
- **The rest** — DMs, announcements, an inbox, self-serve membership and
  plan changes, the store, email preferences, injury tracker.
- **Consent, waivers and PAR-Q** — signed by the member's own hand, and
  permanently a screen for that reason.

---

## The staff side

### The Timeline — the staff home

One chronological stream per gym, unioned server-side from what already
happens: someone joined, a payment failed, the front desk took a lead, a
class needs cover, the gym closed, a campaign went out, a job proposed
something. Gated per kind by capability. Below it sits the talk bar.

### The bar — 66 sentences

Say what you want; a card asks before anything happens. Every verb is one
entry in a registry (`src/lib/actions/`) with its own sanitiser, preview
and apply, so a new verb is a file entry rather than a branch in a screen.

| | Verbs |
|---|---|
| **Classes** (12) | attendance, uncovered, book/remove a member, cancel, move, edit, set coach, request cover, rename/retire/restore a class type |
| **Gym** (7) | change rules, add classes, add plans, close dates, reopen, rename, set colour |
| **Programming** (7) | block out, move/drop a block, clear a day, copy a week, set access, who is programmed |
| **Comms** (6) | draft a newsletter, schedule, cancel, stop a send, describe a sequence, send report |
| **Members** (6) | find, assign a plan, comp, tag, message, who has gone quiet |
| **Leads** (4) | add, set status, assign, pipeline |
| **Store** (4) | add a product, set price, refund an order, sales |
| **Team** (4) | invite, set role, remove, who |
| **Money** (3) | summary, set a plan price, refund |
| **Plans** (3) | retire, restore, include programming |
| **Tags** (3) | rules, add a rule, remove a rule |
| **System** (2) | find a screen, what nobody opens |

Questions draw their numbers through one answer vocabulary — a figure, a
short series, a ranked list — so a new question needs no new renderer.

### Seven jobs that act

Each runs on a rope the owner controls: **reserved** (off), **approval**
(a question with exactly two choices and its evidence behind "see the
details"), or **autonomous**. "Always allow this" flips a job to
autonomous in the same transaction as the approval, so the graduation is
itself a ledgered decision. Hard rules live in SQL, never in a prompt.

1. **Payment recovery** — chases a failed payment with the member's pay
   link, then offers a smaller plan if Stripe gives up.
2. **Keeping members** — notices somebody who has gone quiet.
3. **Finding cover** — nudges the coaches who could claim an uncovered class.
4. **The first week** — somebody who joined and has never been in. Never
   anyone imported from another platform, who may have trained for years.
5. **The last few classes** — a pack running out, while they're still training.
6. **The wrong plan** — a pack costing more than a membership would, said
   at the moment they're about to spend again.
7. **The class that is emptying** — a slot that has thinned out, and an
   offer to ask back the regulars who stopped coming *but still train
   here*. The first job about a class rather than a person, and the first
   whose one approval sends up to twelve emails.

Shared guards: one daily ask budget across the five "noticing" jobs, so no
gym meets eighteen questions; quiet hours enforced at the send, not at
approval; a rejection ends that case's asks; nobody is ever cancelled and
no discount is ever invented.

### Running the gym

- **Classes** — calendar, class detail with roster, check-in, waitlist,
  session leaderboard, message-class. Recurrences materialise lazily.
  Closures cancel, refund and tell everyone; reopening puts it all back.
- **Programming** — the calendar editor for class and individual
  programming, a classifier that reads what the coach wrote, percentages
  resolved per member, named blocks and a year view.
- **Members** — roster, profiles, cohorts, tags and auto-tag rules,
  comps, plan assignment, attendance.
- **Money** — plans and credit packs, Stripe Connect checkout and
  subscriptions, dunning, refunds with four modes and real arithmetic,
  coach pay rates and earnings.
- **The store** — products, variants, stock, digital delivery,
  subscriptions, orders and fulfilment.
- **Comms** — campaigns with a block editor, audiences, topics, member
  preferences, automations, real delivery reporting.
- **The AI front desk** — a lead agent that answers calls and messages,
  with conversation review and call QC.
- **Switching platforms** — CSV, workout-history and Stripe importers
  with AI-assisted plan and tag inference, a double-bill guard, and
  corrections that teach the inference.

### The Roster

People and Temple's jobs side by side — each job with its rules, its
rope, and what it will never do.

---

## Underneath

- **RLS on every table.** Dangerous writes go through `security definer`
  RPCs that do their own authorisation.
- **A capability matrix** — per-role and per-person overrides resolved by
  `effective_can`, governing every staff-visible feature.
- **Health data (GDPR Article 9)** — PAR-Q and injury data are special
  category. A consent gate at app entry, erasure on leaving and on
  request, a 3-month retention sweep, and an access log every staff
  health surface writes to. Waivers sit deliberately outside the erasure
  sweep: they're liability records, lawful basis defence of legal claims.
- **Delivery is a fact** — a signed Resend webhook, a suppression list
  subtracted from every audience and honoured by all six senders, and
  reports that say "not measured" rather than 0% when nothing came back.
- **Trunk-based CI** — push to `main`, then typecheck + 1,630 tests,
  then the full pgTAP suite against a real Supabase, then migrations
  deploy to the hosted project, then Vercel.

---

## How it's tested — and what that does not cover

| Level | Count | Proves | Blind to |
|---|---|---|---|
| **pgTAP** | 256 files | RLS, RPC authorisation, capability enforcement, job predicates, triggers — against a real Postgres in CI | Anything above SQL |
| **vitest, logic** | 1,619 | Copy, sanitisers, preview arithmetic, the manifest, the answer vocabulary | Anything rendered |
| **vitest, render** | 11 | Content and branching in components — right tiles, right copy, right conditional | **Layout.** NativeWind is stubbed so `className` is inert; no width, wrapping or overflow is computed |
| **tsc** | — | Types line up | — |

**Nothing has ever exercised the running product.** No test signs in, no
test loads a screen against a real database, and no job has proposed
anything about a member who was not a fixture.

The proof is the bug that prompted this: `StatTile` broke "RECIPIENTS"
across two lines mid-word on six screens. 1,630 tests pass over it. A
human found it by looking at a screenshot.

**The render harness is new and was the bigger unlock.** There was no
vitest config at all, which is *why* 92 screens had no tests — anything
importing `react-native` failed to parse. Aliasing to `react-native-web`
(what Vercel already serves) fixed it, and removed a second constraint
that had shaped design decisions: modules importing `lib/supabase` are
testable now, so splitting one in half to test its logic is a choice
rather than a requirement.

**A gym with a clock** (`scripts/demo-gym/simulate.ts`) is the answer to
the question unit tests cannot reach: does a month of this feel like
help? It generates days of plausible activity from member personalities
— `regular`, `twice_weekly`, `weekender`, `drifting`, `sporadic`,
`never_started` — seeded so a bad month replays exactly. It found two
things before touching a database, both now pinned as tests:

- **A twelve-person slot can never trigger the class-return job.** It
  averages 3.75 a session against a floor of four. The floor is right;
  the consequence is that a small demo gym shows the job on and silent
  forever, and anyone would conclude it was broken.
- **A loyal core hides a large loss.** Sixteen people drift from a slot:
  with four regulars left the job speaks up, with six it does not. Same
  sixteen gone. Whether that is correct is a product question, and it is
  now a decision rather than a number somebody nudges.

Three documents carry the rest: `docs/testing-plan.md` (a manual session
of sentences, per module), `docs/running-a-gym.md` (the simulation plan
and what is still to build), and the roadmap's *Known and not yet fixed*.

## How it's kept honest

The habits that have caught the most, in order of how much they've caught:

- **Audit before building.** Four surfaces in a row were already half
  built; the burndown itself turned out to be counting the wrong thing.
- **Guard tests that assert against reality**, not against a list — every
  cache key names a real query, every claimed move names a real action,
  every action is uniquely named. Each has caught a real mistake.
- **Prove a test can fail.** A new pgTAP file gets run against the *old*
  definitions to check it discriminates.
- **Write down what you can't fix**, with the reasoning for why not.

One bug has been found eleven times in different clothes: **a switch an
owner can see and a server that ignores it.** It runs both ways — a grant
that doesn't reach the write, or a revocation that doesn't. Nine are
fixed; two are documented with the reasoning for leaving them.

---

## What's left

- **Phase 5: 9 routes retired, 1 owed.** The last is blocked on a product
  decision, not on work: whether anyone but the owner can change how the
  gym runs.
- **Four known issues**, all written down, none urgent.
- **Nothing measures the second measure.** "Routes retired" is asserted by
  a test. "Owner interventions per member per month" is a sentence in a
  document — every job aims at it and none is scored against it.
- **No gyms yet.** All of the above is scaffolding until one real gym runs
  a week through it.
