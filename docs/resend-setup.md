# Communications Suite go-live (Resend secrets)

Runbook for turning on **live** email delivery for the Communications
Suite (`send-campaign`), the sending-domain feature (`sending-domain`),
and staff/member email invites (`send-invite`) — all three read the
same two secrets. Until they're set, sends are cleanly simulated (every
recipient lands in `email_events` with kind `'simulated'`, no network
call) — nothing is broken, it just isn't live.

No code work is needed for this — the live/simulated branching, retry
logic, and per-gym sending-domain fallback are already built and
correct. This is purely account + secrets configuration.

## 1. Verify a Temple sending domain in Resend

If you've already followed `docs/auth-email-setup.md` for Supabase
Auth SMTP, **you're done with this step** — Comms reuses the same
Resend account and the same verified domain
(`support.jointemple.io`, or whichever domain that runbook used).

If not, follow `docs/auth-email-setup.md` step 1 first. Resend refuses
to send from an address on an unverified domain, so this has to happen
before the secrets below do anything.

## 2. Set the edge-function secrets

Supabase Dashboard → **Edge Functions → Secrets** (or `supabase
secrets set` via the CLI):

| Secret | Value |
| --- | --- |
| `RESEND_API_KEY` | your Resend API key (`re_…`) — same value used for Auth SMTP |
| `RESEND_FROM_EMAIL` | an address on the verified domain, e.g. `updates@support.jointemple.io` |

This single pair of secrets is shared by three functions:

- `send-campaign` — the Communications Suite. `RESEND_FROM_EMAIL` is
  only the fallback; a gym with a verified custom sending domain
  (`gym_sending_domains.status = 'verified'`) sends from their own
  address instead.
- `sending-domain` — lets a gym connect and verify their own domain.
  Needs `RESEND_API_KEY` to do anything (returns a 503 without it);
  doesn't use `RESEND_FROM_EMAIL`.
- `send-invite` — staff/member invite emails. Silently degrades to
  "invite code created, not emailed" without these secrets — easy to
  miss since nothing surfaces as an error.

## Verify

1. Manage → Comms → draft a campaign, pick a small test audience, send.
2. Check the campaign's analytics tab — recipients should show
   `delivered` (or `sent`, pending Resend's own status), not
   `simulated`.
3. Send a staff invite by email (Manage → Team) and confirm the email
   actually arrives, not just the fallback "code created" message.
