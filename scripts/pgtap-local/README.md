# Running migrations and pgTAP locally

The Supabase CLI is not installed in the remote-execution environment, so
the standing advice was "local validation isn't possible — trust CI".
That cost a red deploy: `assign_member_plan.sql` planned 39 tests and ran
0, because a fixture violated a CHECK constraint in its setup block. The
whole file aborted, `pgTAP` went red, and `db-deploy` never ran — all
discoverable in eleven seconds locally.

Postgres 16 is installed. This replays every migration into a scratch
database and runs the pgTAP suite against it.

```bash
scripts/pgtap-local/start.sh                          # once per session
scripts/pgtap-local/replay.sh                         # apply all migrations
scripts/pgtap-local/runtest.sh assign_member_plan.sql # one file
scripts/pgtap-local/runall.sh                         # the whole suite
```

`runtest.sh` and `runall.sh` both replay first, so they are safe to run
cold.

## What it is

**`preamble.sql`** — the parts of Supabase's own surface the migrations
assume: the `auth` schema and `auth.uid()` / `auth.jwt()`, the `anon` /
`authenticated` / `service_role` roles, `storage` and its path helpers,
`vault`, and stubs for `pg_cron` and `pg_net`. Those two extensions are
not installable here and the `CREATE EXTENSION` lines are stripped during
replay; nothing the migrations do with them affects whether the schema is
correct.

**`pgtap-shim.sql`** — enough of pgTAP to run this repo's files:
`plan`/`finish` counting, `ok`, `is`, `isnt`, `lives_ok`, `throws_ok`
(including pgTAP's rule that a five-character second argument is an
SQLSTATE rather than a message), `throws_like`, `cmp_ok`, `results_eq`,
and the `has_*` assertions. The counters are `security definer`, because
after `_test_act_as` the session runs as `authenticated`.

## What it does not tell you

It is a harness, not CI. Four files fail here for reasons that are the
shim's fault rather than the code's: `avatar_write_scoped` depends on
`storage.foldername`'s real semantics, and three others use `results_eq`,
whose row-ordering the shim does not reproduce faithfully. Treat a
failure in those four as unproven rather than as a bug, and treat a
failure anywhere else as real.

A green run here is strong evidence, not a substitute for the CI run —
`pgTAP` in CI uses the real extension against a real Supabase image.
