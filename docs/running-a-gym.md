# Running a gym

Companion to `docs/testing-plan.md`, which is a session of *sentences* —
say this, try to break it. This is the other thing: the gym **living**,
for weeks, so the jobs have to decide something and the Timeline has to be
worth reading on a Tuesday.

The concern this exists to answer: most of what this codebase has found
was found by reading code, and the one bug a human found was found by
looking at a screen. Neither method scales, and neither can tell you
whether a month of Temple feels like help.

---

## Why the demo gym cannot answer it as it stands

`npm run seed:demo` builds a good tenant — roster, timetable, training
history, programming, store, and a cast for the jobs. It is **static by
design**, and says so:

> Nothing here runs a tick. […] These rows are written directly, in the
> shape a tick writes them, so the demo says the same thing on any day.

Right for a demo; wrong for finding bugs. **The jobs never run.** Every
proposal in the demo Timeline was written by the seeder, not produced by
`agent_class_return_tick` deciding a slot had thinned out. So the demo can
never tell you whether the thresholds fire, whether the budget is sane, or
whether a week of Timeline is signal or noise.

## What is missing: a clock

`scripts/demo-gym/simulate.ts` is the generator half, and it is built and
tested. It is deliberately pure — no network, no wall clock — so it runs
without a database and a bad month replays exactly.

**Personalities, not uniform randomness.** A gym where everyone attends
with equal probability never thins out, so no job ever fires and it looks
like the jobs are broken when it is the data that has no shape. So:
`regular`, `twice_weekly`, `weekender`, `drifting` (decays ~22% a week),
`sporadic`, `never_started`.

### It has already found two things, before touching a database

Both are pinned as tests in `simulate.test.ts`:

1. **A twelve-person slot can never trigger the class-return job.** It
   averages 3.75 a session, below the job's floor of four — so however
   badly it empties, the job stays silent. The floor is doing its job
   (four is where two holidays stop looking like a trend), but a small
   demo gym would show the seventh job switched on and silent forever, and
   anyone would reasonably conclude it was broken.

2. **A loyal core hides a large loss.** Sixteen people drift away from a
   slot; with four regulars left the job speaks up (9.3 → 4.8), with six
   it does not (9.3 → 7.3, a drop of 2.0 against a 3.7 bar). Same sixteen
   people gone. Whether that is correct is a real product question — the
   class is arguably still healthy, or you arguably lost sixteen members
   in silence — and it is now a decision somebody makes rather than a
   number somebody nudges.

Neither is reachable by a unit test of the SQL, because both are about the
*shape of a gym* rather than the correctness of a predicate.

### What still needs building

The runner: apply a simulated day's events to a seeded gym, then invoke
the real tick RPCs. They are `revoke all … from public, anon,
authenticated`, so it calls them with the service-role key exactly as the
seeder already does. Then print what each job proposed, what it held back,
and what the Timeline would say.

Not built here because this environment cannot reach a database — the
sandbox denies the Supabase host and the CLI is not installed. It needs a
machine with a stack.

---

## The plan, in order of what it would find

### 1. Simulate a month, then read it as an owner

`npm run sim -- --days 30 --seed 2026` against a seeded gym, then open the
Timeline and scroll.

The questions only this answers:

- How many questions does an owner meet on a normal morning? Is five a day
  right, or is three plenty?
- Do all seven jobs ever fire, or do two of them never come up?
- After thirty days, does the Timeline read as help or as a list?
- Does the same member get chased by two jobs in one week?
- Does the copy hold up forty lines deep, with real names and numbers?

### 2. Playwright, at two viewports

Chromium and Playwright are already configured here. Six journeys:

| Journey | What it catches |
|---|---|
| Sign in → Timeline renders | The whole stack agreeing |
| Say a sentence → card appears | Parser, registry, preview |
| Confirm → receipt, write landed | Dispatch and invalidation |
| Manage → Settings **as an admin** | That the owner-only sections are absent |
| Campaign report at 390px and 1280px | **Layout** — the `StatTile` class of bug |
| Rule sheet → tap a value → saves | The tap path and refetch |

The fifth is the one that would have caught the wrapped label. jsdom has
no layout engine and NativeWind is stubbed in the render tests, so a real
browser is the only thing that can see a wrap.

### 3. A parser eval

66 actions and **zero coverage** of the English → action mapping — the
highest-variance part of the product. ~50 sentences with expected action
and args, run against the real `parse-setup`. Include the refusals: "cancel
Marcus's membership" must not become `money.refund`, and a rule that varies
by day must land in `cannot` rather than being rounded to the nearest
menu item.

### 4. More render tests

Cheap now the harness exists. The Timeline's card dispatch first — one
branch per event kind, and a missed branch renders blank.

---

## What none of it covers

**None of this is a real gym.** The simulator uses the member behaviour I
imagined; Playwright follows the paths I thought of; the eval contains the
sentences I predicted. The first real week will find things none of them
can.

The value is not that it replaces that week. It is that it clears out the
faults that would otherwise consume it, so the week gets spent on the
questions only a real gym can answer.
