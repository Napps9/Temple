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

**Status on the live project**: steps 1–3 are done. Live delivery has
been on since 2026-07-17 (`docs/gym-outreach-checklist.md`, a real
campaign confirmed delivered to an external inbox), and the Vault row in
step 3 was created on 2026-07-28. This runbook is what a fresh Supabase
project needs, and the reason a rebuilt one would look like it works and
send nothing.

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

## 3. Create the `worker_service_key` Vault row

**Steps 1 and 2 turn on manual sends only.** Two pg_cron jobs —
`dispatch-scheduled-campaigns` and `dispatch-email-automations` — POST to
their workers from inside Postgres, which needs a credential Postgres can
read. Hosted Supabase blocks `ALTER DATABASE` / `ALTER ROLE` for the
`postgres` role, so an `app.*` GUC cannot be set at all (0121); Vault is
the working pattern, same as `security_alert_secret` and
`agent_storage_purge_secret`.

Supabase Dashboard → **SQL Editor**, once per project:

```sql
select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'worker_service_key');
```

The service role key, verbatim, from Settings → API. Both workers accept
it through the `requireGymMember` service-key bypass, so this is one row
and no extra edge-function secret.

Without it nothing errors. `dispatch_scheduled_campaigns` returns 0 and
leaves due campaigns `scheduled`; `dispatch_email_automations` does the
same. `cron.job_run_details` reports `succeeded` either way — that is why
`cron_run_log` (0189) exists:

```sql
select job_name, ran_at, result from cron_run_log
 where job_name like 'dispatch-%' order by ran_at desc limit 10;
```

`{"skipped": "no worker_service_key in vault"}` is the missing-row case.
`{"due": 0, "dispatched": 0, …}` is a genuinely quiet period.

## Verify

0. Schedule a campaign a few minutes out and confirm it leaves
   `scheduled` on its own. This is the only check that covers step 3;
   everything below passes with the Vault row absent.
1. Manage → Comms → draft a campaign, pick a small test audience, send.
2. Check the campaign's analytics tab — recipients should show
   `delivered` (or `sent`, pending Resend's own status), not
   `simulated`.
3. Send a staff invite by email (Manage → Team) and confirm the email
   actually arrives, not just the fallback "code created" message.
