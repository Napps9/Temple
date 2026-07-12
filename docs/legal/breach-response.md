> **DRAFT — operational runbook, not legal advice.** Review with counsel and
> keep current. This is what backs the breach-notification promise in the DPA
> (`dpa.md` §8), so it must describe what Temple can actually do.

# Personal-data breach — detection & response

A personal-data breach is any security incident leading to the accidental or
unlawful destruction, loss, alteration, unauthorised disclosure of, or access
to, personal data. Under UK GDPR, **Temple (processor)** must tell the
**gym (controller) without undue delay** after becoming aware; the gym then
decides whether to notify the **ICO within 72 hours** and whether to tell
affected individuals.

## How we detect a breach

### Automated security monitor (built)

A scheduled `pg_cron` job, `run_security_monitor()` (migration 0111, runs
every 15 min), records signals into the `security_alerts` table and — when
configured — emails a Temple ops address via the `security-alert` edge
function. It computes three signals:

- **RLS regression** — any `public` base table with row-level security
  **disabled** (a direct anon/authenticated exposure). High-confidence.
- **Health-data exfiltration** — an actor who viewed an unusually high number
  of distinct members' health data in the last hour (from
  `health_data_access_log`).
- **Auth anomaly (best-effort)** — bursts of failed logins / recovery requests
  in `auth.audit_log_entries`.

**What it deliberately does NOT catch** (do not claim otherwise): health reads
that bypass the logging RPC or run under the service role; RLS policies that
are present but misconfigured; and it depends on Supabase's internal auth-log
shape for signal 3. It is a tripwire for specific, likely failure modes — not
a complete IDS.

*Config to make it email (else it records silently):* enable `pg_net`
(migration 0112 does), set `SECURITY_ALERT_SECRET` + `RESEND_API_KEY` +
`RESEND_FROM_EMAIL` + `SECURITY_ALERT_EMAIL` on the `security-alert` function,
and store the same secret in Supabase Vault under the name
`security_alert_secret` — `select vault.create_secret('<value>',
'security_alert_secret');` in the SQL editor. (Migration 0121: hosted
Supabase blocks `ALTER DATABASE`/`ALTER ROLE` for custom GUCs, so the
webhook URL is hardcoded in `run_security_monitor()` and the secret is read
from Vault instead of a GUC.)

### Also relied on

- **Supabase platform logs** — Postgres / PostgREST / Auth logs in the
  dashboard; enable log drains for retention.
- **RLS as the primary control** — every table is RLS-isolated per gym, so the
  likeliest breach class (cross-tenant reads) is prevented by design; the
  monitor's RLS-regression check guards against a lapse.
- **Stripe & Resend dashboards** — anomalous payment / email activity.
- **Reports** — from gyms, members, or researchers. Publish a security contact
  so reports have a route in.

## Response flow

1. **Contain** — stop the exposure (revoke keys, disable the affected path,
   rotate secrets, patch and deploy).
2. **Assess** — what data, whose, how many, which gyms; is it likely to risk
   individuals' rights and freedoms?
3. **Notify the affected gym(s) without undue delay** — with what happened,
   the data and people involved, likely consequences, and the measures taken.
   Each gym, as controller, then handles its own ICO / data-subject
   notification (ICO within 72 hours where the risk threshold is met).
4. **For Temple's own controller data** (account/billing) Temple notifies the
   ICO directly where required.
5. **Record** every breach — facts, effects, remedial action — in a breach
   log, whether or not it was notifiable (UK GDPR requires this record).
6. **Review** — root cause and a preventative fix.

## Contacts

- Internal lead: Nick — Director, Temple Software Ltd
- ICO reporting: ico.org.uk/for-organisations/report-a-breach/ (or 0303 123
  1113)
- Security/breach inbox: security@jointemple.io / privacy@jointemple.io
  (mailboxes to be created — see the outreach checklist, Tier 1 item 4)
