-- Four tables grant a write the client never issues, guarded by an RLS
-- policy that pins the row but not the columns.
--
-- This is the class 0194 fixed on email_campaigns: a table-wide write
-- grant to authenticated, an RLS policy that restricts which ROWS but
-- says nothing about which COLUMNS, and a client that only ever touches
-- the table through a security-definer RPC or not at all. The grant is
-- wider than the code, and the gap is a direct PostgREST PATCH away with
-- the publishable key that ships in the client bundle.
--
-- For each table the fix is the same: revoke the write the client does
-- not use. The real writers are unaffected — bulk_edit_sessions and
-- mark_dm_thread_read are security definer (run as the owner), and every
-- plan_subscriptions writer is a service-role edge function or a definer
-- RPC.
--
-- 1. plan_subscriptions (worst of the four). authenticated holds
--    INSERT/UPDATE/DELETE (0008). Both write policies gate on
--    user_can_assign_plan, which is raw-role owner/admin/coach/staff
--    (0013) with NO `left_at is null` guard and is NOT the can_assign_plan
--    capability the Team screen advertises. So a coach or staff account —
--    including one whose 'Assign plans' toggle the owner switched off, and
--    including one already removed from the gym, since removal is a soft
--    delete that leaves role intact — can PATCH any subscription at its
--    gym and set status, credit_balance, paid_period_end, cancelled_at or
--    price_cents, or INSERT itself a subscription. Booking eligibility
--    (0050), credit burn (0103) and the finance summary (0173) all read
--    those columns. The client writes nothing here; every real write is a
--    stripe-* edge function or a definer RPC.
--
-- 2. direct_messages. The recipient-update policy pins recipient_id in
--    both USING and WITH CHECK and nothing else, so a recipient can
--    rewrite body and set sender_id to a third party — a forged message
--    landing in that person's own thread. read_at, the one column the
--    policy exists for, is written by mark_dm_thread_read (definer); the
--    client never issues a bare UPDATE.
--
-- 3. gym_announcements. The author-update policy's WITH CHECK is satisfied
--    by `posted_by = auth.uid()` alone, leaving gym_id mutable, so an
--    author can move their announcement into another gym's member inboxes
--    (the target uuid is public via gym_by_slug). The client only INSERTs.
--
-- 4. class_sessions. The coach-update policy uses user_can_manage_classes
--    (owner/admin/coach), which routes around can_bulk_edit_classes and
--    the overbooked / past-session / reschedule-notification guards that
--    live only in bulk_edit_sessions (definer). The client INSERTs and
--    DELETEs but never UPDATEs.

begin;

-- 1
revoke insert, update, delete on public.plan_subscriptions
  from anon, authenticated;

-- The two write policies are now dead. Drop them rather than leave a
-- misleading guard (user_can_assign_plan, no left_at, wrong capability)
-- that a future re-grant would silently inherit.
drop policy plan_subscriptions_staff_insert on public.plan_subscriptions;
drop policy plan_subscriptions_staff_update on public.plan_subscriptions;

-- 2
revoke update on public.direct_messages from anon, authenticated;

-- 3
revoke update on public.gym_announcements from anon, authenticated;

-- 4
revoke update on public.class_sessions from anon, authenticated;

commit;
