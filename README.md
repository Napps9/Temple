# Temple

Gym management app — Expo (web target) on top of Supabase (Postgres + auth + storage + RLS).

## Setup

Prereqs:
- Docker (for the local Supabase stack)
- Node 22
- Supabase CLI matching `package.json#supabase.cli_version`. `npm run dev` warns if your local CLI doesn't match.

From a fresh clone:

```sh
npm install
npm run dev
```

`npm run dev` does, in order: start the local Supabase stack if it isn't running, write `.env.local` pointing at it (only if the file doesn't exist), then hand off to `expo start --web`. Open the URL it prints.

The local DB is seeded with two ready-made logins (run `supabase db reset` first if you started the stack before the seed existed):

| Email | Password | Role |
| --- | --- | --- |
| `owner@temple.test` | `password123` | owner of the demo gym |
| `member@temple.test` | `password123` | member |

Seeds run only on local `supabase db reset` — they never reach the hosted project. You can also sign up a fresh account and walk through **Start a new gym**.

To pull main + reinstall deps + replay migrations in one go:

```sh
npm run sync
```

## Local vs hosted Supabase

`.env.local` is auto-generated to point at the local stack (`http://127.0.0.1:54321`). To debug against your hosted project, edit `.env.local` with the URL + anon key from `dashboard.supabase.com → project → API`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

`.env.local` is gitignored — never commit it.

## Optional: in-app "talk to your AI" voice calls

The CRM dashboard, setup wizard, and Automation settings can open a live
browser voice call with a gym's AI assistant (no phone number needed).
This needs Vapi's **public** key (`dashboard.vapi.ai → API Keys`, not the
private key used server-side):

```env
EXPO_PUBLIC_VAPI_KEY=<public-key>
```

Without it, those entry points show as unavailable rather than failing.

## Migration flow

1. Author SQL in `supabase/migrations/NNNN_description.sql`.
2. `supabase db reset` replays every migration against the local DB. Catches order / syntax / RLS problems immediately.
3. `supabase test db` runs the pgTAP suite. Author a `_self_only.sql` or similar for any RLS change.
4. Commit + push.
5. Merging to `main` runs the **db-deploy** CI job which sends the migration to the hosted project. **No manual `supabase db push` needed.**

## CI contract

Three jobs in `.github/workflows/ci.yml`:

| Job | When | What |
| --- | --- | --- |
| `check` | every push + PR | `tsc --noEmit` + `npm test` |
| `db-tests` | every push + PR | `supabase start` + `supabase test db` against a fresh local stack |
| `db-deploy` | push to `main` only, after both gates pass | `supabase db push --include-all` against the hosted project |

`db-deploy` needs three repo secrets (Settings → Secrets and variables → Actions):

- `SUPABASE_ACCESS_TOKEN` — personal access token from <https://supabase.com/dashboard/account/tokens>
- `SUPABASE_PROJECT_REF` — the hosted project ref (the slug in the dashboard URL)
- `SUPABASE_DB_PASSWORD` — hosted DB password (used by `supabase db push`)

Without these the job will fail loudly on first push to main; add them before merging anything that touches migrations.

## Pre-commit hook

`npm install` wires a husky hook at `.husky/pre-commit` that:

1. Sets `user.email` + `user.name` on the local repo if not already configured (avoids unverified commits).
2. Runs `tsc --noEmit` and `npm test`.

Skip with `git commit --no-verify` if you really need to.

## Claude Code sessions

`.claude/settings.json` registers a SessionStart hook (`scripts/session-start.sh`). On every session start it sets the git author if unset and fetches `origin/main`; if the workspace is sitting on a throwaway `claude/*` branch with a clean tree and every commit pushed, it switches to a synced `main`. Cloud containers reset onto stale branches between sessions — this keeps new sessions from building on weeks-old code. It never touches a branch with uncommitted or unpushed work.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `supabase start` complains about port conflicts | `supabase stop --all` then retry, or check `docker ps --filter publish=54322`. |
| `Invalid db.major_version: 17` in CI | Bump `package.json#supabase.cli_version` to a release that supports Postgres 17 (≥ 2.40). |
| `Missing Supabase env vars` page in browser | Delete `.env.local` and re-run `npm run dev` to regenerate. |
| CLI mismatch warning from `npm run dev` | Either bump local CLI (`brew upgrade supabase` etc.) or change `package.json#supabase.cli_version` to match your local. |
| Stuck on `/welcome` after creating a gym | Hard-reload the browser. The membership query is pinned to `refetchOnMount: false`; any flow that changes membership must `await refreshMembership(queryClient)` (exported from `src/lib/auth.ts`) before navigating. |
