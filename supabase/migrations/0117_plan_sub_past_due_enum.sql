-- Retention cockpit, Phase 1a — payment-failure visibility (enum only).
--
-- A membership subscription whose renewal charge fails currently has
-- nowhere to land: plan_sub_state has no 'past_due', so the stripe-webhook
-- leaves a failing membership looking 'active' until Stripe finally gives
-- up and deletes it (jumping straight to 'cancelled'). Add the value so the
-- webhook (0118) can record the failing state.
--
-- Postgres forbids using a freshly-added enum value in the same transaction
-- that adds it, so this migration does nothing else — the cohort/webhook
-- changes that reference 'past_due' live in 0118, a separate transaction.

alter type public.plan_sub_state add value if not exists 'past_due';
