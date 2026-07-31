-- 0240: Grants that guard nothing
--
-- `revoke ... from public` does not lock a function down on Supabase.
-- The project ships `alter default privileges in schema public grant
-- execute on functions to anon, authenticated, service_role`, so every
-- function arrives with explicit grants to anon and authenticated already
-- on it. Revoking PUBLIC removes a grant that was never what let them in.
-- The author writes the guard, the guard reads correctly, and it does
-- nothing.
--
-- 0085 hit this on the sharpest function in the product.
--
--   -- No internal caller check (it trusts the service role), so it must
--   -- not be reachable by members — Postgres grants EXECUTE to PUBLIC by
--   -- default.
--   revoke all on function public._mark_store_order_paid(...) from public;
--   grant execute on function public._mark_store_order_paid(...) to service_role;
--
-- The reasoning is right and the statement is a no-op: the live ACL is
-- postgres, anon, authenticated, service_role. `_mark_store_order_paid`
-- takes a Stripe checkout session id, flips the matching order to `paid`,
-- stamps paid_at, decrements stock and inserts the digital deliveries —
-- and verifies nothing, because it was written to be reachable only by
-- the webhook that had already verified Stripe's signature.
--
-- Proved rather than reasoned about, against a pending order for a £49
-- digital product: `store_orders_select` lets a buyer read their own row,
-- so they can read the session id straight out of it, and calling this
-- with it returns status `paid`, paid_at set, and one row in
-- store_digital_deliveries. The member never pays and downloads the file.
-- `_record_store_subscription_cycle` (0086/0087) is the same statement
-- and the same hole for a recurring product.
--
-- 0136 onwards revoke `from public, anon, authenticated`, which is the
-- form that works. The eleven other service-role-only functions all use
-- it. These two are the ones written before anybody knew.
--
-- assign_lead is a different miss and is here because the same sweep
-- found it. 0114 granted it to `authenticated` deliberately, on the
-- reasoning that it is "callable by authenticated staff surfaces (guarded
-- by the RPCs that wrap it)". Nothing in the client calls it: staff
-- reassign through set_lead_assignee, which does its own capability
-- check, and the capture RPCs call it internally as definer where the
-- grant is irrelevant. So the only caller the grant serves is a direct
-- one, and a direct call is the case the wrapper reasoning does not
-- cover — assign_lead itself checks nothing. Any signed-in user holding a
-- lead's uuid can assign that lead, in a gym they have nothing to do
-- with, to one of its coaches and read back the coach's profile id.
-- Bounded (its own gym's active staff only, and idempotent) and lead
-- uuids are not enumerable, which is why it is a revoke and not a
-- rewrite.

begin;

revoke execute on function public._mark_store_order_paid(
  text, text, integer, text, jsonb
) from public, anon, authenticated;

revoke execute on function public._record_store_subscription_cycle(
  text, text, integer, timestamptz
) from public, anon, authenticated;

revoke execute on function public.assign_lead(uuid) from public, anon, authenticated;

commit;
