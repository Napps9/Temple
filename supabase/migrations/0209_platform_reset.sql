-- 0209: One-time platform reset, requested by the owner (2026-07-29) so
-- the redesigned platform can be tested from a genuinely blank slate.
--
-- Confirmed before shipping: all data on the hosted project is test data
-- — no live Stripe billing, no provisioned front-desk numbers — so
-- nothing external keeps charging or sits orphaned. Storage objects
-- (logos, waiver PDFs) are left behind deliberately; they are
-- unreachable once their rows are gone and cost nothing meaningful.
--
-- Two deletes, in dependency order:
--   1. gyms — every tenant-scoped table cascades from gyms(id).
--      Profile-referencing columns without a delete action (created_by,
--      coach_id, marked_by, …) all live on gym-scoped tables, so their
--      rows are gone in this step, before any profile is touched.
--   2. auth.users — cascades profiles (0001), which cascades the
--      portable, gymless data (tracked_* solo rows, movement
--      favourites/preferences, athlete_subscriptions).
--
-- Plus the cross-gym import-inference learning store, which survives
-- gym deletion by design (gym_id set null) but has only ever learned
-- from test imports.
--
-- On a fresh database (pgTAP, local dev) every statement is a no-op —
-- migrations run before seeding, so the CI seed gym is unaffected.
-- cron_run_log is left as platform ops history; it holds no tenant data.

delete from public.gyms;
delete from auth.users;
delete from public.import_inference_corrections;
