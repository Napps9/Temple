# Custom domains setup (Vercel Domains API)

Lets a gym connect a domain they own (e.g. `trainhard.com`) so it serves
their published site directly, instead of only `app.jointemple.io/site/<slug>`.

## One-time platform setup (Temple's Vercel account)

1. Vercel dashboard → Account/Team Settings → Tokens → create a token
   scoped to this project (or the team, if the project is team-scoped).
2. Note the Project ID (Project Settings → General) and, if the project
   lives under a team, the Team ID.

## Supabase edge-function secrets

Set these next to `RESEND_API_KEY` / `STRIPE_SECRET_KEY`
(Supabase → Edge Functions → Secrets):

| Secret | Value |
| --- | --- |
| `VERCEL_API_TOKEN` | the token from step 1 |
| `VERCEL_PROJECT_ID` | this project's id |
| `VERCEL_TEAM_ID` | only if the project is team-scoped |

Until `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID` are set, Connect domain
returns "Custom domains aren't configured yet" — nothing breaks, it just
can't start.

## How it flows

1. Owner/admin → Manage → Website → **Domain** → enters a domain.
2. `custom-domain` (`can_manage_website`-gated) adds it via the Vercel
   API and stores the DNS records it returns on `gym_website_domains`.
3. Staff adds those records at their registrar, clicks **Verify**.
4. Once Vercel confirms DNS, SSL is issued automatically — usually
   within a few minutes of DNS propagating, occasionally longer.
5. The domain now serves the gym's published site — a request on that
   domain is routed by `middleware.ts` (Vercel Routing Middleware),
   which resolves the `Host` header to a gym slug via
   `gym_slug_for_domain` and rewrites into the existing
   `/api/site/<slug>` function. Every other route on the platform's own
   domain (`/join/:slug`, the app itself, ...) is untouched.

## Test mode first

Test with a domain you control (a spare subdomain works) before pointing
a real gym's domain at production.

## Coming next (not built yet)

- Automatic `www` ↔ apex redirect pairing (Vercel's domain `redirect`
  field) — connecting `trainhard.com` today does not also claim
  `www.trainhard.com`.
- Cleanup of the Vercel-side domain if a gym is ever hard-deleted —
  there's no self-serve gym-delete flow today, so this is a manual step:
  disconnect the domain (Manage → Website → Domain) before deleting the
  gym.
