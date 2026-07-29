# Temple: the first gym that runs itself

> "None of the booking platforms are made for operating a gym."
> — a gym owner, 2026

This document is not a roadmap. It is a re-founding.

Temple today is a good example of a category that should not exist: gym
management software. Members, Memberships, Classes, Timetable, Staff,
Payments, Programming, Tracking, CRM — the same nine modules as TeamUp,
Wodify, PushPress, Momence, Zen Planner and BSport, because everyone answered
the same wrong question: *what data does a gym have?* The right question is
*what work does an owner do?* — and the honest answer is that the owner does
nearly all of it, while the software watches and takes notes.

We built software that remembers everything and does nothing. The next Temple
does the work and remembers why.

The argument below runs in five movements: why the current model is broken
(and how our own codebase proves it); the system of action that replaces it;
three mental models for organising the new product; what it looks and feels
like — surfaces, homepage, navigation, one owner's Tuesday; and the horizon —
five years out, the bets worth making, and the bridge from the code we have
to the company we're describing.

---

## 1. The indictment: software that watches you drown

**Every gym platform is a system of record, and a system of record is a
machine for generating unpaid admin.**

Listen to the market we interviewed. An owner-coach: "I'm dealing with one
issue a day from members with Zen Planner." An owner paying £319 a month for
Wodify. Another paying £79 plus £1 per member per month to a company that is
also a debt collector, because at least the debt collector chases the money.
An owner gluing three products together — TeamUp for bookings, BoxMate for
tracking, GoHighLevel for CRM — "if you can get the CRM and PT app all under
one roof… I haven't come across an app yet that does it." Members
photographing the whiteboard because that's still the most reliable tracking
integration in the industry. And the owner whose words open this document:
none of the booking platforms are made for *operating* a gym.

The sharpest testimony came from a coach who is entirely happy with his
software. TeamUp is "great, can't see any way of improving it." Then we asked
what his gym actually struggles with: "probably bringing in members… there is
definitely a lot of business we are missing in the local area." The software
is at five stars and the business problem is untouched. That is the ceiling
of the system-of-record model: perfect it, and you have perfectly organised
the owner's unpaid admin while the thing they wake up worrying about — more
members, less churn, fewer hours — sits outside every module.

**The hidden tax of a system of record is that the human is the event loop.**
Nothing happens unless a person opens a screen. Temple is guilty, and we can
name the evidence, because it's our own codebase:

- Attendance is marked by hand, per member, per session. A tile counts the
  unmarked sessions; nothing chases them.
- Every store order — including every monthly cycle of a recurring box —
  waits for a human to press "Mark shipped."
- Membership change requests, cover claims, staff tasks and imported-member
  invites sit in queues that move only when someone remembers to open them.
- The owner's path to anything is Manage → eight categories → some twenty
  cards → screen, three or four taps deep, with several features reachable
  only from chips you'd have to already know about.
- Roughly 35 owner-only settings RPCs — booking windows, cancel cutoffs,
  PAR-Q expiry, plan resolution order — each a decision the owner was forced
  to make in advance, out of context, forever.
- The capability matrix contains switches for employees that don't exist:
  `can_issue_override` and `can_issue_comp_grant` can be granted and revoked
  in the Team editor, and nothing anywhere reads them. `can_set_targets`
  offers "Configure monthly and quarterly business goals" — and there is no
  screen in the product where a goal can be set. The org chart has empty
  desks.
- Fifteen scheduled jobs run behind the product. Six of them are data
  deletion. The machine is more diligent about forgetting than acting. And
  since we taught every sweep to log what it did to `cron_run_log`, the
  feature inventory has carried this sentence without irony: "It is read
  from the SQL editor; there is no screen."

**Reports are homework.** The Analysis page now renders verdict tiles —
push:pull ratio in a green band, a time domain flagged amber for
concentration. A verdict, and then nothing: it flags drift and drafts no
fix. The injury heat map, the attendance trends, the campaign funnels — each
is a chart that ends in a question mark. The software does the easy 80%
(aggregation), leaves the owner the hard 20% (judgement and action), and
bills them for the privilege.

Here is the uncomfortable proof that features are not the answer. Our
interview notes from two owners contain a list of asks with most of the lines
struck through — cover requests by date range, bulk timetable edits, 1RM
percentages in programming, SOPs, tasks, auto-tagging, pending-versus-
confirmed revenue — struck through because we shipped them. All of them. It
was a quarter of flawless feature catch-up, the requests were real, the
implementations are good, and the shape of the owner's day did not change.
Feature requests are the exhaust of the system-of-record model. The
underlying problems — bring me members, stop the admin, too many systems,
chase the money — were never on the list, because no owner believes software
will do those.

And the last two months of our own commits show the model at its logical
end-point. We built world-class *visibility*: failed payments are now
detected the moment Stripe reports them, the member is notified with humane,
plan-aware copy, the forecast splits out at-risk revenue — and then the
owner gets a list. The migration that shipped it says so in its opening
line: "Failed membership payments: see them, chase them, stop counting
them." See them. Chase them. The software sees; *you* chase. Cover works the
same way now — a coach goes down, and a nightly sweep emails everyone who
could claim the class, then emails the owner daily that nobody has. Temple's
newest code has learned to nag.

The next Temple does the thing itself.

The strange part — the part that turns this critique into a plan — is that
the refutation of the entire model is already running in our production
stack. It answers the phone.

---

## 2. The next generation: a system of action

At 9:40 on a Tuesday night, someone texts a gym they found on Google:
"how much is membership?" No human is awake. The agent behind that number —
`supabase/functions/_shared/lead-agent.ts`, 1,082 lines of production code —
reads the gym's live plans, the next seven days of classes, and the operating
brief the owner approved. It answers the price question, handles the "that's
a bit steep" objection (logged to a closed category — more on why later),
offers Thursday's 6am class, sends a one-time join link, and by the time the
owner wakes up there is a new member with an active plan, a signed waiver,
and a booked first class. Zero human touches. The owner taught the agent by
*talking to it* — a phone interview that produced a draft brief, never
applied without approval — and coaches it by correcting individual turns in
a conversation review screen.

One owner we interviewed described his dream automation: contact-form
enquiries that go "straight on the membership site" and text the coach the
lead — "that's a whole process you've saved them." He was describing,
almost word for word, something Temple already does while he isn't a
customer yet. The market is asking for the thing that already runs.

**The atomic unit of the next-generation product is the closed loop, not the
screen.** A loop is: trigger → decision → action → guardrail → outcome →
memory. The front desk is one loop, fully closed, for one owner job (get
more members). The old product renders state and waits. The new product
closes loops and shows you the receipts.

**"AI-first" is structural, not cosmetic.** The difference between an agent
and a chatbot is where it sits in the authorisation model. Temple's agent
does not puppet the UI; it acts through some thirty purpose-built
service-role RPCs — a machine tool API with tenancy derived server-side,
callable by nothing except the agent runtime. A chat window bolted onto the
Manage hub would be the skeuomorphism of this era: a dashboard with a
chatbot in the corner. We will not build that. We will extend the structure
that already works: closed tool sets, real database actions, guardrails in
the schema.

Worth saying plainly: Temple already has three AI beachheads, and only one
of them acts. The front desk *acts*. The programming classifier *reads* —
Claude reads what the coach already wrote and tags the dimensions BoxMate
makes coaches enter by hand. The import engine *reads* — it maps CSV columns
and infers plans and tags from other systems' exports. Reading is where AI
features go to be safe. The vision is everything acting.

**Trust architecture is the product.** The front desk's guardrails are not
caveats; they are the design. The agent structurally cannot pre-sign a
waiver or a PAR-Q — those tables only accept the member's own hand. No
model-authored free text can reach a staff-visible health field; when a
lead mentions an injury, the agent sets a flag, because we found that free
text is how special-category data leaks into places it must not be.
Objections are logged to a closed set of categories for the same reason.
One-time auth links travel by email only, never SMS. Changes to the agent's
brief arrive as drafts and wait for the owner. And marking a lead "lost" is
never done by the agent — writing a person off stays a human judgement.
Autonomy is bought with constraints, and Temple has already paid for the
first instalment. The rest of this document spends that trust.

---

## 3. Three mental models

Organising the product around owner jobs instead of modules — get more
members, keep members longer, run today's classes, grow revenue, support
coaches, build community — is necessary, and it is not sufficient. Jobs say
what to organise around. These three models say how the product works.

### Model 1 — The staff roster: the product is an org chart

Stop thinking in features. Think in employees. A teammate is a named agent
with a job description (owner jobs), authority (capability grants), a
manager (the owner), and a performance review (its numbers, plus a coaching
surface). This is not a metaphor in Temple: authorisation already resolves
through a 42-key capability matrix — `effective_can(gym, capability)`,
owner override, then per-person, then per-role, then defaults. Add one new
actor, `gym_agent`, and the same machinery that decides whether a human
coach may comp a class decides whether the Revenue teammate may. An AI
teammate is literally a row in the existing permission system.

The roadmap becomes a hiring plan, four hires long:

- **Front Desk** — enquiries, qualification, intro bookings, joining.
  Already on staff. Already closing.
- **Revenue** — failed payments, plan changes, offers, collections.
- **Retention** — churn signals, outreach, win-backs, milestones.
- **Ops** — attendance, cover, fulfilment, schedule hygiene.

Four teammates, not forty features. And recall the empty desks: the matrix
already holds capabilities nothing exercises. The org chart was waiting for
the staff.

### Model 2 — The approval economy: settings are fossilised decisions

Every action in a gym sits at one of three authority levels: **autonomous**,
**approval-gated**, or **human-reserved**. All three already exist in
production. Waitlist promotion is autonomous — a cancellation fires a
trigger and the next member is booked, no screen involved. The agent's brief
is approval-gated — drafts only, owner applies. Waiver signing and writing
off a lead are human-reserved — structurally, not by policy.

The vision is simply to put a dial on what already exists, per action-type,
per gym, and let it move rightward as trust accrues. Today Temple asks the
owner to pre-answer every operational question with ~35 setter RPCs: how
many hours before class does booking close, how many days notice to cancel a
plan, when does a PAR-Q expire. A booking window is a frozen guess, made in
advance, out of context, forever. In the approval economy the agent proposes
the concrete call in context — "let Priya book 26 hours out; she's on the
waitlist and a spot just opened" — the owner taps approve, and after the
third identical approval the card grows a new affordance: *always allow
this*. Policy stops being configured and starts being *emergent from
approvals*. Settings screens don't get redesigned; they get outgrown.

### Model 3 — The interface is the exception handler

In a system of action, a screen is an admission of failure. UI exists for
exactly three things: judgement the AI must not exercise (human-reserved
decisions), trust it hasn't earned yet (approval cards), and evidence
(the record of what happened). Everything else is a loop that should have
closed silently.

Three consequences. First, the roadmap inverts: progress is measured in
screens *deleted*, and the Manage hub's twenty cards become a burndown
chart. Second, the north-star metric becomes **owner interventions per
member per month**, driven down release by release. Third, every surviving
screen must justify itself as one of the three exception types, or die.

The models nest: *teammates* (who) run *loops* (what) under the *approval
economy* (how much authority), and the *interface* renders only the
exceptions.

---

## 4. Six surfaces

The concept vocabulary for the new product. Trust surfaces first, because
autonomy without evidence is a liability. And one register throughout,
because the audience is a gym owner, not an operator of software — "we're
not good with computers" is a direct quote. One idea per message. Plain
words. No system vocabulary anywhere an owner can see it.

**1. The Timeline.** The owner surface, singular. Catching up, deciding
and auditing are one workflow, so they are one chronological stream —
messages from Temple flowing in like a conversation. Three kinds of entry,
and nothing else:

- *Updates* — one idea in plain first person: "I got £74 back from two
  failed payments." No labels, no card chrome. The stream has one sender —
  Temple. Which teammate acted is a detail inside the detail view; the
  owner talks to Temple, not to an org chart.
- *Questions* — the only cards in the stream, and the only inbox in the
  product. A one-line question ("Move Emma to the smaller plan?"), one
  sentence of reasoning, exactly two choices — the yes labelled with the
  action ("Yes, move her") — and the evidence behind "See the details."
  After the third identical approval, the detail view offers *always
  allow this*: the authority dial moving right, one decision at a time.
  The Timeline absorbs today's five scattered queues (membership change
  requests, cover, imported invites, staff tasks, refund calls).
- *Receipts* — resolved things collapse to one soft line: "Marcus's pause
  — sorted, with 2 free classes." Scrolling back is the record: who, what,
  why, and undo, with every autonomous action declaring a reversal window.
  Temple has been accreting this record's raw material for years without a
  surface — every sweep logs to `cron_run_log`, every notification queue
  is also an audit table, and the whole thing is currently read with a SQL
  query. The Timeline's history is that discipline, unified and finally
  given a screen. It is where trust is manufactured.

The day's opening entries are the morning brief; the ask-count stays
honest because a question is the only thing that ever demands attention.

**2. The talk bar.** The Timeline's input, and the product's real
navigation. Type or speak — on the gym floor, long-press and say "Jamie's
shoulder is playing up again, and bump the 6am cap to 14 for summer." Each
utterance routes to the right loop with its guardrail intact: the injury
mention lands as a closed-category flag (never free text into a health
field, the same rule the front desk already obeys), the capacity change
comes back as a question or just happens, depending on where that action's
dial sits. This generalises the pattern we already trust — the owner
taught the front desk by talking. Now the whole gym works that way.

**3. The Roster.** The org-chart page — the one place the teammate
structure is visible, because here it is useful: what Temple handles, what
it may do on its own versus what it asks about, this week's numbers, and a
coaching view — which already exists for the Front Desk as the
conversation review screen, where the owner corrects an answer and the
correction becomes a standing rule. Hiring a teammate is enabling a loop
bundle, presented as an offer letter, not a settings page.

**4. Goal Threads.** "Get to 200 members by December" as a persistent
object with an owner (a teammate), a plan, a running action log, and a
weekly written report. Temple already has the schema — `gym_insight_targets`
and its capability shipped server-side and never got a screen. Of course
they didn't: in a system of record, a target is just another number to
stare at. In a system of action, a target is a brief you give an employee.

**5. The Member's Teammate.** The same agent, facing members. It rebooks
after a missed class, handles "I'm travelling next fortnight" with a hold,
computes the pro-rata upgrade when someone asks to move up a plan — in
words, not in a proration UI — celebrates the hundredth class, and nudges
the right person about tomorrow's half-empty 6am. This is where push
notifications finally enter Temple — there is no push anywhere in the app
today — and they arrive as the agent's voice, not a marketing cannon. The
hard rule: the member's teammate serves the member's goals; retention is
the by-product. Owners told us the incumbents are "focused on the business
side and not on the member side." The member side is where retention
actually lives.

**6. Every chart ends in a verb.** Reports become claims with drafted
actions attached. The verdict tiles were the halfway house — a flag with no
hands. The full version: "Shoulder flags are up 40% in six weeks, clustered
on the Tuesday push cycle. A deload week is drafted — review it?" Aggregate
counts of closed categories only; no individual health inference, ever. An
insight that can't be acted on from the surface that states it doesn't
ship.

---

## 5. Ten screens replaced by loops

The demolition order. Each row names a surface or queue in today's Temple
and the closed loop that replaces it.

| # | Today | Trigger | AI action | Guardrail | What the owner sees |
|---|-------|---------|-----------|-----------|---------------------|
| 1 | The "Needs chasing" list (dunning sees, notifies once, then hands the owner a chase list) | Payment failure recorded | Revenue teammate works the chase: humane outreach in the gym's voice, timed to Stripe's retry schedule; on repeat failure, proposes a plan adjustment instead of a chase | Never cancels a membership; offer sizes capped; tone from the operating brief | "I got £74 back" in the Timeline |
| 2 | Attendance marking, per member, per session | Class ends | Auto-mark from bookings and check-in signals; infer no-shows; feed the result to Retention | Coach gets a one-swipe correction window | Nothing, unless a pattern emerges |
| 3 | Membership change-request queue | Request submitted | Evaluate against precedent learned from the owner's past approvals; apply the routine ones | Novel patterns always queue; cancellations human-reserved | One card for the exception |
| 4 | Store fulfilment — "Mark shipped" per order, every box cycle | Order or renewal settles | Batch, label, mark shipped on carrier scan | Address anomalies and stock-outs queue | A weekly line in the Timeline |
| 5 | Cover by email nag (daily "still uncovered" warnings) | Coach unavailable | Ops teammate ranks qualified, available coaches, asks, confirms both sides, updates the class | Pay-rate changes queue; external hires human-reserved (for now — see bet 4) | A line in the Timeline, after the fact |
| 6 | Campaign authorship (the mechanics — scheduling, A/B, segments — are already autonomous; the writing isn't) | An outcome brief: "win back three-week-inactive members" | Agent writes, times, sends, measures lift, iterates | New audiences need approval; individual sends don't; frequency caps hold | Lift, not funnels |
| 7 | Imported-member invite chase | Import commits | Full onboarding pursuit: invite, nudge, escalate; auto-link on signup (the trigger exists) | One-time links stay email-only | A conversion count |
| 8 | Verdict tiles and attendance trends (verdicts without hands) | Per-member frequency decline | Churn-risk score, personalised outreach, outcome tracked into memory | First-contact templates owner-approved; no health inference | "Three at-risk members contacted; two rebooked" |
| 9 | Waitlist screen and capacity guessing | Spot opens, or a class under-filled at T-48h | Promote (already autonomous), then proactively invite likely attendees — the quick-book affinity model, re-aimed gym-side, delivered by push | Invite caps per member per week; no pressure language | "Thursday 06:00 at 14/16, three invited" |
| 10 | Targets: a table, a capability, a Team-screen toggle, and no screen, ever | Owner states a goal in words | A Goal Thread: a teammate owns it, plans, acts, reports weekly | Spend and discount caps; tactics surfaced in the Timeline's record | Progress in sentences, not gauges |

Three notes. Row 1 is the sharpest: payment failure is the biggest cause of
involuntary churn, whole gym communities have switched platforms over it,
and today's best-in-class answer — ours included — is a well-organised list
of people for the owner to chase. Row 6 dissolves a pain we heard verbatim
about a competitor: two coaches answering the same email because the app
and Gmail don't sync. When the agent answers first and humans are pulled
in through one Timeline, there is no shared-inbox race to sync. And two
surfaces are named human-reserved permanently: waiver and PAR-Q signing.
Some screens survive because they must. That's the trust story working.

---

## 6. The homepage

A dashboard is a pull medium: it offers you numbers and hopes you know what
to do. A gym manager told us exactly what he wanted instead, in his own
register: "It needs to be super simple… all the dashboard should show is
money in, money out, total memberships." He wasn't asking for a smaller
dashboard. He was asking for an employee who has already read the
dashboard.

The homepage of the next Temple is the Timeline, and the morning brief is
simply how the day opens in it:

> Morning Dan. Sarah joined overnight — her first class is Thursday at 6am.
>
> I got £74 back from two failed payments. One more is on a final retry;
> I'll message her this afternoon unless you say otherwise.
>
> Thursday's 6am is at 14 of 16, so I've invited three regulars who
> usually come Thursdays.
>
> **Move Emma to the smaller plan?** Her card keeps failing. She trains
> twice a week, so the 8-class plan fits her — and it's £30 less each
> month. *See the details* · **Yes, move her** / **No**

Short messages, one idea each, and a question is the only thing on screen
with buttons. Anything the owner wants to know more about is one tap away
— evidence, not navigation. Numbers appear only inside sentences. And the
stream is not customisable: you don't rearrange an employee's report into
widgets, you tell them what matters and tomorrow's messages reflect it.

Compare the current morning: open the app, land on a calendar, tap into
Manage, scan eight categories, open the Members tab, check the requests
chip, check the "Needs chasing" list, check the cover screen. Today Temple
starts the owner's day with a map. The Timeline starts it with a
colleague.

---

## 7. Navigation

Three destinations. **Timeline** (home), **Roster**, **Goals**. Nothing
else at the top level.

Everything else is reachable by asking. The talk bar — type or speak — is
the primary navigation: "show me Marcus's payment history" beats
remembering which of twenty cards holds it. Navigation stops being a map of
the database and becomes a conversation with your staff, plus two places
to check their work.

The honest second half: today's ~70 routes do not vanish on day one. They
demote to the Back Office — reachable, unloved, each screen carrying a
quiet marker once a loop has superseded it. We publish the burndown: Back
Office screens remaining, and Back Office visits per owner per week, driven
toward zero. When a screen's visits hit zero for a quarter, it is deleted,
and the deletion is a release note. The member side needs no such
demolition — Book, Track, Programming already organise around what the
member is doing, which is why members mostly like Temple already; it gains
the Member's Teammate and push, and keeps its shape.

---

## 8. The owner's day

Dan owns Forge Fitness in Leeds: 214 members, four coaches, one Dan. A
Tuesday, with a running count of the taps Temple asks of him.

**06:45.** Coffee. The Timeline opens as above: one join overnight, £74
recovered, Thursday's 6am being filled, one decision — Marcus's third
consecutive pause. Dan taps the card, reads the context (Marcus's
attendance has been sliding since March; the teammate suggests a pause
*plus* a comp class with his old training partner, to pull him back rather
than park him), adjusts the offer to two comp classes, approves. *Two
taps.*

**08:30.** Dan coaches the 8:30. Attendance marks itself from bookings and
check-ins; one member came without booking, and the roster asks with a
single swipe. *Three.*

**11:00.** On the floor, hands chalky. Long-press, speak: "Jamie's shoulder
is playing up again — and bump the 6am cap to 14 for the summer." The
injury note lands as a flag on Jamie's profile, closed-category, no prose.
The cap change comes back as a question, because capacity changes at Forge
still sit at approval-gated. Dan approves it at lunch. *Four.*

**13:00.** The Revenue teammate reports: the final-retry member paid after
a friendly message this morning. A fourth member's card has now failed
across two cycles; rather than chase again, the teammate proposes moving
her from Unlimited to the 8-class plan she actually uses. Dan approves,
and taps *Always allow offers like this* — downgrades within a plan family,
proposed after two failed cycles, no approval needed next time. An
action-type just graduated to autonomous. *Six.*

**16:00.** The evening coach texts in sick. Dan finds out about it at 16:20
— in the Timeline, past tense: cover requested, two qualified coaches asked,
one confirmed, class updated, members untouched. Cover-finding graduated
months ago. *Still six.*

**20:30.** The evening entries: two loops closed that Dan never saw, the
"200 by December" Goal Thread ticked 214 → 215 and posted its weekly note
on which classes new joiners are actually attending. Dan reads it in bed.
*Seven taps.*

The same Tuesday in today's Temple: the requests queue, the chase list, the
cover screen, the unmarked-attendance tile, the campaign builder guilt, the
analysis page he hasn't opened since March. Dan doesn't do fewer things in
the new Temple. He does the seven that were his.

---

## 9. Five years out

**The ratio inverts.** Today the owner does the work and the software keeps
the record. In five years the software does the work and the owner does the
two things software cannot: judgement about people, and presence in the
room. Temple runs the gym; humans run the community. The industry's oldest
complaint — the incumbents are "focused on the business side and not on the
member side" — resolves itself, because the business side stops needing a
human audience.

**The dial ends far right.** A mature gym runs at single-digit approvals per
week, all genuinely hard calls: a refund that's really a complaint, a
teammate proposing a price change, a member whose situation no precedent
fits. The owner's role quietly changes title, from administrator to
director. New gyms skip the admin era entirely — they onboard by
conversation and never learn where the settings were.

**The moat is the network, not the model.** Models commoditise; closed
loops with outcomes do not. Temple already learns across gyms in one narrow
channel — import corrections feed a shared inference store. At scale, every
objection handled, every save that worked, every January 6am fill strategy
feeds a network prior that no single-gym operator and no bolt-on AI vendor
without the action layer can match. The pitch to the ten-thousandth gym is
not "our AI is clever," it is "your front desk has already worked ten
thousand gyms' worth of Tuesdays."

The ecosystem inverts too. ClassPass, MyFitnessPal, programming providers,
door hardware — today each is a tab the owner configures. In five years
they are counterparties the agent negotiates with: it fills spare capacity
through aggregators at prices it sets, pulls macros when a member connects
them, licenses programming when the coach asks, and unlocks the door at
5:58 for the member whose plan says she can be there.

---

## 10. Eight bets

Ordered nearest to furthest. Plausible means we would start it inside two
years; provocative means it sounds slightly mad today and will read as
obvious in hindsight.

**1. Setup by conversation.** [Plausible] A new gym onboards in a
40-minute phone call — plans, schedule, policies come out the other side as
a draft the owner approves. No forms. This is a direct extension of the
interview that already writes the front desk's brief. Owners begged us for
"common sense" setup; the most common-sense timetable UI is describing your
timetable out loud.

**2. The agent is the phone number.** [Plausible] No human answers a gym's
phone again. Half of this is live — the front desk already takes voice
calls for leads. The bet is extending it to members and making "a human
answered" the anomaly that gets its own line in the record.

**3. Programming that adjusts to the cohort.** [Plausible] Deload weeks and
substitutions proposed from aggregate signals — the classifier already
reads every section's movements, duration and load. The guardrail is the
reason this is shippable at all: aggregates of closed categories only,
never individual health inference. The line between "Tuesday push volume is
high while shoulder flags trend up" and "program around Jamie's shoulder"
is the line between a product and a scandal.

**4. The AI hires humans.** [Plausible] A cover request no internal coach
claims goes to a vetted freelance-coach marketplace; the Ops teammate
negotiates within a rate cap, books, and pays. The general manager that
staffs physical work with people.

**5. The agent-to-agent gym network.** [Provocative] A Forge member
travels to Manchester; Forge's agent arranges the drop-in with the
Manchester gym's agent — access, waiver, payment split — before she lands.
Cross-gym learning becomes cross-gym commerce, and the network effect
becomes visible to members.

**6. Dynamic offers, never dynamic prices.** [Provocative] Surge-pricing a
6am class is community poison. Instead: public, stable prices, and
personal, dynamic offers — comp credits, off-peak variants, win-back terms
— issued by the Revenue teammate under caps. Yield management that
doesn't feel like an airline.

**7. Temple underwrites revenue.** [Provocative] Temple runs collections,
retention, and acquisition, and holds outcome data across the network — so
it can guarantee an MRR floor, or advance capital against a retention
curve it can predict and influence. The action layer becomes a balance
sheet. Software that does the work can put money where its mouth is.

**8. The satellite gym.** [Provocative] A 24-hour unit with no on-site
staff: the agent sells, onboards, schedules, watches, opens the door, and
dispatches one roving human across sites. Two owners independently told us
the winning product is good gym software plus a 24-hour entry system —
"and you'd have a great product." Follow that to its end and you get the
company name said literally: the first gym that runs itself.

---

## 11. The bridge

The front desk is not a feature. It is a template, and every teammate in
this document is the same anatomy pointed at a different job: a tool loop
with a closed tool set → service-role RPCs with tenancy derived server-side
→ an owner-approved operating brief → per-turn coaching → structural
guardrails → human-reserved edges. We do not need to invent the pattern.
We need to stamp it.

| Phase | Ships | Reuses | Dies |
|-------|-------|--------|------|
| 0 — The ledger | One `audit_events` stream: every RPC, trigger, sweep and agent action writes who/what/why/undo. Loops become event-driven instead of polled. | `cron_run_log`, the queue-plus-audit tables (cover, payments, class changes), the dispatcher logging discipline — the ledger is half-born and needs unifying, then a surface — it becomes the Timeline's history | "It is read from the SQL editor; there is no screen" |
| 1 — Identity and hands | The `gym_agent` actor in the capability matrix; the ops tool API: `agent_send_member_message`, `agent_book_class`, `agent_offer_comp`, `agent_adjust_plan_offer` — each ledgered, each with an undo path | `effective_can` resolution untouched (authority is capability grants — the approval economy needs zero new machinery); the service-role calling convention and worker-secret pattern the dispatchers already use | Nothing yet — this phase is pure substrate |
| 2 — Three loops | Revenue: payment recovery, worked not listed. Retention: churn-risk plus tracked outreach, and the first durable per-member memory (with TTLs on the model of the existing purge discipline). Ops: class-fill, which forces the push build with a genuinely useful first message. The Timeline ships with the first loop. | The whole dunning pipeline (detection, notices, invoice links) as Revenue's sensors; the inactivity automation and the new attendance-based tag predicates as Retention's signals; the waitlist trigger and the quick-book affinity model as Ops's instincts | The "Needs chasing" list is the first screen to gain the superseded marker |
| 3 — The flip | The Timeline as owner homepage (a stream fed by one loop is a notification feed; fed by three it is an employee). Goal Threads on the orphaned targets schema. The Roster, generalising the conversation-review screen to every teammate. | The front desk's coaching surface, brief-interview flow, and QC patterns, generalised | The Manage hub collapses into the three destinations; the Back Office burndown is published and worked |

Why these three loops first: payment recovery has the highest direct pain
(gyms have switched platforms over it), its substrate is fully built, its
worst failure mode is a polite message, and recovered pounds are the trust
down-payment that funds every later dial-move. Churn is the second-biggest
owner anxiety and its signals are already computed nightly. Class-fill is
third deliberately, because it forces push notifications into the product
attached to a message members actually want. Attendance automation is
visible toil but coach-facing; it lands early in the flip. Nothing
lead-shaped is on the list because it's already done.

Two guardrail commitments carry forward unchanged and by name: everything
in the front desk's trust architecture (draft briefs, closed categories,
no model text in health fields, email-only one-time links, human-reserved
waivers and write-offs), and the retention-purge discipline extended to
every new memory the teammates acquire. Two commercial questions are
flagged and deliberately not designed here: metering and billing for agent
usage, and the go-to-market wedge — noting only that the Front Desk can
answer a gym's phone while that gym still runs MindBody, which means the
first teammate can be hired before Temple is the system of record it
replaces.

---

## Close

The category we are leaving calls itself gym management software, and the
name is a confession: it manages records about a gym while a human manages
the gym. The category we are founding has a different job description.
Software that answers at 2am, chases what's owed, fills the 6am, finds the
cover, notices the fade in a member's pattern before they've decided to
quit — and shows its work in a ledger you can audit and a brief you can
read over coffee.

We built software that remembers everything and does nothing. The next
Temple does the work and remembers why. Owners have been telling us the
brief all along, one interview at a time: none of the booking platforms
are made for operating a gym. This one will be.
