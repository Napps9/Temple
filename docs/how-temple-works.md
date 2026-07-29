# How Temple comes together

The whole product, on one page, organised by the work — not the screens.
Companion to `docs/vision.md` (the argument) and
`docs/loop-1-payment-recovery.md` (the first loop's engineering).

## The shape

Three places and a talk bar.

- **Timeline** — home. What happened, as short messages from Temple; what
  needs you, as a question with two choices; what got resolved, as one
  soft line. Scrolling back is the record.
- **Roster** — who works for you. What Temple handles, what it may do on
  its own versus what it asks about, and where you coach it.
- **Goals** — what you're aiming at. "200 members by December" as a brief
  you've given an employee, with a weekly note on how it's going.

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
its own, it only builds what it was told. Upgrades and downgrades stop
being a policy screen: a member asks their own Temple "can I move up to
unlimited?", the pro-rata answer is computed and applied within the rules,
and the owner sees a line in the Timeline.

### Programming

The coach writes the week the way they always have — typed, pasted, or
dictated. Temple reads it: movements, time domains, load (the
`classify-programming` reader is live today), and every member sees their
own numbers where the coach wrote percentages (live today). What changes
is that analysis stops being a page and becomes a message with hands:
"Thursday is shoulder-heavy right after Tuesday's push day. Want a swap
suggestion?" Aggregate signals only, never an individual's health — the
same closed-category discipline the front desk already obeys.

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
