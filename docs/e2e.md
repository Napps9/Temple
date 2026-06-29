# End-to-end tests (Playwright)

A browser-driven E2E harness for the web build. It drives the real app
through Chromium and asserts on what the user sees, covering the core
platform journey: **owner signs up → creates a gym → adds a class type +
schedule + plan → a member self-joins via the public link → clears the
consent gate → books a class.**

Unit tests (vitest, in `src/`) stay the fast inner loop. This harness is
the slow, full-stack outer loop and needs a running app + Supabase.

---

## Layout

```
playwright.config.ts        # runner config (base URL, Chromium, web server)
e2e/
  smoke.spec.ts             # backend-free: app boots, auth screens render
  journey/
    full-journey.spec.ts    # the mutating owner→member→book story (opt-in)
  pages/                    # page objects (auth, join, manage, booking)
  support/
    fixtures.ts             # base test + page-object fixtures
    data.ts                 # unique, collision-free test data per run
  tsconfig.json             # typecheck config for the harness
```

There are no `testID`s in the app, so selectors lean on accessible names:
`<Input>` exposes its label as `aria-label` and `<Button>` carries
`role="button"` (both wired up for exactly this), with text/placeholder
fallbacks for bare `Pressable`s.

---

## Running

### Smoke (no backend)

The smoke suite only touches logged-out screens, which make no Supabase
queries, so a placeholder env is enough:

```bash
# Against an already-running app:
E2E_BASE_URL=http://localhost:8081 npm run e2e:smoke

# Or let Playwright boot the web server itself (needs a local Supabase or
# at least placeholder EXPO_PUBLIC_SUPABASE_* in .env.local):
npm run e2e:smoke
```

### Full journey (opt-in, mutates a backend)

The journey creates real gyms and members and may trigger invite mail, so
it is gated behind `E2E_JOURNEY=1` and must target a **non-production**
Supabase project that **auto-confirms signups** (email confirmation off —
otherwise sign-up parks on the "Check your email" wall and the test
skips with a clear message).

```bash
E2E_BASE_URL=https://your-staging-app.example.com \
E2E_JOURNEY=1 npm run e2e:journey
```

---

## Environment contract

| Variable            | Purpose                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `E2E_BASE_URL`      | URL of a running app. When unset, `npm run web` is started locally. |
| `E2E_JOURNEY`       | `1` enables the mutating journey suite (otherwise skipped).         |
| `E2E_CHROMIUM_PATH` | Override the Chromium binary (defaults to `/opt/pw-browsers/chromium` when present, else Playwright's managed browser). |
| `E2E_EMAIL_DOMAIN`  | Domain for generated test emails (default `temple-e2e.example.com`). |

The app reads its backend from `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` at build/serve time — point those at the
test project when you build the app the harness runs against.

---

## CI notes

- These tests are **not** part of the `tsc + vitest` CI gate. Run them in a
  separate job that first stands up an app pointed at a disposable
  Supabase project (so the mutating journey has somewhere safe to write).
- `npm run e2e:typecheck` type-checks the harness on its own tsconfig (the
  app's `tsc --noEmit` excludes `e2e/`).
- Chromium is launched by path in sandboxed environments; locally,
  Playwright uses its managed browser. No `playwright install` is needed
  where a browser is pre-provisioned.

---

## Known-fragile spots

Written from source, not yet executed against a live backend — the deep
widgets are the most likely to need selector tuning on the first real run:

- **Schedule day picker** (`ClassTypesPage.addWithDailySchedule`) clicks
  the seven day cells positionally; if the recurrence editor's DOM shape
  changes, re-anchor the `Days` row locator.
- **Booking calendar** (`BookPage.openClass`) taps the first session card
  matching the class-type name. If today's only session is past its
  booking window the modal returns `closed`/`not-open` rather than
  `booked` — the daily indefinite schedule is meant to always leave a
  bookable future session.
