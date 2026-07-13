# Demo gym seeder

One command creates a believable, fully-populated gym with **real,
signable-in accounts**, so every feature can be tested end to end —
programming, booking, attendance history, PRs and leaderboards, Hyrox
races, injuries and staff alerts, DMs, leads, a draft campaign, the
store, and a website. One command removes it all again.

## What you get (defaults — `--discipline crossfit`)

- **43 accounts**: 1 owner, 2 coaches, 40 members — all sharing the
  password `TempleDemo1!`, all on `@demo-ironworks.temple.test`
  (`.test` is IANA-reserved: mail can never route).
- **6 weeks of timetable** (4 back, 2 forward) across 5 class types,
  with ~900 bookings carrying realistic attendance and no-show marks,
  plus one full future class with a 3-deep waitlist.
- **A programmed WOD for every class-type/date it actually ran**
  (Open Gym excepted — it's unstructured free-training) — a small
  rotation of real strength + WOD content per class type, so the
  Programming tab (the first nav item on both sides) isn't empty.
- **10 weeks of workout history** for 15 members with progressing PRs
  drawn from the real movement catalog, and 2 Hyrox race simulations
  with full 24-split breakdowns.
- 4 members who have **left** (lapsed subscriptions), 5
  **pending_members** (import staging), 10 **leads** across every
  pipeline status, 3 **injuries** (2 unacknowledged staff alerts), 3
  scripted **DM threads**, 3 **store products** (one digital with a
  real downloadable asset), and a **published website** built from the
  Strength template.
- Everything is deterministic for a given `--seed` — two runs produce
  the same names, numbers, and history shapes.

## `--discipline hyrox`

`--discipline hyrox` (default slug `demo-hyrox`, default name
"Ironclad Hyrox Club" — override either with `--slug`/`--name`) builds
a gym styled for Hyrox instead of CrossFit, and deliberately shows off
several features **mid-draft** rather than only ever finished:

- `gyms.discipline = 'hyrox'` — the member Track section shows the
  eight-station catalog + race simulation, not CrossFit movement
  groups.
- Class types become Hyrox Simulation / Compromised Running / Strength
  for Hyrox / Open Gym / Engine Builder, each with its own programmed
  content (race simulations, running intervals, sled/carry strength
  work, engine EMOMs).
- Training history is logged against the real Hyrox station keys
  (SkiErg, sled push/pull, burpee broad jumps, row, farmers carry,
  sandbag lunges, wall balls, the 1km run split) instead of barbell
  lifts, so the station leaderboards are genuinely populated.
- **6 Hyrox race simulations** (full + half, both genders) instead of
  2, plus **3 official race results** (`hyrox_time`) logged separately
  from training sims — both leaderboard buckets have real entries.
- **4 store products**, one of them `active: false` — a "coming soon"
  item hidden from the storefront, demoing that toggle.
- The **website is left unpublished**, with testimonials and the
  location address deliberately blank and a gallery photo missing its
  description — the same three publish-blocking warnings an owner
  mid-setup would see, so the site builder's draft state (and the
  disabled-until-ready Publish button) is something to actually look
  at, not just read about in this file.
- The email campaign stays a draft either way, with Hyrox-flavoured
  copy for this discipline.

## Cloud usage (GitHub Action — no local setup)

One-time: add the `SUPABASE_SERVICE_ROLE_KEY` repo secret (GitHub →
Settings → Secrets and variables → Actions; the value is in Supabase
Dashboard → Settings → API → `service_role`). The existing
`SUPABASE_PROJECT_REF` secret supplies the URL.

Then: GitHub → Actions → **Demo gym** → Run workflow → choose `seed`
or `teardown`, and for a seed, pick `discipline` (crossfit/hyrox) and
optionally a `slug`/`name`/`members`. Runs against the hosted project
with the same safety rails; credentials are printed in the job log.

## Local usage (zero config)

```bash
npm run dev          # once — starts the local Supabase stack
npm run seed:demo    # seed
npm run seed:demo -- --teardown   # remove
```

The seeder reads the local service-role key from `supabase status`
itself; nothing to configure. Sign in at the printed credentials —
`owner@demo-ironworks.temple.test` / `TempleDemo1!` to see the staff
side, `member01@…` for the member side.

## Hosted usage — read this first

Seeding a hosted project creates **real accounts that anyone with the
password can sign into**, visible in your auth dashboard and any
member counts. Never point it at production.

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run seed:demo -- --yes
```

Both the explicit key **and** `--yes` are required for any non-local
URL; the target is printed before anything is written.

## Teardown

```bash
npm run seed:demo -- --teardown --slug demo-ironworks
```

- Deletes the gym row — every tenant table cascades from `gyms`, so
  classes, bookings, workouts, leads, campaigns, store, and website
  all go with it. The digital store asset is removed from Storage.
- Deletes the demo auth accounts, with two guards: only users found
  via the gym's own memberships, and of those only emails ending
  exactly `@<slug>.temple.test`. A real user who joined the demo gym
  is skipped with a warning. An orphan sweep also catches accounts
  left by a partial seed.
- Refuses any slug that doesn't start with `demo-` — it will not even
  look up a non-demo gym.

Re-running a seed against an existing slug (or leftover demo
accounts) refuses with "run --teardown first" — there is no partial
upsert; recovery from any failed state is teardown + re-seed.

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--discipline` | `crossfit` | `crossfit` or `hyrox` — picks slug/name defaults below and reshapes the gym; see "`--discipline hyrox`" above |
| `--slug` | `demo-ironworks` (`demo-hyrox` if `--discipline hyrox`) | Gym slug; must match `demo-[a-z0-9-]+` |
| `--name` | `Ironworks Strength Club` (`Ironclad Hyrox Club` if `--discipline hyrox`) | Display name |
| `--members` | `40` | Member count (10–60) |
| `--weeks-back` | `4` | Weeks of past sessions/bookings |
| `--weeks-forward` | `2` | Weeks of future sessions |
| `--history-weeks` | `10` | Weeks of workout-log history |
| `--tz` | `Europe/London` | Gym timezone (sessions are DST-correct) |
| `--seed` | `42` | RNG seed — same seed, same data |
| `--dry-run` | | Build + print the plan, write nothing |
| `--teardown` | | Remove the gym and its demo accounts |
| `--yes` | | Required for any non-local target |

## Public marketing demo (`demo-launchpad`)

A third, separate tenant — `demo-launchpad` — backs the "Launch your gym"
section on the marketing site (jointemple.io), which iframes its real,
published site and offers sign-in CTAs into the real app. Deliberately
its own slug, never `demo-ironworks`/`demo-hyrox`:

- Those two are internal QA fixtures with a stable, documented password
  (`TempleDemo1!`) engineers rely on. Public homepage traffic and the
  rotation job below must never touch them, and vice versa.
- It's reseeded nightly by `.github/workflows/demo-marketing-rotate.yml`
  (`workflow_dispatch` with **no slug input** — the slug is hardcoded —
  so this job structurally cannot touch any other tenant). Reseeding
  rather than just rotating the password: the tenant is embedded
  read-write on a public page (a live lead-capture form, sign-in-able
  owner/member accounts that can book, DM, edit copy), so the real risk
  is visitor-driven data mutation, not just credential exposure.
- Its current login is published to `demo_marketing_credentials`
  (migration `0122_demo_marketing_credentials.sql`) via
  `scripts/publish-demo-credentials.ts`, and served read-only to the
  marketing site by `api/demo-credentials.ts`.
- One-time bootstrap (same as any other hosted seed):
  ```bash
  npx tsx scripts/seed-demo-gym.ts --slug demo-launchpad --name "Launchpad CrossFit" --discipline crossfit --yes
  npx tsx scripts/publish-demo-credentials.ts --slug demo-launchpad --gym-name "Launchpad CrossFit" --password TempleDemo1!
  ```
  (or trigger `demo-gym.yml` with `slug=demo-launchpad`, then run
  `publish-demo-credentials.ts` once by hand — the nightly rotation
  takes over from there.)

## Known limits

- No Stripe objects are seeded — checkout, Connect and store payment
  flows still need a connected test-mode account.
- No waivers or PAR-Q questionnaires are seeded: publish one in-app to
  demo the booking gates (that flow is worth seeing from scratch).
- Campaign sends stay simulated until `RESEND_API_KEY` is configured,
  so the draft campaign is safe to "send" in a demo.
