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

### The runner — built

`npm run sim` (`scripts/run-sim.ts`, pure half in
`scripts/demo-gym/runner.ts`, tested). Against a seeded demo gym it:

1. Assigns every member a personality (seeded shuffle, so `--seed`
   replays the same gym), moves up to three never-started joins into the
   first-week job's 7–30 day window (never an imported member), and
   simulates each day back to the previous Sunday, ending yesterday.
2. Writes what a real month leaves behind: backdated `class_sessions`
   where the slot has none, bookings with attendance and no-shows in the
   seeder's own shapes, and dunning rows for simulated card failures —
   always with `next_payment_attempt` in play, never claiming Stripe
   gave up.
3. Fills the one gap a seeded gym has: the class-return job postdates
   the seeder, so its authority row and template are added at
   `approval` if missing.
4. Invokes all seven tick RPCs with the service-role key (they are
   revoked from every other principal) and prints what each proposed,
   what the ask budget held back, and — printed *before* the ticks run —
   what the sim itself expects of the class-return predicate per slot,
   so a disagreement between prediction and outcome is visible in one
   screen of output.

`--dry-run` prints the plan and predictions without writing;
`--tick-only` re-runs the ticks on consecutive mornings without adding
history. A run dirties the gym by design — teardown + re-seed (the Demo
gym workflow) is the reset.

**Where it runs: GitHub Actions, against the hosted project.** Nothing
in this project runs on a laptop. The **Run the gym** workflow
(`.github/workflows/run-the-gym.yml`) is the front door for all three
instruments — pick `sim`, `e2e`, `eval` or `all`, and read the job log.
It reuses the Demo gym workflow's secrets and shares its concurrency
group so a sim never races a reseed.

One honest limitation: the ticks read `now()`, so a run is "the morning
after a month", not thirty mornings. The per-day cadence question is
answered by running `--tick-only` on real consecutive days, or re-running
against fresh seeds at different `--days`.

---

## The plan, in order of what it would find

### 1. Simulate a month, then read it as an owner

Run the gym workflow → `sim` (or the whole thing with `all`), then open
the deployed app as the demo owner and scroll the Timeline.

The questions only this answers:

- How many questions does an owner meet on a normal morning? Is five a day
  right, or is three plenty?
- Do all seven jobs ever fire, or do two of them never come up?
- After thirty days, does the Timeline read as help or as a list?
- Does the same member get chased by two jobs in one week?
- Does the copy hold up forty lines deep, with real names and numbers?

### 2. Playwright, at two viewports — scaffolded

Run the gym workflow → `e2e` (`playwright.config.ts` + `e2e/`), against
the deployed app at `app.jointemple.io` by default (`E2E_BASE_URL`
overrides). Two projects — an iPhone-13 viewport and 1280px desktop —
because the StatTile wrap only shows narrow. Credentials default to the
demo owner and coach1 (`E2E_*` env overrides). Journeys 2 and 3 need
`ANTHROPIC_API_KEY` on the hosted functions — `E2E_PARSER=0` skips
them. The report uploads as a workflow artifact. The specs are written
against the real screens' copy and have not yet run against the live
app; expect first-run selector fixes. The journeys:

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

### 3. A parser eval — built

Run the gym workflow → `eval` (`scripts/run-parser-eval.ts`, fixtures
in `scripts/parser-eval/cases.ts`; needs the publishable anon key as a
repo variable or secret `SUPABASE_ANON_KEY`). 55 sentences through the
real path —
the bar's own shortlist, the deployed `parse-setup`, the same
full-catalogue fallback — signed in as the demo owner with a real JWT.
Five are refusal traps: "cancel Marcus's membership" must not become
`money.refund`, and a rule that varies by day must land in `cannot`
rather than being rounded to the nearest menu item. A CI guard test pins
every expected action name to the live registry, so a renamed verb fails
in CI rather than silently scoring as a parser miss. The run reports
passes, shortlist-fallback rescues (a latency cost, not a correctness
one), and exits non-zero only if a refusal trap emitted an action — the
one class of failure that is never acceptable.

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
