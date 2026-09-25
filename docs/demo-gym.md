# Demo gym seeder

One command creates a believable, fully-populated gym with **real,
signable-in accounts**, so every feature can be tested end to end —
programming, booking, attendance history, PRs and leaderboards, Hyrox
races, injuries and staff alerts, DMs, leads, a draft campaign, the
and the store. One command removes it all again.

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
  scripted **DM threads**, and 3 **store products** (one digital with
  a real downloadable asset).
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
  at, not just read about in this file.
- The email campaign stays a draft either way, with Hyrox-flavoured
  copy for this discipline.

## Cloud usage (GitHub Action — no local setup)

One-time: add the `SUPABASE_SERVICE_ROLE_KEY` repo secret (GitHub →
Settings → Secrets and variables → Actions; the value is in Supabase
Dashboard → Settings → API → `service_role`). The existing
`SUPABASE_PROJECT_REF` secret supplies the URL.

Then: GitHub → Actions → **Demo gym** → Run workflow → choose `seed`,
`teardown` or `reseed` (teardown, then seed), and for a seed, pick
`discipline` (crossfit/hyrox) and optionally a `slug`/`name`/`members`.
A blank slug means `demo-ironworks`. Runs against the hosted project
with the same safety rails; credentials are printed in the job log.
`owner_email` switches the run to an existing gym — see "Into a gym you
already own".

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

## Into a gym you already own

`--owner <email>` seeds the same content into a gym that a real account
created in the app and owns, instead of creating a demo tenant. The
gym keeps its name, slug, timezone, currency and owner; the two coaches,
the members, the timetable and everything they did are created around
that owner, who also gets the month of their own training the demo
owner has. Programming, leads, the store, the draft campaign and the
Timeline's questions are all there. The gym row itself gains the
discipline, the store flags, a dismissed onboarding and a `created_at`
a year back (the Timeline's pager floors at it).

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
npm run seed:demo -- --owner you@example.com --yes
```

Or, in the cloud: Actions → **Demo gym** → Run workflow, `mode=seed`,
`owner_email=you@example.com`. The job log prints the seeded logins; the
owner signs in with their own password.

- The gym is found through the account's `owner` memberships. One owned
  gym needs nothing more; several need `--slug` to pick one. A slug the
  account does not own is refused.
- The seeded accounts live on `@<gym-slug>.temple.test`, same as a demo
  tenant, and are the only accounts a teardown will ever delete.
- The seed refuses a gym that already holds class types, class sessions,
  membership plans or lead sources: `--teardown --owner <email>` (or
  `mode=reseed`, which does both) **empties the gym first** — every
  table the seed fills, plus cover requests a demo raised, is cleared
  for that gym, whoever wrote the rows. Other real members keep their
  accounts and memberships; only the seeded accounts are deleted.
- `--name` and `--tz` are ignored: the gym's own are used.
- **This is a real gym, not a demo tenant.** `gyms.is_demo` is not set,
  so nothing here stops a send or a charge the way the demo tenants are
  stopped (below). Approving a chase or sending the campaign will try to
  reach `@<slug>.temple.test` addresses, which cannot route and bounce
  against the sending domain. Set `is_demo` by hand if you want the
  guards on.

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
  classes, bookings, workouts, leads, campaigns, and store
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
| `--owner` | | Email of a real account: seed into (or empty) the gym it owns instead of creating a demo tenant; see "Into a gym you already own" |
| `--slug` | `demo-ironworks` (`demo-hyrox` if `--discipline hyrox`) | Gym slug; must match `demo-[a-z0-9-]+`. With `--owner`, picks between several owned gyms |
| `--name` | `Ironworks Strength Club` (`Ironclad Hyrox Club` if `--discipline hyrox`) | Display name (ignored with `--owner`) |
| `--members` | `40` | Member count (10–60) |
| `--weeks-back` | `4` | Weeks of past sessions/bookings |
| `--weeks-forward` | `2` | Weeks of future sessions |
| `--history-weeks` | `10` | Weeks of workout-log history |
| `--tz` | `Europe/London` | Gym timezone (sessions are DST-correct; ignored with `--owner`) |
| `--seed` | `42` | RNG seed — same seed, same data |
| `--dry-run` | | Build + print the plan, write nothing |
| `--teardown` | | Remove the gym and its demo accounts |
| `--yes` | | Required for any non-local target |

## The long-lived demo tenants

Three tenants exist in the hosted database that strangers sign into. They
are listed in **`scripts/demo-gym/tenants.ts`**, which is the source of
truth — `.github/workflows/demo-marketing-rotate.yml` reads it rather than
holding its own copy.

| Slug | Gym | Discipline | Used for |
|---|---|---|---|
| `demo-launchpad` | Launchpad CrossFit | crossfit | Embedded on jointemple.io; password published to anyone who loads the page |
| `demo-good-life` | Good Life Crossfit | crossfit | Demos given by a person |
| `demo-redline-hyrox` | Redline Hyrox | hyrox | Demos given by a person, Hyrox side |

The last two spent months existing **only** in the hosted database — no
migration, no seed file, no script default, no constant, a documented
static password and nothing that ever reset them. That is what `tenants.ts`
fixes, and it is worth not undoing.

Deliberately none of these is `demo-ironworks`/`demo-hyrox`: those two are
internal QA fixtures with a stable password (`TempleDemo1!`) engineers rely
on, and the rotation job must never touch them.

**Only the published one is guarded.** `gyms.is_demo` — the flag every
egress guard asks, so no email, text or charge leaves on that tenant's
behalf — is set by publishing a password to `demo_marketing_credentials`,
which is what the marketing site serves (0291). So `demo-launchpad` is
flagged and the others are ordinary gyms: they really send, which is the
only way to demonstrate an AI front desk that texts a prospect a link.
That is deliberate, and it means the person giving a demo on one of them
is doing it on a live account. Set `is_demo` by hand on any tenant you
want the guards back on.

- **All three are reseeded nightly** at 03:00 UTC by
  `demo-marketing-rotate.yml` (`workflow_dispatch` with **no inputs** — the
  list comes from `tenants.ts`, which refuses a slug that is not
  `demo-…`, and the seeder refuses one again). Reseeding rather than just
  rotating the password: these tenants are signed into read-write by
  strangers, so the real risk is visitor-driven data mutation, not just
  credential exposure. A run destroys whatever is on a tenant, **including
  a demo somebody is in the middle of**.
- **Where to get the new password.** `demo-launchpad`'s goes to
  `demo_marketing_credentials` (migration
  `0122_demo_marketing_credentials.sql`) via
  `scripts/publish-demo-credentials.ts`, and is served read-only to the
  marketing site by `api/demo-credentials.ts`. The other two are printed in
  the rotation job's log, under a group named for the slug — that is where
  whoever is giving the demo reads them. Only one tenant may be published,
  because the RPC behind that table takes no arguments and returns the most
  recently rotated row.
- One-time bootstrap for a new tenant (same as any other hosted seed):
  ```bash
  npx tsx scripts/seed-demo-gym.ts --slug demo-launchpad --name "Launchpad CrossFit" --discipline crossfit --yes
  npx tsx scripts/publish-demo-credentials.ts --slug demo-launchpad --gym-name "Launchpad CrossFit" --password TempleDemo1!
  ```
  (or trigger `demo-gym.yml` with `slug=demo-launchpad`, then run
  `publish-demo-credentials.ts` once by hand — the nightly rotation
  takes over from there.)

## What a demo tenant cannot do (0278)

**Nothing a visitor presses on a demo gym reaches the outside world.**
`gyms.is_demo` is set for every `demo-` slug and cannot be cleared, and
every edge function that calls a vendor reads it before doing so.

- **Email and SMS** take the route the no-ESP case has always taken: the
  recipient row is written `simulated`, the campaign report counts it, the
  timeline records it. The builder, the audience, the send and the report
  all work; nothing arrives. This replaces the old standing warning that
  campaign sends were real and hard-bounced 39 unroutable addresses against
  the sending domain's reputation.
- **Invites** still create their code and still list as sent — the screen
  says "share this code manually", which is the branch a gym with no email
  configured already takes. The address a visitor typed gets no mail.
- **Money** stops before Stripe. Reads of the connected account still work,
  so `/management/billing` looks like the live gym it is; checkouts,
  refunds, subscription changes and Connect all refuse with a stated
  reason.
- **Phone numbers and voice assistants** are not bought, changed or
  released, and `agent-interview`'s outbound call does not ring. The
  browser interview at `/browser-start` still works — no telephony.
- **Still allowed on purpose:** Anthropic and ElevenLabs. They cost tokens,
  nobody outside Temple observes them, and they are the demo — the front
  desk answering, the setup parser reading a timetable, a voice playing.
  `security-alert` also stays live: it mails Temple, not the gym.

`src/lib/edge-egress.test.ts` holds the whole inventory and fails CI if a
new edge function calls a vendor without deciding which of those it is.
`supabase/tests/a_demo_gym_cannot_reach_anybody.sql` covers the flag.

The one send no server guard can reach is Supabase Auth's own mail, which
Supabase sends rather than any code here. Changing an account's email is
refused in `AccountScreen` for a demo gym, with the reason on screen.

## Known limits

- No Stripe objects are seeded — checkout, Connect and store payment
  flows still need a connected test-mode account.
- No waivers or PAR-Q questionnaires are seeded: publish one in-app to
  demo the booking gates (that flow is worth seeing from scratch).
