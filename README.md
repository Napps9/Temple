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

Sign up a new account from the welcome screen and walk through **Start a new gym**. You'll land in the management dashboard against an empty local DB.

## Local vs hosted Supabase

`.env.local` is auto-generated to point at the local stack (`http://127.0.0.1:54321`). To debug against your hosted project, edit `.env.local` with the URL + anon key from `dashboard.supabase.com → project → API`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

`.env.local` is gitignored — never commit it.

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

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `supabase start` complains about port conflicts | `supabase stop --all` then retry, or check `docker ps --filter publish=54322`. |
| `Invalid db.major_version: 17` in CI | Bump `package.json#supabase.cli_version` to a release that supports Postgres 17 (≥ 2.40). |
| `Missing Supabase env vars` page in browser | Delete `.env.local` and re-run `npm run dev` to regenerate. |
| CLI mismatch warning from `npm run dev` | Either bump local CLI (`brew upgrade supabase` etc.) or change `package.json#supabase.cli_version` to match your local. |
| Stuck on `/welcome` after creating a gym | Hard-reload the browser. The membership query is pinned to `refetchOnMount: false` to dodge `useCan` retry storms; we currently `refetchQueries` at the create-gym + join code paths to push past it. |
