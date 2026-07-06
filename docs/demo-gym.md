# Demo gym seeder

One command creates a believable, fully-populated gym with **real,
signable-in accounts**, so every feature can be tested end to end —
booking, attendance history, PRs and leaderboards, Hyrox races,
injuries and staff alerts, DMs, leads, a draft campaign, the store,
and a published website. One command removes it all again.

## What you get (defaults)

- **43 accounts**: 1 owner, 2 coaches, 40 members — all sharing the
  password `TempleDemo1!`, all on `@demo-ironworks.temple.test`
  (`.test` is IANA-reserved: mail can never route).
- **6 weeks of timetable** (4 back, 2 forward) across 5 class types,
  with ~900 bookings carrying realistic attendance and no-show marks,
  plus one full future class with a 3-deep waitlist.
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
| `--slug` | `demo-ironworks` | Gym slug; must match `demo-[a-z0-9-]+` |
| `--name` | `Ironworks Strength Club` | Display name |
| `--members` | `40` | Member count (10–60) |
| `--weeks-back` | `4` | Weeks of past sessions/bookings |
| `--weeks-forward` | `2` | Weeks of future sessions |
| `--history-weeks` | `10` | Weeks of workout-log history |
| `--tz` | `Europe/London` | Gym timezone (sessions are DST-correct) |
| `--seed` | `42` | RNG seed — same seed, same data |
| `--dry-run` | | Build + print the plan, write nothing |
| `--teardown` | | Remove the gym and its demo accounts |
| `--yes` | | Required for any non-local target |

## Known limits

- No Stripe objects are seeded — checkout, Connect and store payment
  flows still need a connected test-mode account.
- No waivers or PAR-Q questionnaires are seeded: publish one in-app to
  demo the booking gates (that flow is worth seeing from scratch).
- Campaign sends stay simulated until `RESEND_API_KEY` is configured,
  so the draft campaign is safe to "send" in a demo.
