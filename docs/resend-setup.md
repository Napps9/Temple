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

## 3. Give the cron dispatchers a worker secret (0199)

**Steps 1 and 2 turn on manual sends only.** Two pg_cron jobs —
`dispatch-scheduled-campaigns` and `dispatch-email-automations` — POST to
their workers from inside Postgres, and that POST has to satisfy two
layers:

- **Supabase's gateway (Kong)** rejects any request without a valid project
  API key — even for `verify_jwt = false` functions. A bare secret in the
  `Authorization` header gets a gateway `401 Invalid API key` before the
  function ever runs.
- **The function** then trusts an `x-automation-secret` header matched
  against its `AUTOMATION_WORKER_SECRET` env var.

So the dispatcher sends the **publishable key** (public, satisfies Kong) in
`apikey`, plus a **shared secret you choose** in `x-automation-secret`.
This replaces the earlier service-role-key approach, which was unusable:
it required the Vault value to byte-match the function's injected
`SUPABASE_SERVICE_ROLE_KEY`, and under Supabase's new API-key system
(`sb_publishable_…` / `sb_secret_…`) that value can't be reliably obtained
— every combination 403'd.

**One-time setup (three steps, all deterministic — no key hunting):**

1. Pick a random secret: `openssl rand -hex 32`.
2. Dashboard → **Edge Functions → Secrets**: set
   `AUTOMATION_WORKER_SECRET` = that secret. (Both workers already read
   this name.)
3. Dashboard → **SQL Editor**, once:
   ```sql
   select vault.create_secret('<the same secret from step 1>', 'worker_shared_secret');
   select vault.create_secret('<publishable key>',             'worker_gateway_key');
   ```
   The publishable key is **Settings → API Keys → Publishable**
   (`sb_publishable_…`); it is public, so it is safe in Vault and in the
   committed dispatcher. The shared secret in Vault **must equal** step 2.

Without these, nothing errors. `dispatch_scheduled_campaigns` returns 0 and
leaves due campaigns `scheduled`; `dispatch_email_automations` enqueues but
posts nothing. `cron.job_run_details` reports `succeeded` either way — that
is why `cron_run_log` (0189) exists:

```sql
select job_name, ran_at, result from cron_run_log
 where job_name like 'dispatch-%' order by ran_at desc limit 10;
```

Campaigns: `{"skipped": "missing worker_shared_secret or worker_gateway_key in vault"}`
is the not-configured case; `{"due": 0, …}` is a genuinely quiet period.
Automations: `{"has_secret": false, …}` is not configured; `has_secret:
true` with `posted: true` means the dispatcher reached the worker.

To check the worker actually **accepted** the call (not just that the
dispatcher posted), read the gateway's reply — `200` is good, `401`/`403`
means the secret or gateway key is wrong:

```sql
select status_code, content from net._http_response order by created desc limit 3;
```

## Verify

0. Run the **Run the gym** workflow with `what: scheduled-send` against a
   demo gym. It schedules a campaign a minute out and watches the
   dispatcher, the gateway's reply and the worker carry it to `sent`,
   naming the first hop that did not happen. This is the only check that
   covers step 3; everything below passes with the Vault row absent.
1. Manage → Comms → draft a campaign, pick a small test audience, send.
2. Check the campaign's analytics tab — recipients should show
   `delivered` (or `sent`, pending Resend's own status), not
   `simulated`.
3. Send a staff invite by email (Manage → Team) and confirm the email
   actually arrives, not just the fallback "code created" message.
