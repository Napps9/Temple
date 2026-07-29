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
  first"). Taking on a new job is an offer letter — what I'll do, what
  I'll ask you about, what I'll never do — not a settings page.
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

The coach writes the week the way they always have — typed, pasted, or
dictated. Temple reads it: movements, time domains, load (the
`classify-programming` reader is live today), and every member sees their
own numbers where the coach wrote percentages (live today). What changes
is that analysis stops being a page and becomes a message with hands:
"Thursday is shoulder-heavy right after Tuesday's push day. Want a swap
suggestion?" Aggregate signals only, never an individual's health — the
same closed-category discipline the front desk already obeys.

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
