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
  the `primary` colour token is driven by a runtime CSS variable that
  follows the gym's saved brand colour (light vs dark resolved at
  scheme change). Don't hard-code `#2563EB` — use
  `useThemeColors().primary`.
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

- **Push to `main` directly** for every change unless the user
  explicitly asks for a PR.
- **The CI run is the verification step**. After every push, watch CI
  via the GitHub MCP tools (`mcp__github__actions_list`,
  `actions_get`, `get_job_logs`). Wait for both jobs to be green
  before claiming a change is live. Use a single
  `sleep 130 && echo done` in the background; don't poll.
- **`supabase` CLI is NOT installed locally** in this remote-execution
  environment. Local validation of migrations / pgTAP isn't possible —
  trust CI.
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
- **`<BackLink label="Manage" />`** on every deep-link sub-page so
  users have an explicit way back.
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
- **Brand colours**: use `useThemeColors().primary` for runtime icon
  tints. `bg-primary` / `text-primary` etc. work via the Tailwind
  runtime CSS variable. The five legitimate hard-coded `#2563EB`
  literals: create-gym placeholder text, branding picker default,
  `_layout.tsx` CrashScreen, `index.tsx` pre-membership loading
  spinner, `ColorSwatchPicker` preset.
- **`useGymBrand()`** returns the resolved-for-active-scheme brand at
  the top level (`primaryColor`, `logoUrl`, `gymName`) plus
  `modes: { light, dark }` for the editor.

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

- **Push to main directly**, no PRs unless explicitly asked.
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
