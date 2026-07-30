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
| drop the unlimited plan to £79 | refuse for now — changing an existing plan's price is the money module, and the reply should say so rather than creating a second plan |
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

*Module sections are added here as each ships. The next one is members.*
