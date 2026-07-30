# Testing the talk bar

A plan for testing what the bar can do, written so the expensive part —
your time — is spent only on the part that needs a person.

Read this with `docs/roadmap.md`. It is organised by module, and each
module's section is written to be worked through in one sitting.

---

## Why the plan is shaped like this

Every action on the registry has three layers, and they fail in
completely different ways:

| Layer | What breaks | Who catches it |
|---|---|---|
| `sanitise` | A malformed or hostile payload gets through, or a valid one is refused | **vitest** — pure, free, exhaustive. No database, no model. |
| `preview` / `apply` | The write is wrong, unauthorised, or breaks an invariant | **pgTAP** — runs the real RPC as a real role against real RLS |
| the sentence | The right words produce the wrong action, or no action | **only you.** A model call is not a unit test. |

So the automated layers are written to be exhaustive precisely so that
your session is *only* layer three. If you find yourself checking whether
a price was stored in pence, that is a test I failed to write — tell me
and I will write it instead of you repeating it.

**What this means in practice.** Per module: I ship, you spend about
twenty minutes saying things. You are not testing a flow or a screen. You
are testing whether the gym understood you.

---

## How to run a sentence session

1. Open the Timeline as an owner on a gym with real-ish data — some
   members, a timetable, at least one plan.
2. Work down the module's **Say this** list. For each row, say the
   phrasing given, then say it again in your own words.
3. For each, note one of four outcomes:

   - **Right** — the card said what you meant.
   - **Wrong action** — it did something else. Tell me the sentence and
     what came back. This is a `says` problem, and it is the most
     valuable thing you can find.
   - **Right action, wrong details** — the verb was right, a number or a
     name was not. This is an argument-description problem.
   - **Didn't catch it** — you got "I didn't catch that one". Note it;
     a sentence a real owner would say and the bar refuses is a gap, not
     a user error.

4. Then work the module's **Try to break it** list. These are the ones
   where being refused is the *correct* answer, and a confident wrong
   answer is a bug.

Do not confirm a card during a phrasing pass unless the row says to.
Reading the card is the test; applying it is a separate pass.

---

## What is already covered automatically

Do not spend session time on these — they are pinned by tests that run on
every push.

**Registry invariants** (`src/lib/actions/actions.test.ts`): unique
dotted names, unique argument names within an action, every argument
described, every `do` has an `apply` and no `ask` does, `actionsFor`
refuses on both `false` and `undefined` (a capability set that hasn't
loaded is not permission), and every verb the bar answers to is present
in the catalogue.

**Money parsing** (`argMoney`): `1`, `"1"`, `"1.50"`, `"£1.50"` all land
in pence; a third decimal place, a negative, a word, and an absurd
figure are all refused rather than rounded.

**Rule values** (`sanitiseRuleChanges`): an invented field name, an
off-menu enum, and an out-of-bounds number are all dropped. Numeric
fields accept off-menu values inside their bounds; `late_cancel` is
checked by shape because any time and any number of minutes is a real
answer.

**Bulk class edits** (`sanitiseClassEdit`): every field re-checked
against the bulk editor's own bounds, and a request that names no actual
change is dropped rather than shown as an empty confirm.

**Import column detection** (`src/lib/import/columns.ts`): including the
guard that stops `Emergency Contact Number` being filed as a member's own
phone.

---

## Module: how the gym runs — `gym.change_rules`

Live. The rules that were day-one questions, changeable by sentence
afterwards, plus the tappable rule sheet behind "Your rules".

### Say this

| Say | Expect |
|---|---|
| free cancel until 2 hours before | `Cancelling costs the credit from 2 hours before (was …)` |
| cancelling is free from 30 minutes before | same shape, `rel:30` |
| people can cancel free until 9pm the night before | `abs:21:00` |
| let people book 3 days out | booking window 72 hours |
| members can book two weeks ahead | 336 hours |
| there's no limit on how far ahead people book | no limit |
| booking closes an hour before the class | cutoff 60 |
| let people book right up to the start | cutoff 0 |
| members can book without a membership | the boolean flips |
| the week starts on Sunday | `sun` |
| show weights in pounds | `lb` |
| turn the leaderboards off | boolean |
| stop people signing up from the website | `public_signup` false |
| members can only message their coach | `member_coach_only` |
| let under-18s join | `allow_minors` |
| memberships show as expiring 30 days out | `expiring_within_days` |

Then open **Your rules** and tap a value — it should apply immediately
with a receipt line, no confirm card, and the sheet should refresh. That
tap goes through the same action a sentence does.

### Try to break it

| Say | Correct answer |
|---|---|
| free cancel until 90 minutes before on Saturdays only | refuse — a rule that varies by day isn't a rule Temple has. Should name it in the "not from here yet" reply, not round to every day. |
| cancelling is free until quarter past nine the night before | should land `abs:21:15` — this one is not a menu |
| the week starts on Wednesday | refuse — not a real value |
| make cancelling free for members on the unlimited plan | refuse — varies by member |
| free cancel until 2 hours before *(said twice in a row)* | second time: "Those are already how the gym runs." |

---

## Module: the timetable — `gym.add_classes`, `classes.edit`,
`gym.close_dates`

Live. Adding a class, changing classes that already exist, and shutting
the gym.

### Say this

| Say | Expect |
|---|---|
| add a 7am Wednesday spin class, cap 12 | one schedule, Wed 07:00, 60 min, cap 12 |
| CrossFit at 6 and 7 on weekdays | one schedule, Mon–Fri, two times |
| put a 9:30 Saturday morning class on, 45 minutes | duration 45 |
| add a 6pm Tuesday class | capacity defaults to 16, duration to 60 |
| cap Saturdays at 20 | `classes.edit`, Sat only, capped at 12 weeks with the card saying so |
| move the Tuesday 6am half an hour later | shift +30 |
| bring Wednesday spin forward 15 minutes | shift −15 |
| make the Friday sessions 45 minutes | duration only |
| cap CrossFit at 18 from the 1st of September | bounded window, the dates read back |
| close 24 to 28 December | closure, dates resolved to the *next* December |
| we're shut next Monday for the bank holiday | one day, reason carried |

The class edit card must show three real classes, the count, and the
window. Check the classes it lists are the ones you meant *before*
confirming — that is the whole point of the card.

### Try to break it

| Say | Correct answer |
|---|---|
| cap Saturdays at 20 *(on a gym with no Saturday classes)* | "Nothing on the calendar matches that" — not an empty confirm |
| move the Tuesday 6am two days later | refuse or clamp — this is a reschedule, not a shift |
| cap the Saturday class at 2 *(when 15 are booked)* | the card should let you, and the *receipt* should say how many were left alone because more members are booked than the new capacity |
| add a 7am Wednesday spin class *(when one already exists)* | reuse the existing class type rather than duplicating it |
| close the gym from the 28th to the 24th | refuse |
| close the gym last week | past dates — should refuse or resolve forward |
| add a spin class every day at 6, 7, 8, 9, 10, 11 and 12 | should work; check the count on the card is right |

---

## Module: memberships and plans — `gym.add_plans`

Live for *creating* a plan. Assigning one to a person is the members
module, below.

### Say this

| Say | Expect |
|---|---|
| an off-peak membership at £59 | one plan, £59 |
| add a 10-class pack for £90 | `credit_pack`, 10 credits |
| a student membership at £45, 8 classes a month | `credit_period`, credit_count 8 |
| unlimited at £89 with 30 days notice to cancel | notice_period_days 30 |
| a programming-only plan at £20 | `programming_only` |

### Try to break it

| Say | Correct answer |
|---|---|
| an off-peak membership at £59 *(twice)* | "One of those plans already exists — nothing was created." |
| drop the unlimited plan to £79 | should be read as a price change, not a second plan — `money.set_plan_price`, with the existing members' price stated |
| make the student plan £45 a week | refuse or name it — Temple plans are monthly |
| a free trial plan | £0 should be accepted; check it reads back as free, not as blank |

---

## Module: writing to members — `comms.draft_newsletter`

Live. Drafts into the comms editor; nothing sends from the bar.

### Say this

| Say | Expect |
|---|---|
| send a newsletter — Christmas hours and the new barbell club | subject + 2–4 sections, opens the campaign editor on confirm |
| write to the members about the new squat racks | copy that introduces the topic without inventing details |

### Try to break it

| Say | Correct answer |
|---|---|
| send a newsletter saying we're closed the 24th to the 28th and the Christmas party is on the 20th at 7pm | it may use those facts — you stated them. Check it invented **nothing else**: no prices, no other dates, no names. |
| email everyone their new price | refuse — it does not know a price and must not invent one |
| send it now | nothing should send. The send button in the editor remains the only approval. |

---

## Module: the shop — `store.add_product`, `store.set_price`, `store.sales`

Live.

### Say this

| Say | Expect |
|---|---|
| add a water bottle for £1 | £1, physical, stock untracked |
| sell hoodies at £35, we have 20 | stock 20, "stops selling at zero" |
| add the technique guide as a £12 download | digital, **hidden** until you attach the file |
| make the water bottle £2 | resolves the product by what you called it |
| what are sales like in the store | an answer card, no confirm |
| how much did the shop take last month | 30-day window |

### Try to break it

| Say | Correct answer |
|---|---|
| make the bottle £2 *(with a Small bottle and a Large bottle in the shop)* | refuse to choose — say it can't tell them apart |
| add a water bottle for a fiver | refuse the price rather than guess |
| add a water bottle for £1.005 | refuse rather than round |
| make the water bottle £2 *(on a recurring product)* | the card must say existing subscribers keep their price |
| what are sales like *(as a coach)* | the action should not be offered at all — `can_see_store_revenue` |

---

## Module: asking about a member — `members.find`

Live. The bar's only read so far.

### Say this

| Say | Expect |
|---|---|
| show me Marcus | one member card: status, plan and price, credits, comps, failed payment if any, tags |
| what's Sarah Jones on | the same card |
| is Dan still paying | the same card — a failed payment shows with its past-due date |

### Try to break it

| Say | Correct answer |
|---|---|
| show me Webb *(two members share it)* | a question with a chip per person; tapping one brings that member back |
| show me Marcus *(two Marcuses)* | chips, not a guess |
| show me marcus *(lowercase, partial)* | should still land — matching is ranked, and an exact first or last name answers outright |
| show me Nobody | "No one called "Nobody" on your books." |
| show me Marcus's injuries | must refuse. The member card carries **no health data** by design; PAR-Q and injuries stay behind the audited surfaces. |
| show me Marcus *(as a coach)* | the card should come back with fewer facts, not an error — money and tags are best-effort under RLS |

---

## Cross-module: things that should always be true

Worth one pass after any module ships.

| Check | Why |
|---|---|
| Say something the bar can't do — "refund Marcus's last payment" | should get the fixed "not from here yet" reply, never a guess |
| Say something meaningless — "asdf" | "I didn't catch that one", with examples |
| Say "continue setup" | goes to the setup conversation without a model round-trip |
| Tap **No** on any card | the card closes, nothing is written |
| Confirm a card, then confirm it again | the second should be a no-op, not a double write |
| Leave a card open, change the thing another way, then confirm | rules and class edits re-read live state in `apply`, so it should act on what's true *now* or tell you nothing matches |
| Kill the network mid-confirm | "That didn't save — try again", and nothing half-written |
| Do all of it as a coach, then as an admin | each should be offered only what their capabilities allow — and the write is refused by RLS regardless of what the bar offered |

---

## Module: members — `members.assign_plan`, `members.comp`,
`members.tag`, `members.message`

New, and the first module with writes that did not exist before, so this
section is longer than the others. Read the two paragraphs before the
tables — they explain what the cards are claiming, which is what you are
checking.

**What "not billed" means.** An assigned membership is a *continuation*,
the same thing the CSV importer has always produced: the member is
genuinely on the plan and can book from the moment you confirm, but no
money moves and Stripe is never involved. When they later want to start
paying, their own membership screen adopts that same row rather than
opening a second one — so no second membership, no double charge, and
their history stays in one piece. That is the promise the card makes with
the words "not billed", and it is the thing most worth trying to break.

**How long it runs.** The plan's own period, per your answer: a monthly
plan runs a month, a `credit_period` plan runs its own period length, and
a class pack has *no* end date because the credits are the limit. Saying
"until the end of March" overrides all of it. When an assignment reaches
its end date a nightly job lapses it — so if you assign something with a
short window, come back the next day and check the member's access
actually stopped.

### Say this — putting someone on a plan

| Say | Expect |
|---|---|
| put Marcus on Unlimited | If he's on nothing: a confirm card, "£89 a month, not billed", "a month from today" |
| put Marcus on Unlimited *(when he's already on Off-peak)* | **Not a card — a question.** "Marcus is on Off-peak, £59 a month." plus two chips: move them, or add it as well |
| *then tap* Move them to Unlimited | The confirm card, with "the same membership changes plan — nothing restarts" |
| *then tap* Add Unlimited as well | Same card, but it should NOT say anything about moving — he'll end up with two |
| move Sarah to off-peak | The same flow, phrased as a move from the start |
| give Dan the ten-class pack | 10 credits, and **no end date** — the card should say the credits are the limit |
| put Jo on Unlimited until the end of March | Runs to 31 March, said in words on the card |
| put Marcus on the student plan | Matches the plan by what you called it, not what you typed it as |

After confirming, open that member's profile and check the membership
reads the way the receipt said. Then, as the member, check they can
actually book a class — that is the one thing a passing test cannot fully
prove for you.

### Say this — comping, tagging, messaging

| Say | Expect |
|---|---|
| comp Sarah for a month | Unmetered inside the window, ends a month out, and the card warns she'll read as "On an intro" |
| give Dan 5 free classes | 5 credits rather than a window's worth |
| put Jo on us for two weeks while she's injured | 14 days, reason carried onto the card |
| tag Jo as injured | Staff-only by default, and the card says the tag rules will see it |
| tag Marcus as a competitor, he should see it | Member-visible |
| message Marcus that his 6am is moved to 6:30 | The card shows the exact words before sending; nothing is embellished |

### Try to break it

This is the important table. Every row is a case where refusing, or
saying something specific, is the correct answer.

| Say / do | Correct answer |
|---|---|
| put Marcus on Unlimited *(when Marcus pays by card through Stripe)* | **Must refuse in words.** "He pays by card, so moving him is a billing change I can't make from here yet." Never a silent row edit — that would leave him paying the old price forever. |
| put Marcus on Unlimited *(twice, confirming both)* | The second should move the same membership, not open a second one. Check his profile shows one. |
| put Marcus on a plan you archived last week | "You don't have a plan called …" — a retired plan is not assignable |
| put Marcus on Gold *(when you have "Gold" and "Gold Plus")* | A question listing both, not a guess |
| put someone from another gym on your plan | "No one called … on your books." |
| put Marcus on Unlimited *(as a coach)* | Should work — `can_assign_plan` covers coaches. Then switch it off for coaches in the team screen and check the bar stops offering it. |
| comp Marcus *(as a coach, then as an admin)* | Both should work. An admin being refused is the bug this shipped to fix. |
| comp Sarah for 5 years | Refuse the window rather than comp her until 2031 |
| put Marcus on Unlimited *(when Marcus hasn't claimed his account yet)* | **Earmark, not assign.** "It lands the moment they claim their account — nothing to pay, and no signing up again." Then have him claim it and check the membership is there. |
| earmark a plan for someone who already joined | Refuse — "they've already claimed their account, put them on the plan directly" |
| tag Jo as injured, twice | "Jo already has that tag" — not an error, and not a duplicate |
| tag Jo as Injured *(different capitalisation)* | Should also say she already has it, rather than creating a second |
| message someone who hasn't claimed their account | "There's nowhere to message them" |
| put Jo on the programming-only plan, then have Jo try to book a class | She should be refused at booking — that plan doesn't cover classes. Check the refusal is comprehensible. |
| assign a `credit_period` plan, then wait for the month to turn | The credits will **not** top up on their own while it's unbilled. The card says so; check it does. |
| assign with a short end date, then come back tomorrow | Access should have stopped. |

### The one to watch

Assigning a plan or issuing a comp changes what the member's cohort flags
say, which the nightly tag-rule sweep reads, which the email automations
read. So a plan assigned today can cause an automated email tomorrow if
you have an automation watching an auto tag. Worth one deliberate check:
assign a plan, then look at the automations queue the next day and
confirm nothing went out that you didn't intend.

---

## Module: classes and bookings — `classes.cancel`,
`classes.book_member`, `classes.remove_member`

Three things happen underneath these that no other module does: members get
told, credits move, and the waitlist fills the space. Most of the "try to
break it" rows below are about whether the card was honest about which.

### Say this

| Say | Expect |
|---|---|
| cancel tomorrow's 6am | The class, how many are booked, that they get their credit and a note, and that it cannot be undone |
| no spin on Friday | Same, matched by class name |
| cancel the Tuesday 7pm from now on | The series — and it should say the repeat is ended too |
| put Marcus in Saturday's 9am | Booked, no credit taken |
| book Sarah into tonight's spin | Same |
| take Sarah out of tonight's class | **Two chips** — credit back, or keep the credit |
| Marcus can't make Saturday's 9am | Same |

### Try to break it

| Say / do | Correct answer |
|---|---|
| cancel tomorrow's 6am *(when two classes run at 6am)* | A chip per class, not a guess |
| cancel a class that has already started | Refused — "too late to cancel it" |
| cancel the same class twice | The second says it's not there any more |
| cancel the Tuesday 7pm from now on *(on a one-off)* | "That one is a one-off, so there is no repeat to cancel" |
| **cancel a class, then check a booked member's phone** | They should have an in-app notice naming the class and the date. This is the one worth actually verifying on a second device. |
| put Marcus in a full class | Two chips: over the cap, or the waitlist |
| *then* over the cap, as a coach with the override switched off | Refused — "you do not have permission to go over a class cap" |
| put Marcus in a class he's already in | "They are already in that class", not a silent second booking |
| put Marcus on the waitlist for a class with room | Refused — book him in instead |
| put someone with no PAR-Q into a class | Refused, naming the PAR-Q |
| take someone out who isn't in it | "They are not in that class" |
| take someone out, keep the credit, then check their balance | It should be unchanged. This is the half that had no write at all before. |
| take someone out of a class with a waitlist | The receipt names who came off it — or doesn't, if nobody eligible was waiting |

### Not yet, and the bar should say so

| Say | Expect |
|---|---|
| Dan is covering Tuesday's 6am | Should NOT claim to reassign — `claim_cover` is self-claim only and there is no reassignment write anywhere |
| move Friday's 7pm to 7:30 | Not offered as a single-class move; doing it through the bulk editor silently rewrites the whole recurrence |

---

## Cross-module: does it remember?

New, and worth ten minutes on its own because it changes every module at
once.

| Do this | Expect |
|---|---|
| "show me Marcus" then "put him on Unlimited" | The second should know who "him" is, and the card should name **Marcus Webb in full** before you confirm |
| "show me Marcus" then "comp him for a month" | Same |
| "cancel tomorrow's 6am" then "actually make it Friday's instead" | Should re-resolve the class, not re-cancel the first |
| **"show me Marcus", wait 15 minutes, then "put him on Off-peak"** | Should **not** know who you mean. This is the important one — the window is ten minutes, and a cold subject must fail to understand rather than act on the wrong person. |
| Say seven or eight unrelated things, then use a pronoun | Only the last six turns are carried, so it should have let go |
| Refresh the page mid-conversation | The conversation is gone — it lives in memory, not the database. Expected today; persisting it is the unbuilt half of roadmap step 3. |

If a pronoun resolves to the **wrong** person at any point, stop and tell
me immediately. That is the one failure mode here worse than not
understanding.

## Module: the money — `money.summary`

| Say | Expect |
|---|---|
| what did we take last month | The whole previous calendar month, named back ("1 to 31 July 2026") |
| how much came in last week | The week, memberships and shop split out |
| how did July go | Same |
| what are we making | No period named, so the last 30 days — and it should say so |

### Try to break it

| Say / do | Correct answer |
|---|---|
| what did we take between the 1st and the 31st *(no month)* | Should fall back to 30 days rather than guessing a month |
| what did we take in 2019 | An honest zero, not an error |
| ask it as a coach | Not offered at all — `can_see_money` is owner-only by default |
| check the failing-payments line against the money screen | The count and the at-risk figure should agree |

---

## Module: what a plan costs — `money.set_plan_price`

The whole point of this one is the sentence about who *doesn't* pay the
new price. Read it on every card.

| Say | Expect |
|---|---|
| put unlimited up to £60 | £50 → £60 a month, the count of members already on it, and that they keep £50 |
| drop off-peak to £35 | Same shape, going down |
| make the ten class pack £90 | "£90 one off" — a pack is bought once, not billed monthly |
| make the intro plan free | £0 accepted, and it should read back as £0 rather than blank |

### Try to break it

| Say / do | Correct answer |
|---|---|
| put unlimited up to £60 *(twice)* | The second time: "Unlimited is already £60." No confirm card |
| change the price of the gold plan *(no such plan)* | "You don't have a plan called 'the gold plan'." |
| put the membership up to £60 *(two plans match)* | Chips naming both, not a guess |
| put unlimited up to £59.999 | Refused rather than rounded |
| as an admin the owner has NOT granted "Manage plans" | Not offered — and if forced, refused by the database, not just the screen |
| as an admin the owner HAS granted it | Works. This is 0215's point: the Team screen's switch now governs the table |

### The one that only shows up in Stripe

This is the bug 0215 exists for, and it is invisible in the app.

1. Connect Stripe, put a plan at £50, and let one member sign up through
   Checkout (that first checkout is what mints the Stripe Price).
2. Change the price to £60 — from the chat *or* the plans screen; both
   go through the same trigger.
3. Sign up a second member. **They must be charged £60.** Before 0215
   they were charged £50 for ever, and no screen in Temple disagreed.
4. The first member's next invoice must still be £50. A price rise is
   never backdated, and `plan_subscriptions.price_cents` is what proves
   it.

---

## Module: giving money back — `money.refund`

The only verb in the registry that moves money out of the gym's account.
The mode is deliberately not something the parser can choose — the card
asks every time, with the real arithmetic on each option.

| Say | Expect |
|---|---|
| refund Marcus | Four chips (or three), each with its own amount: the unused part / all of it to period end / all of it now / goodwill |
| pick "the unused part" | A confirm naming the amount, that access ends now, that they get an email, and that it does not come off revenue |
| pick "goodwill" | The confirm should say the membership carries on |
| give Dan £20 back | The goodwill chip should read £20, not the full charge |
| refund Sarah and don't tell her | The confirm should say no email goes out |

### Try to break it

| Say / do | Correct answer |
|---|---|
| refund Marcus *(already refunded)* | "…has already been refunded or cancelled." No chips |
| refund someone who has never paid | "No settled payment on their membership, so there is nothing to give back." |
| refund someone still on the import list | "…has not claimed their account yet, so there is no payment of theirs to refund." |
| refund Marcus *(period fully elapsed)* | The pro-rata chip should be **absent** — £0 back while ending access is not a refund |
| as a coach granted `can_refund` but not `can_see_money` | "I cannot see the payments on this account" — not "they never paid" |
| refund a member at a gym with no Stripe connected | The edge function's own words: "This gym has not connected Stripe yet" |
| leave the card open, refund from the member screen, then confirm the card | The second one should be refused by the server, not double-refund |

### Check it landed

- Stripe dashboard shows the refund on the **connected** account.
- `billing_events` has a `kind='refund'` row and the money summary is
  **unchanged** — refunds are excluded from revenue by design (0019).
- The member's own screen shows the right thing: gone, ending on a date,
  or unchanged, matching the mode picked.

---

## Module: reaching members — `comms.draft_newsletter`, `comms.describe_sequence`

The newsletter's audience line is the thing to read on every card. A
draft addressed to the wrong people looks exactly like one addressed to
the right ones.

| Say | Expect |
|---|---|
| send a newsletter — Christmas hours and the new barbell club | "To All members — N people." then the sections |
| email everyone on the injured tag about the new rehab class | "To Injured — N people." N should match the tag on the members screen |
| tell the lapsed lot we miss them | Cohort `expired`, not a tag |
| email the members about to run out | Cohort `expiring_soon` |
| open the draft and check the audience | The campaign screen must show the same audience the card promised |

### Try to break it

| Say / do | Correct answer |
|---|---|
| email the powerlifters *(no such tag)* | "No tag here called 'powerlifters' — nobody would get this." It must **not** quietly become everybody |
| email everyone on the INJURED tag *(wrong case)* | Should still resolve — matching is case-insensitive |
| email the injured members and the lapsed ones | Tag wins; naming a tag is the more specific thing to have said |
| delete the tag, then confirm a card that was already open | The receipt should reflect the audience as it is at Yes, not as it was at preview |

---

## Module: sequences — `comms.describe_sequence`

The first thing the bar drafts that keeps running after you close it.
Every card must say it arrives switched off, and it must actually be off.

| Say | Expect |
|---|---|
| when someone joins, welcome them and check in after a week | Two emails, "Straight away" and "A week later", starts on join |
| when someone joins, welcome them, then a week later, then at a month | Three, at 0 / 7 / 28 days |
| email members who have not been in for a month | Trigger is inactivity, threshold 30 days |
| when I tag someone VIP, send them the members' guide | Starts on the tag, and only if someone holds it |
| chase an enquiry that has gone quiet for two days | Lead cold, 48 hours |

### Check it landed

- The automations screen shows it **disabled**. Turning it on is a
  separate, deliberate act.
- Open it: the trigger, the wait and every follow-up's delay match what
  the card said.
- **The delays are from the trigger, not from each other.** "Welcome,
  then a week later" is day 0 and day 7 — if the second one reads day 14
  the anchor arithmetic is wrong.
- **Inactivity and cold-lead sequences must show delay 0 on the primary
  email** with the number in the threshold instead. This is the trap: for
  those two the wait *is* the trigger, so a primary that stored "14 days
  after" would fire at the threshold and the screen would disagree with
  the card.
- Turn one on with a test member and confirm it actually sends — the
  engine is a cron sweep, so allow a cycle.

### Try to break it

| Say / do | Correct answer |
|---|---|
| when I tag someone VIP… *(no member holds "VIP")* | Refused with "nobody at your gym is tagged VIP, so this would never fire" |
| set up a sequence *(no trigger stated)* | Refused rather than defaulted — when a program fires is not something to guess |
| when someone joins, send them eight emails | Capped at five |
| welcome them in 4000 days | Falls back to straight away rather than scheduling it eleven years out |
| as a coach without `can_manage_comms` | Not offered at all |

---

## Module: the enquiries — `leads.add`, `leads.set_status`, `leads.assign`, `leads.pipeline`

This is the module you can test fastest, because taking an enquiry down
while someone is still on the phone is the actual job.

| Say | Expect |
|---|---|
| someone rang, Sarah Jones, 07700 900123 | Name and phone, no source, and the line about the assignment rule |
| add a lead, Dan Webb, dan@example.com, found us on Instagram | Source matched to your real Instagram source |
| a walk-in came in asking about memberships, Jo Patel | Takes it with no contact details, and says so plainly |
| Sarah's booked her intro | `intro_booked`, with what she was before |
| I spoke to Dan | `contacted` |
| Jo came in for her trial | `trial_attended` |
| we lost Marcus, he went elsewhere | `lost`, and the card says they come off the board |
| give Priya to Marcus | Handover card naming both |
| how's the pipeline looking | Counts by stage, plus anyone waiting more than two days |
| who has enquired this week | Same, scoped to seven days |

### Try to break it

| Say / do | Correct answer |
|---|---|
| someone rang, Sarah Jones *(already on the list)* | "Sarah Jones is already on your list — …". No second row |
| Sarah's booked her intro *(two Sarahs)* | Chips naming both with their current stage, not a guess |
| mark Dan as joined / converted | Refused — a conversion needs their member account, so that stays on the leads screen |
| Sarah's booked her intro *(said twice)* | Second time: "already down as booked in for an intro" |
| give Sarah to Beyoncé | "Nobody on your team answers to that" |
| add a lead with a source you don't have | Takes it down without a source and says so, rather than inventing one |
| ask about the pipeline with no leads at all | "Nobody is on your enquiries list" |

### The permission pass (0217)

Worth doing once, because it never worked before and the screen said it did.

1. Team → role permissions → turn **Assign plans** off for coaches.
2. Sign in as a coach. The leads board should be gone from their screen —
   that part always worked.
3. Now have them try it from the chat: "someone rang, Test Person". It
   must be **refused**. Before 0217 the screen hid the board and every
   write behind it still succeeded.
4. Turn it back on and confirm they can again.
5. Remove a coach from the gym entirely, then check they cannot reach the
   enquiries — the old gate had no left-the-gym check at all.

---

*Module sections are added here as each ships.*
