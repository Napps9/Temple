# pgTAP suite for Tier 5

These tests assert the Tier 5 invariants at the SQL layer. They're the
contract for things the TypeScript tests can't reach: RLS gates, RPC
auth checks, the SQL↔TS parity of `v_member_cohort`, and the
concurrency guarantees on `claim_cover`.

## Running

Requires a local Supabase stack with the Tier 5 migrations applied.
Docker must be running for `supabase start`.

```sh
supabase start
supabase test db          # runs every .sql file in this directory
# or, to run one file:
supabase test db --suite path supabase/tests/staff_can_check_in.sql
```

If you don't have the Supabase CLI but do have a Postgres instance with
the migrations applied and pgTAP installed:

```sh
pg_prove --ext .sql supabase/tests/
```

## What each file asserts

| File | Invariant |
|---|---|
| `staff_can_check_in.sql` | Front-desk staff can call `check_in_member` and mark a booking attended. Locked-in by gating on `user_can_access_staff_area`. |
| `check_in_idempotent.sql` | Repeated `check_in_member` calls do not rewrite `marked_by` / `attended_at`. No time-window dependency. |
| `staff_can_view_sops.sql` | Staff can `SELECT` from `sop_documents` — `user_can_access_staff_area` rather than `user_can_admin_or_coach`. |
| `admin_cannot_claim_cover.sql` | Admin cannot call `claim_cover`. Gate is `user_can_cover`, not `user_can_manage_classes`. |
| `admin_cannot_invite_admin.sql` | Admin caller passing `p_role = 'admin'` (or `'owner'`) to `create_invite` raises. Owner can mint an admin. |
| `assignee_cannot_reassign_task.sql` | Task assignees cannot direct-`UPDATE` rows on `coach_tasks` (RLS rejects). The `complete_task` RPC succeeds. |
| `tag_rules_cross_gym.sql` | Same-label rules in two gyms don't collide; `apply_tag_rules(gymA)` does not write any tags in gymB; an owner in gymA cannot `SELECT` any tag from gymB. |
| `claim_cover_concurrency.sql` | First claim swaps coach + marks offer; second claim on the same offer raises. |
| `claim_cover_no_strand.sql` | Cancelling a request returns the class to its original coach; `coach_id` is never null. |
| `claim_cover_no_double_book.sql` | A coach already scheduled at an overlapping time cannot claim the offer. |
| `v_member_cohort_parity.sql` | Per-row flags on `v_member_cohort` match the TS classifier in `src/lib/insights.ts` for the shared fixture set. SQL half of SQL↔TS parity. |

## Conventions

- Each file is hermetic: `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`.
- `\i tests/_helpers.sql` pulls in the shared fixture functions
  (`_test_mk_user`, `_test_mk_gym`, `_test_mk_membership`,
  `_test_mk_session`, `_test_mk_booking`, `_test_act_as`).
- Auth is simulated via `set_config('request.jwt.claim.sub', uid, true)`
  and `set_config('role', 'authenticated', true)`. The `_test_act_as`
  helper bundles both.
- All emails / slugs are scoped per test file so cross-file collisions
  can't happen, even though each file rolls back.

## Known limitations

- `claim_cover_concurrency.sql` simulates concurrency by sequencing two
  claims, not by running them in parallel transactions. The actual
  serialization guarantee comes from the `SELECT … FOR UPDATE` lock in
  the RPC and the partial unique on `cover_request_sessions
  (class_session_id) WHERE claimed_by IS NULL`. Running the test in
  parallel from two psql sessions would exercise the locking; that
  scenario lives in higher-level integration tests.
- The suite has not been run end-to-end in the development environment
  these files were authored in (no Docker → no `supabase start`).
  Land + green before merging.
