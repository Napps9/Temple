-- 0210: let the Stripe OAuth round-trip return where it started.
--
-- The callback has always redirected to /management/billing, because
-- that was the only place the connection could be started from. Day-one
-- setup now starts it from the conversation (docs/roadmap.md phase 3+4),
-- and bouncing the owner through the billing screen — which then has to
-- redirect again — makes a visible detour out of what should be "tap,
-- authorise, back where you were".
--
-- The path rides on the existing single-use state row, so it inherits
-- the CSRF guard: it is written when the round-trip starts and read once
-- when Stripe returns. The CHECK is what keeps it a path and not an open
-- redirect — a single leading slash (so no '//host' protocol-relative
-- form), no scheme, no whitespace, and short enough to be a route.

alter table public.stripe_oauth_states
  add column return_path text not null default '/management/billing'
    constraint stripe_oauth_states_return_path_ck
    check (
      return_path ~ '^/[A-Za-z0-9._~/-]*$'
      and return_path !~ '^//'
      and char_length(return_path) <= 120
    );
