# Temple — context for Claude Code sessions

Quick-start so a fresh session doesn't have to re-discover the lay of
the land. This file is auto-loaded by Claude Code at session start.

---

## What this is

Temple is a multi-tenant gym SaaS — owners run their gym (programming,
classes, members, plans), staff coach, members book classes and track
training. Web-first, deployed via Vercel, with native iOS/Android
binaries that share the same React Native codebase.

For a current snapshot of every feature that's live, read
**`docs/feature-inventory.md`** before doing anything you think might
already exist.

---

## Tech stack

- **App**: Expo Router (Expo 56) on React Native + React Native Web
- **Styling**: NativeWind 4 (Tailwind-flavoured), `darkMode: 'class'`,
  the `primary` colour token is driven by a runtime CSS variable
  carrying **Temple's action fill** — ink `#14161A` light, paper
  `#F4F5F6` dark, from `ACCENT` in `src/lib/theme.ts`. The accent is
  mono; the only colour the brand keeps is the `DAWN` gradient,
  reserved for brand moments (logged-out headlines via
  `<BrandHeadline>`, the email top rule) and never for buttons. Gyms
  used to set the primary colour; they no longer recolour Temple's
  chrome. Don't hard-code hexes — use `useThemeColors().primary`.
- **Data**: `@tanstack/react-query` for client state, Supabase (RLS
  Postgres + Storage + Auth) for everything else.
- **Tests**: `vitest` for JS/TS, `pgTAP` for SQL.
- **Types**: TypeScript strict; the DB schema lives in
  `src/types/database.ts` and is hand-maintained alongside migrations.

---

## Dev workflow — push to main, CI handles the rest

This repo uses **trunk-based, cloud-deployed development**. There is
**no PR cycle by default**. Push direct to `main`; CI does the work:

1. **CI** (~30 s): `npx tsc --noEmit` + `npm test` (vitest)
2. **pgTAP** (~90 s): spins up local Supabase + runs every test in
   `supabase/tests/*.sql`
3. **Hosted migration deploy** (~10 s): pushes new
   `supabase/migrations/*.sql` to the live Supabase project
4. **Vercel** picks up the push and deploys production

Practical implications:

- **Work on `main`, not a session-assigned branch.** Some session
  harnesses hand you a default checkout on a throwaway branch (e.g.
  `claude/some-random-slug`). Ignore that assignment — `git checkout
  main` (or fetch + fast-forward it if it's behind `origin/main`), do
  your work there, and push straight to `origin main`. A branch that
  never gets merged back isn't "done," it just silently drifts from
  `main`. That's exactly how a prior session's local `main` ended up
  looking "diverged" and its work looking lost — it wasn't lost, it
  was stranded on a session branch nobody merged. Don't repeat it: if
  you're ever mid-task on a non-`main` branch for any reason, merge or
  fast-forward it into `main` and push before ending the session.
- **Push to `main` directly** for every change unless the user
  explicitly asks for a PR.
- **`main` is the only branch. Push there and nowhere else.** No mirror
  branch, no `agent-main`, no session branch left behind — one ref, one
  environment, production. This is enforced, not just advised:
  `vercel.json`'s `ignoreCommand` skips any ref that isn't `main` before
  a build starts. It's there because Vercel is on the Hobby plan, which
  caps deployments per day, and a second branch mirroring every push was
  doubling the count. When that quota ran out, pushes to `main` simply
  stopped producing a deployment — no error on GitHub, no failed check,
  nothing in CI.
- **Verify the deployment *succeeded*, not that one exists.** Green CI, a
  deployment record, and a live site are three different claims, and each
  has failed here independently. Check the last one:

  ```bash
  # 1. is there a deployment for my SHA?
  curl -s "https://api.github.com/repos/Napps9/Temple/deployments?per_page=3"
  # 2. did it BUILD? state must be "success" — "error" means it failed
  curl -s "https://api.github.com/repos/Napps9/Temple/deployments/<id>/statuses"
  ```

  No record at all means Vercel was never asked to build (quota, webhook).
  A record whose latest status is `error` means it was asked and failed —
  which is what happens if `vercel.json` gains a key Vercel doesn't
  know. **Its schema rejects unknown properties**, so there is no way to
  write a comment in it; `"//note": "..."` fails the build. Explanations
  about deployment config belong here, not in the JSON.
- **The CI run is the verification step**. After every push, watch CI
  via the GitHub MCP tools (`mcp__github__actions_list`,
  `actions_get`, `get_job_logs`). Wait for both jobs to be green
  before claiming a change is live. Use a single
  `sleep 130 && echo done` in the background; don't poll.
- **`supabase` CLI is NOT installed locally**, but migrations and pgTAP
  CAN be run locally anyway — Postgres 16 is installed, and
  `scripts/pgtap-local/` replays every migration into a scratch database
  and runs the suite against a pgTAP shim:

  ```bash
  scripts/pgtap-local/start.sh                          # once per session
  scripts/pgtap-local/runtest.sh assign_member_plan.sql # one file
  scripts/pgtap-local/runall.sh                         # all of them
  ```

  Do this before pushing any migration or pgTAP file. It exists because
  "trust CI" cost a red deploy: a fixture violated a CHECK in its setup
  block, the file aborted, `pgTAP` planned 39 tests and ran 0, and
  `db-deploy` never ran — eleven seconds to find locally. Four files fail
  in the harness for the shim's own reasons (listed in its README); a
  failure anywhere else is real.
- **Don't comment on GitHub PRs unless the user asks.** Be frugal.

### Common commands

```bash
npx tsc --noEmit           # typecheck
npm test -- --run          # vitest, full suite
npm test -- --run path/to/file.test.ts   # one test file
git push -u origin main    # ships it (CI then deploys)
```

### Reading CI

After pushing, use:
- `mcp__github__actions_list` with method `list_workflow_runs`,
  filter `{"branch": "main"}` — paginate to find the run for your SHA
- `actions_list` with method `list_workflow_jobs` — see per-job state
- `get_job_logs` with `tail_lines: 100` — failing assertion text

---

## Database conventions

- **RLS on every table.** Direct INSERT/UPDATE/DELETE from the client
  is rarely allowed; almost all dangerous writes go through a
  `security definer` RPC that does its own authorisation. Don't add a
  client-side `.update()` that should be an RPC — look for the
  existing RPC pattern first.
- **Migrations**: append-only, numbered. Most recent is the highest
  number. Each one starts with a `--` comment block explaining the
  why, not just the what.
- **`CREATE OR REPLACE FUNCTION` won't change a function's RETURNS
  shape or arity.** If you're changing either, `DROP FUNCTION` first.
  This bit us once in `0043`.
- **The capability matrix** (`gym_role_capabilities` +
  `default_capability` SQL function + `can_*` keys) governs every
  staff-visible feature. New staff feature → add a capability key in
  the SQL + a default mapping per role + a `useCan('can_…')` gate at
  the surface.

### pgTAP test patterns

Test helpers in `supabase/tests/_helpers.psql`:
- `_test_mk_user(email)` → uuid (also inserts a profiles row via the
  `on_auth_user_created` trigger)
- `_test_mk_gym(name, slug)` → uuid
- `_test_mk_membership(gym, profile, role)`
- `_test_act_as(profile)` — switches the session to behave as that
  authenticated user (sets the `role` GUC to `authenticated` and
  `request.jwt.claim.sub` to the uuid)
- `_test_mk_session(gym, coach, starts_at)` → class session uuid

Gotchas seen in this codebase:
- `_test_act_as` uses `set_config('role', ..., LOCAL)` — `RESET ROLE`
  inside a DO block does NOT reliably undo this across all Postgres
  minor versions. When you need to bypass RLS for a fixture mutation,
  **drive the path through the existing security-definer RPC** rather
  than a bare UPDATE + `RESET ROLE`. Last example:
  `supabase/tests/dark_mode_branding.sql` test 4 — exercise the CHECK
  by calling `set_gym_branding(... bad hex ...)`, not by raw UPDATE.
- pgTAP `throws_ok` runs the SQL in a savepoint — the outer
  transaction keeps going after the expected exception.

---

## App conventions

- **`<Screen>`** wraps every page. Pages use a `<ScrollView>` with
  `contentContainerClassName="gap-X py-6 px-4 md:max-w-2xl md:mx-auto md:w-full"`.
  The `px-4` matters on mobile — `<Screen>`'s `px-6` isn't reliably
  inherited through `<ScrollView>` on react-native-web.
- **`<Input>`** is the shared text input (handles label, error,
  password show/hide). Pass `secureTextEntry` for password fields plus
  `textContentType` + `autoComplete` for password managers.
- **`<BackLink />`** on every deep-link sub-page so users have an
  explicit way back. Strict came-from contract: `router.back()` when
  history exists, `fallbackHref` (the page's logical parent) only on a
  cold open. The label is always "Back" — no destination labels.
  Staff pages whose every way in is named by the persistent nav — their
  own rail entry, their hub parent's (`/management`), or Timeline's —
  pass `coveredByNav` and render no Back at any width: the rail does
  the job at 1024+, the section pills below, where the Manage pill
  opens the same gym destinations as a sheet (`ManageNavSheet`, fed by
  `useGymNavLinks` like the rail). Detail
  pages entered from mid-level surfaces the nav can't reach (member
  profiles, imported members, a member's tags, the Stripe import, lead
  conversations, agent setup, member programming) keep
  their Back at every width.
- **`<ChipButton>`** for inline actions (Copy, Share, Edit, etc.).
  Tones: `primary` / `neutral` / `amber` / `red` / `filled`.
- **`<Button>`** for the main page action. Variants:
  `primary` / `secondary` / `ghost` / `destructive`. Pass `loading`
  for mutation pending states.
- **Per-action saves.** Settings save per card/section — each card has
  its own Save button (`loading` + `success` tick, error text inside
  the card), or a lone switch saves on toggle. Never one page-level
  "Save changes" spanning multiple cards. When several cards share one
  RPC, a card's save sends the server's values for the other cards'
  fields; seed drafts once (don't reseed on refetch) so saving one
  card can't wipe or commit another card's unsaved edits.
- **The accent**: use `useThemeColors().primary` for runtime icon
  tints; `bg-primary` / `text-primary` etc. work via the Tailwind
  runtime CSS variable. `ThemedShell` in `_layout.tsx` is the only
  writer, and `src/global.css` holds the light values for web's first
  paint (native never parses that file, so the constants live in TS).
  It is **one accent per view** — the page's single action. Repeated row
  actions are ink.
- **`useGymBrand()`** returns a gym's *identity* — `gymName`, `slug`,
  `gymId`, `publicSignupEnabled`. No colours and no logo: a gym is
  named, not painted.
- **Content colour is not brand.** Class-type dots, tag colours and
  email themes are authored per item and stay — that's
  `ColorSwatchPicker` and `brand-themes.ts`.

---

## Health data / GDPR Article 9

PAR-Q and injury data are special-category health data; waiver
signatures are NOT (they're liability records, retained as such).

- **Consent gate** runs at app entry (`/consent`)
- **Erasure** via `_erase_member_health_data` is called from
  `leave_gym`, the self-serve withdraw button on Account, and the
  3-month retention sweep `purge_expired_health_data`
- **Audit log**: `health_data_access_log` — every staff health surface
  calls `log_health_data_access` on open
- **Waivers**: `waiver_documents` + `waiver_signatures`, deliberately
  outside the erasure sweep (lawful basis: defence of legal claims)

---

## Standing user preferences

- **Talk in jobs and workflows, not features and screens.** Frame
  proposals as the work to be done — the owner or member job and the
  workflow that completes it — and name surfaces after the job they
  serve. Screens are implementation detail, and fewer of them is
  progress.
- **Push to main directly**, no PRs unless explicitly asked. This
  applies even when the session environment defaults you onto a
  different branch — switch to `main` (or merge your branch into it)
  and push there; don't leave work stranded on a session branch.
- **No GitHub comments / replies** unless explicitly needed.
- **For exploratory questions** ("what should we do about X?"),
  answer in 2-3 sentences with a recommendation + the main tradeoff.
  Don't dive into implementation until the user agrees.
- **No emoji** in code, commits, or replies.
- **No "what" comments.** Default to no comments. Only write a comment
  when the **why** is non-obvious — a hidden invariant, a workaround,
  a constraint that would surprise the reader.
- **No backwards-compat shims, dead `_unused` vars, "removed by"
  comments, or speculative abstractions.** Three similar lines is
  better than a premature helper.
- **Match scope to ask.** A bug fix is a bug fix; don't refactor
  surrounding code.
- **UI/UX changes come with a screen mockup in the chat, as an
  image, showing the full screen in context.** Any change a user
  would *see* — new cards or screens, layout shifts, visible copy or
  colour changes — must be accompanied by a mockup delivered as an
  **image** (PNG) in the session, so it can be reviewed visually
  without pulling the app. Not isolated components: render the
  **whole screen** the change lives on — phone frame, page header,
  nav/back affordances, and the real surrounding cards above and
  below the change (read the actual screen file first and reproduce
  its layout and copy; unchanged neighbours may be abbreviated but
  must be present so placement is obvious). Build the HTML
  approximation with representative data, screenshot it with the
  pre-installed Chromium (`npx playwright screenshot --full-page`),
  and send the PNG — not the HTML file. Match the app's styling
  (cards, spacing, type scale) and show dark mode where it matters.
  Backend-only or purely behavioural changes don't need one.
- **Update `docs/feature-inventory.md`** when you ship a meaningful
  feature. That file is the source of truth for "what's live."

---

## GitHub MCP scope

The repo allow-list for this session is **`napps9/temple` only**. The
`gh` CLI is not available — use `mcp__github__*` tools. Don't try to
read or write any other repository.

---

## When you don't know something

- `docs/feature-inventory.md` for what's live.
- `supabase/migrations/` for schema + RPC history (read the latest few
  if the area is new to you).
- `supabase/tests/_helpers.psql` for pgTAP fixture conventions.
- `docs/brand-assets.md` for the Temple company logo kit
  (`assets/images/temple-brand/` — mark/lockup/app-icon, palette, usage).
- The `useGymBrand`, `useThemeColors`, `useCan`, `useGymMembership`
  hooks for the four most-asked-about runtime values.
