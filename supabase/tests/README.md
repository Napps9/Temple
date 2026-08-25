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
| `admin_cannot_claim_cover.sql` | Admin cannot call `claim_cover` or `request_cover_range`. Gate is `user_can_cover`, not `user_can_manage_classes`. |
| `cover_range_request.sql` | `request_cover_range` offers exactly the caller's in-window classes: final day inclusive, days either side excluded, unticked and already-offered classes skipped, requested dates recorded. |
| `cover_range_auto_attach.sql` | A date range is a standing window — an empty window is still a valid request, classes scheduled into it later auto-attach, and a cancelled window stops attaching. |
| `cover_range_timezone.sql` | Window edges are local midnight at the gym, not UTC. Uses Australia/Brisbane so a UTC implementation fails both assertions. |
| `cover_partial_cancellable.sql` | A partially-claimed request can still be withdrawn; the claimed offer and its coach swap survive. |
| `cover_request_header_rollup.sql` | Cancelling the last class expires a per-class request but leaves a still-future standing window open. Also the first coverage `request_cover` has ever had — it caught the `min(uuid)` bug fixed in 0164. |
| `cover_requests_expire.sql` | `expire_cover_requests` sweeps dead offers, expires spent requests and windows, and leaves live ones alone. |
| `cover_notifications.sql` | One digest per recipient per request (never per class); requester and members excluded; in-app delivered on insert while email queues; claiming notifies the requester; RLS keeps a coach out of another coach's notifications. |
| `cover_notifications_suppression.sql` | A blanket email unsubscribe suppresses the cover email but not the in-app row, and records why. A coach disqualified for every class type in the request is not notified at all. |
| `member_movement_preferences.sql` | A member's "which lift do you mean by 'clean'?" answer is self-only, upserts rather than duplicating, is rejected unless the term is already normalised, and survives leaving the gym. |
| `cover_uncovered_warning.sql` | `warn_uncovered_cover` warns the requester plus owners/admins about unclaimed classes inside the lead — one digest per request, not per class; leaves far-off requests and other coaches alone; day-scoped idempotency key so a same-day re-run is a no-op but tomorrow warns again. The lead is per gym (`cover_warning_hours`): a 168h gym catches a class four days out, a 0 gym is opted out, and a default-48h gym still ignores distant classes. |
| `admin_cannot_invite_admin.sql` | Admin caller passing `p_role = 'admin'` (or `'owner'`) to `create_invite` raises. Owner can mint an admin. |
| `assignee_cannot_reassign_task.sql` | Task assignees cannot direct-`UPDATE` rows on `coach_tasks` (RLS rejects). The `complete_task` RPC succeeds. |
| `tag_rules_cross_gym.sql` | Same-label rules in two gyms don't collide; `apply_tag_rules(gymA)` does not write any tags in gymB; an owner in gymA cannot `SELECT` any tag from gymB. |
| `claim_cover_concurrency.sql` | First claim swaps coach + marks offer; second claim on the same offer raises. |
| `claim_cover_no_strand.sql` | Cancelling a request returns the class to its original coach; `coach_id` is never null. |
| `claim_cover_no_double_book.sql` | A coach already scheduled at an overlapping time cannot claim the offer. |
| `v_member_cohort_parity.sql` | Per-row flags on `v_member_cohort` match the TS classifier in `src/lib/insights.ts` for the shared fixture set. SQL half of SQL↔TS parity. |
| `read_by_186_of_214.sql` | `announcement_read_stats` is aggregate-only, scoped to current members on both sides of the fraction, refused inside the function for anyone without `can_post_announcements`, and unexecutable by anon. |
| `the_shop_gets_aisles.sql` | `store_products.category` reaches members through `list_store_products`, category-less products still list, the catalogue stays members-only, and writing the column stays behind `can_manage_store`. |
| `your_gyms_and_your_data.sql` | `my_gyms` names LEFT gyms (which a plain `gyms` select refuses) and returns only the caller's rows; `export_my_account_data` carries bookings, both directions of the member's messages, PAR-Q answers with prompts and the nested training export — never a third party's thread. anon can execute neither. |
| `a_tee_comes_in_sizes.sql` | A variant order line decrements and restocks the variant's stock, never the product's; the catalogue embeds variants with per-variant `sold_out`; the product flips sold-out only when every variant is tracked-and-zero; the variants table is staff-only under `can_manage_store`. |
| `the_notice_knows_what_it_cancelled.sql` | An announcement may link its own gym's closure and never another's (composite FK); the reader's impact query returns only their own cancelled-class rows; the closure window is member-readable; the notice stays inside its gym. |
| `a_notice_that_holds_the_top.sql` | `set_announcement_pin` (0261) is the only writer of a pin: a `can_post_announcements` holder can pin with a window, unpinning clears the window rather than leaving a stale one, a pin over a year or an end before its start is refused, a plain member and another gym's owner are both refused in the function, and `authenticated` still holds no UPDATE on `gym_announcements` (0195's revoke). |
| `who_else_was_in_the_room.sql` | `class_session_training_partners` shows only consenting, current co-loggers (the leaderboard gate, reused); never the caller themselves; sessions from other gyms are silently filtered; disabling class leaderboards empties every room. |

## Conventions

- Each file is hermetic: `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`.
- `\ir _helpers.psql` pulls in the shared fixture functions
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
