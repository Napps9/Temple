# How Temple comes together

The whole product, on one page, organised by the work — not the screens.
Companion to `docs/vision.md` (the argument) and
`docs/loop-1-payment-recovery.md` (the first loop's engineering).

## The shape

Three places, a talk bar — and Today, for whoever is coaching.

- **Timeline** — home. What happened, as short messages from Temple; what
  needs you, as a question with two choices; what got resolved, as one
  soft line. Scrolling back is the record.
- **Roster** — who works for you: the coaches with their real
  qualifications and limits, and Temple's jobs in plain names — the front
  desk, the money, keeping members — each with one line of description,
  this week's number, and how much rope it has ("on its own" / "asks
  first"). Each job shows its rules — what it does, what it asks about,
  what it never does — and taking one on is reading them and saying
  "sounds right", not filling in settings.
- **Goals** — what you're aiming at. "200 members by December" as a brief
  you've given an employee, with a weekly note on how it's going.
- **Today** — the coach's landing, and deliberately the calendar they
  already know: the same day grid, class blocks and colours as now, with
  fill at a glance, then the class roster — check-in, first-timer flags,
  the whiteboard. The Timeline replaces the admin, not the tools; running
  a class keeps its screen, and keeps its look.

The member app stays as it is. Signing up, buying, booking and tracking
are how members feed the system its data, they already work, and members
already get recommendations (quick-book). Anything new on the member side
is additive — a push nudge, a milestone message — never a redesign. The
redesign is the staff experience.

Everything else is a conversation. The owner never learns an admin
interface; they describe what they want and confirm what comes back.
Today's ~70 routes demote to the Back Office and burn down from there.

## The jobs

### Day one — the flow we start with

Setup is the owner's first conversation with Temple, in the Timeline
itself — the same place they'll live from then on. Four steps, about
fifteen minutes, talk or type: describe your week of classes; say your
prices; confirm the **best-practice rules** ("book up to 7 days ahead,
free cancel until 9pm the night before, waitlist fills spots
automatically") — offered ready-made from how gyms like yours run, changed
by saying so, now or forever after; then read what Temple handles out of
the box and the rules it follows ("I never talk about health, I never
cancel anyone, prices are always yours — anything unusual, I ask first"),
and say "sounds right". Go live: the number answering, the website up, the
join link ready. Switching platforms is a sentence too — "send me your
member list" runs the import machinery that already exists. There is no
"hiring" and no configuration: owners set up rules and best practices,
and every rule stays a sentence — "make the 6am cancel cutoff 2 hours" —
for the life of the gym.

### A new lead comes in

Nothing to do — this already runs. The front desk answers the SMS or call,
handles the objection, sends the join link, takes payment, books the first
class. The Timeline shows one line: "Kelly asked about prices at 9:40 last
night. I answered — she's booked a visit Thursday at 6pm." Judgement calls
come back as questions: "Tom's asked about prices twice but hasn't booked.
Offer him a free taster?" The taster-offer authority graduates like every
other: approve a few, then "always allow this."

### Set up — or change — the timetable

The owner describes their week: "We run classes at 6, 7 and 9:30 weekday
mornings, 6pm evenings, and 9am Saturday. Cap of 16." Temple builds the
recurring schedule and answers with a preview — the week at a glance, one
question, two choices. "Close the gym 22 December to 3 January" runs the
closure machinery (cancel, refund, tell everyone, hold the window) behind
one sentence. The class-types editor, recurrence rows and bulk-edit picker
all still exist underneath — as machinery, not as the interface. This is
the "Calendly-style, common-sense timetable" owners asked for, taken to
its conclusion: the most common-sense timetable UI is describing your
timetable out loud.

### Create memberships

Same shape: "Unlimited is £89. An 8-class pack is £59. Students £45,
off-peak only." Temple drafts the plans — Stripe products, booking rules,
the lot — and answers with the list and one question. Prices are the
owner's judgement, permanently: Temple never invents or changes a price on
its own, it only builds what it was told. On the member side, joining and
plan changes keep today's self-serve flows; what changes is the staff
side — routine change requests approve themselves against the owner's
precedent, the odd ones become a question, and the owner sees a line in
the Timeline either way.

### Run today's classes

The coach opens Today and sees the day: who's booked, how full each class
is, who's on the waitlist, who's brand new. In the class, the roster has
big tick targets and the workout underneath — the register and the
whiteboard in one place. The admin around it disappears rather than the
screen: everyone booked is marked as attended unless the coach unticks
them, no-shows resolve after class without transcription, and the
patterns (a regular gone quiet, a first-timer who didn't show) flow to
Retention on their own.

### Programming

Two rules anchor this. **Temple never rewrites a coach's programming or
invents a workout unasked** — the craft stays the coach's. And
**authoring keeps its existing UI**: writing a week is spatial,
iterative, tool work — the programming calendar editor coaches already
know stays the writing surface, same as Today kept the class calendar.
Chat earns its keep at the edges, never as the pen.

- **Writing the week** — the existing calendar editor, made lighter
  invisibly: the format/category pickers and untagged-sections
  housekeeping disappear because the classifier reads what the coach
  wrote (live today); percentages resolve to each member's own numbers
  (live today); leaderboards default sensibly with a per-section
  override where it always was. Nothing about how a coach writes
  changes; the admin around the writing evaporates.
- **The roadmap — the missing workflow.** A year overview of named
  blocks ("Squat strength — 8 weeks, deload week 4", "Open prep",
  "Engine block"), set by the owner or head coach, shared with the
  team — the thing the interviews asked for twice. It lives as a view
  on the programming calendar: a block strip above the week the coach
  is writing ("Squat cycle · week 3 of 8 · deload next week"), and a
  zoomed-out year. Coaches always know where in the plan they are, and
  programming in advance finally has somewhere to live.
- **Block-aware analysis.** The roadmap makes the verdicts smarter: a
  high heavy-share in week 3 of a strength cycle is the plan working,
  not a flag. Suggestions come as messages with hands ("Thursday is
  shoulder-heavy right after Tuesday's push day — want a swap?"),
  aggregate closed categories only, never an individual's health. The
  Analysis page survives in the Back Office for the deep dive.
- **Programming you buy.** A gym on PRVN, Mayhem or CrossFit Affiliate
  Programming pastes the provider's week and it lands *in the calendar
  editor as a draft* for the coach to review and post — intake by
  paste, review in the tool.
- **Individual programming** — the existing per-member calendar editor
  stays. On request ("put Marcus on a 3-day upper/lower block, nothing
  overhead") Temple drafts into that editor from the coach's stated
  constraints, weights from the member's own lifts — the coach finishes
  and ships it from the tool. Paid access keeps its store wiring, and
  programming talk never writes to health records; the injury tracker
  remains the only health surface.

### Look after one member

Any member is one sentence away — "show me Marcus" brings back the
picture, not a profile page: plan, tenure, the thing worth knowing
("fading — 3 classes a week in March, less than 1 now"), and an offer to
act. Acting is words too: "give him 2 free guest passes and tell him we
miss him" comes back as a drafted note in the gym's voice, sent on
approval, with the outcome returning as a receipt. The full profile — and
every other Back Office screen — stays one tap deeper for when it's
genuinely needed.

### The money

Loop 1 (specced): failed payments get chased by Temple, not listed for the
owner. "I got £74 back" is the whole owner experience; the judgement call
— "move Emma to the smaller plan?" — is a question with two choices.

### A coach drops out

"I can't do tomorrow's 6:30" — said to Temple, by the coach. Ops finds the
qualified, available cover, confirms both sides, updates the class. The
owner reads about it afterwards. Today's machinery (range requests,
qualification gating, nightly warnings) becomes the loop's sensors; the
daily nag emails become unnecessary.

### Reach your members

Nobody wants to build emails — they want things said to members, in the
gym's clothes. Branding is a standing guarantee, not a workflow: every
email Temple writes carries the gym's logo, colours and footer
automatically, and the one real button (the sending domain's DNS) lives
at go-live. From there, three shapes:

- **A newsletter is a sentence.** "Send a newsletter this week —
  Christmas hours, the new barbell club, a shout-out for Sarah." The
  draft *is* the preview card, adjusted in words, sent or scheduled with
  one tap. Subject testing just happens; the receipt says which line won
  and what people tapped. To all members, a cohort, or an audience said
  in words ("everyone who hasn't been in for three weeks") — resolved by
  the tag machinery that already exists, with new audiences always
  approval-gated.
- **A sequence is described.** "When someone joins, welcome them, nudge
  them to book, check in after two weeks." Temple lays it out as steps,
  writes each email in the gym's voice, the owner reads and turns it on
  — and it only applies to people who join from then on, exactly as the
  automation engine already behaves. Changes are sentences: "make the
  check-in a week later."
- **The front desk already talks.** Its voice — taught by interview,
  corrected turn by turn — becomes the shared voice everything above
  writes in. One gym, one voice, taught once.

What survives as machinery is everything the Comms Suite shipped this
quarter: branded compile-to-HTML, frozen scheduled sends, A/B splits,
idempotent fan-out, topics and one-click unsubscribe, sending domains.
What demotes to the Back Office is the authoring: the block builder (kept
for pixel control), the audience builder, the automation editor, and the
funnel screens — replaced by drafts, steps, and one-line receipts in the
Timeline.

### A member is fading

Attendance slides; Temple notices, reaches out in the gym's voice, tracks
what worked. The owner sees "3 at-risk members contacted; 2 rebooked" —
and gets a question only when the save needs judgement (a pause, an offer,
a conversation a human should have).

## What stays human, permanently

Waivers and health questionnaires are signed by the member's own hand.
Writing a member off is a human judgement. Prices are set by the owner.
Anything Temple sends follows owner-approved wording. And every action
Temple takes is one tap from "why?" and one tap from undo.
