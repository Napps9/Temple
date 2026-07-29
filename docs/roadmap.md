# The Temple roadmap

What keeps its screen, what moves into the Timeline, and in what order.
Companion to `docs/vision.md` (the argument), `docs/how-temple-works.md`
(the product on one page) and `docs/loop-1-payment-recovery.md` (the
first loop's engineering). This document is a full review of
`docs/feature-inventory.md` — every live area is accounted for below, so
the migration can't quietly orphan something that works today.

## The sorting rule

The Timeline replaces the admin, not the tools. A screen survives when it
is where craft, judgement or evidence lives — writing programming, running
a class, listening to a call, signing a waiver. A screen dissolves when it
only exists so a human can operate the machinery — settings forms, queues,
wizards, dashboards that end in a human doing the work. The machinery
itself (the RPCs, workers, crons and RLS) survives everything: it becomes
the loops' sensors and hands.

Every live feature lands in one of four dispositions:

1. **Keeps its screen** — the interface stays as it is, same look and
   feel, assembled from the same component kit. It may gain context (the
   programming block strip) or lose admin invisibly (auto-tagging), but
   nobody relearns anything.
2. **Moves to the Timeline** — the interaction becomes a sentence you
   say, a question with two choices, or a one-line receipt. The screen it
   replaces demotes to the Back Office and burns down from there.
3. **Splits** — the routine path becomes conversational; the full screen
   survives one tap deeper for the deep dive or the pixel-level control.
4. **Retires** — absorbed by a loop or deleted outright.

## The inventory, sorted

### The member app — keeps its screen, wholesale

Booking (calendar, agenda, quick-book recommendation, waitlist,
multi-membership picker), Track (journal, recorder, PR badges,
sparklines, 1RM percentages, streaks and heatmap, movement library,
leaderboards, Hyrox mode), the injury tracker, DMs, announcements and the
inbox, the programming view with percentage chips, individual
programming, self-serve membership and plan changes, the store, email
preferences, family accounts, athlete mode. All of it stays exactly as it
is — members feeding the system its data is what makes every loop
possible, and it already works. Anything new on the member side is
additive (a push nudge as the teammate's voice, a milestone message),
never a redesign. The consent, waiver and PAR-Q signing flows keep their
screens permanently: a member's own hand is the point.

### Running classes — keeps its screen

Today (the class calendar in its current look), the class detail modal —
roster, check-in, waitlist, the session leaderboard, message-class,
add-member, switch-plan. The admin evaporates *in place*: everyone booked
marks as attended unless the coach unticks them, no-shows resolve after
class, and the patterns flow to the retention loop on their own. The
coach's screen doesn't change; the transcription work inside it
disappears.

### Programming — keeps its screen, gains the roadmap

The calendar editor stays the writing surface, for class programming and
individual programming both. Already-invisible admin stays invisible: the
classifier reads what the coach wrote, percentages resolve to each
member's numbers. The one addition is the roadmap — named blocks, the
strip above the week, the Year view, share with coaches — built inside
the editor from the same kit. **Splits**: the Analysis page. Its verdicts
become Timeline messages with hands ("Thursday is shoulder-heavy right
after Tuesday's push day — want a swap?"); the full page survives in the
Back Office for the deep dive. Bought programming (PRVN, Mayhem) pastes
in chat and lands in the editor as a draft.

### Classes and operations — the changes become sentences

The class-types editor, recurrence rows, bulk-edit picker, closure and
reopen flows all **move to the Timeline** as interactions: "close the gym
22 December to 3 January", "cap Saturdays at 20", "add a 7am Wednesday
spin class" — each answered with a preview and one question. The editors
demote to the Back Office; the machinery underneath (materialisation,
closure suppression, refund-and-tell-everyone, the schedule-splitting
arithmetic) is exactly what makes a sentence trustworthy, and none of it
changes. Day-one setup already works this way in `/setup`; this phase is
the ongoing version.

### The Manage cockpit — mostly moves, two splits

- **Settings and branding** — every settings card becomes the rule sheet:
  the same sentences-with-tappable-values surface `/setup` already
  builds, permanent, so "make the cancel cutoff 2 hours" works for the
  life of the gym. **Moves.**
- **Plans and billing** — creating and changing memberships is a sentence
  with a preview card ("Unlimited is £89 with 30 days notice"); the plans
  editor demotes. Stripe connection health becomes a go-live check and a
  Timeline receipt when something needs attention. **Moves.**
- **Membership change requests** — the queue becomes Timeline questions;
  routine requests approve themselves against the owner's precedent.
  **Retires** as a screen.
- **Refunds** — a question with two choices; the preview arithmetic sits
  behind "see the details". **Moves.**
- **Member list and profiles** — **splits**: "show me Marcus" brings the
  picture first; the searchable list and full profile stay one tap deeper
  for genuine roster work.
- **Tags and tag rules** — tags become signals feeding loops (the
  automation triggers already read them); the rule editor demotes.
  **Moves.**
- **Insights KPIs** — every chart ends in a verb: the numbers arrive as
  Timeline lines with drafted actions, and Goals carries the trends.
  **Moves.**
- **Team, invites, permissions** — inviting is a sentence ("invite Sam as
  a coach"); the roster page becomes the Roster — people and Temple's
  jobs side by side, each job with its rules and its rope. The capability
  matrix stays the authz substrate underneath. **Moves**, with the Team
  editor surviving in Back Office for fine-grained permission work.

### The money — the first loop

Dunning already sees, notifies and builds the chase list; loop 1 upgrades
"see them, chase them" to *chased for you*. "Needs chasing" **retires** —
the first list deleted. The Money tiles become Timeline receipts ("I got
£74 back") and Goals numbers. Store: the member side keeps its screen;
product authoring keeps a screen (craft); the orders/fulfilment queue
**moves** to receipts with batch actions.

### The front desk — already the proof

The lead agent keeps acting; its receipts and judgement calls are the
Timeline's founding content. The pipeline board **splits** into the Back
Office; the conversation review and call-QC screen **keeps its screen**
(listening to a call is evidence work). The agent setup wizard folds into
`/setup` and the Roster's job sheets. Coaching corrections stay — that
*is* the owner teaching the voice everything else will write in.

### Switching platforms — a sentence at go-live

"Send me your member list" already runs from `/setup`. The CSV, workout
and Stripe importers' review steps **split**: they keep their screens for
the judgement calls (plan mapping, fuzzy duplicates, the double-bill
guard) and are reached from the conversation rather than a menu. The
import machinery — inference, corrections learning, legacy billing
continuation — is untouched.

### Reaching members — sentences over the shipped machinery

A newsletter is a sentence; the draft is the preview card. A sequence is
described, laid out as steps, turned on. Audiences resolve through the
tag machinery; new audiences stay approval-gated. The block Design
builder, the audience builder and the automation editor **split** into
the Back Office (pixel control when it's wanted); scheduled sends, A/B
subjects, topics, suppression, sending domains — all of it is hands,
unchanged. The front desk's taught voice becomes the one voice.

### The website — craft keeps its canvas

The builder's canvas editing **keeps its screen**. The admin around it —
publish checklists, domain status, SEO housekeeping — becomes go-live
steps and Timeline receipts ("your domain verified overnight").

### The team's own work

Cover *asking* is a sentence from the coach ("I can't do tomorrow's
6:30"); cover *finding* becomes the ops loop — the nightly nag emails
retire when the loop places cover itself. Claim offers arrive as
Timeline cards. Earnings **keeps its screen** (a coach checking their
pay is evidence). Tasks and SOPs: reading **keeps a screen**; assignment
and chasing **move** to the Timeline.

### Health and the law — permanently human, permanently unchanged

Consent, waivers, PAR-Q, erasure, retention purges, the access audit log,
breach monitoring. No loop touches any of it; the boundary is stated in
every job's rules ("I never talk about health"). Guardian flows included.

### The plumbing — the Timeline is the missing screen

`cron_run_log` is the sharpest case: every sweep now records what it did,
and the whole interface is a SQL query. Those rows become quiet Timeline
lines — the gym's pulse, visible for the first time. The notification
badge sources fold into the same stream. The two dead capability switches
(`can_issue_override`, `can_issue_comp_grant`) **retire**. PWA branding,
light/dark, the crash screen, BackLink, RLS, the capability matrix: load-
bearing substrate, untouched.

## The order

Sequenced by what each phase unlocks, grounded in what already exists on
`agent-main`. No dates — each phase is small enough to ship and prove
before the next.

**Now — merge what's built.** PR #20: the vision, the one-pager, the
loop-1 spec, and the working day-one `/setup` flow. Merging deploys
everything, including the parse function — the key is already live.

**1 — The Timeline lights up (read-only).** Build the Timeline surface
and the `agent_actions` ledger from the loop-1 spec, then feed it with
what already happens: front desk receipts, dunning notices, cover events,
class-change digests, the sweeps' `cron_run_log`. No new autonomy — the
gym's existing activity becomes legible in one place, and the Timeline
becomes the staff home. Everything conversational builds on this.

**2 — The money loop acts.** Loop 1 per the committed spec: the authority
dial, question cards, "always allow", receipts. The first list dies.

**3 — Rules stay sentences.** The `/setup` rule sheet becomes the
permanent settings surface — change any rule in chat, applied through the
same setter RPCs the cards use today. The settings cards demote.

**4 — Timetable and memberships by sentence.** The ongoing versions of
the setup steps: schedule changes, closures, plan and price changes as
sentences with preview cards. The class-types and plans editors demote.

**5 — The programming roadmap.** Blocks, the strip, the Year view, share
with coaches — inside the kept editor, from the same kit. Independent of
the Timeline work, so it can run in parallel whenever; it's the thing the
interviews asked for twice.

**6 — Reach your members.** Newsletter-as-sentence, sequences described,
one voice — over the comms machinery that shipped this quarter.

**7 — Ops finds cover.** From nagging humans to placing cover itself;
the warning emails become unnecessary.

**8 — Keeping members.** The retention loop plus "show me Marcus" — the
member in hand, acting in the gym's voice, outcomes tracked.

**9 — The Roster and Goals.** The jobs page with plain names and rope
dials; Goal Threads on the targets schema that's been waiting for a
screen since it was built.

**Throughout — the Back Office burndown.** Every demoted screen is
counted, and the two public measures are routes retired and owner
interventions per member per month. A screen deleted is progress; a
screen rebuilt prettier is not.
