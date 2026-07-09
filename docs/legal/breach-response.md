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

## How we detect a breach (honest, current state)

There is **no third-party monitoring or error-telemetry** in the stack today
(confirmed by code review). Detection currently relies on:

- **Supabase platform logs** — Postgres logs, API/PostgREST logs, and **Auth
  logs** (sign-ins, password resets, admin actions) in the Supabase
  dashboard. *Action: enable Supabase log drains / alerting so anomalies
  surface without someone watching the dashboard.*
- **Row-Level Security as the primary control** — every table is RLS-isolated
  per gym, so the most likely breach class (one tenant reading another's
  data) is prevented by design rather than merely detected. A regression
  would show up in tests/CI or a user report.
- **Stripe & Resend dashboards** — anomalous payment or email-sending
  activity.
- **Reports** — from gyms, members, or security researchers. *Action: publish
  a security contact (security@ or privacy@jointemple.io) so reports have a
  route in.*

> Known gap to close: there is no automated intrusion/anomaly alerting yet.
> Until there is, detection is largely manual + platform logs — do not claim
> more than that anywhere.

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

## Contacts (fill in)

- Internal lead: [name / role]
- ICO reporting: ico.org.uk/for-organisations/report-a-breach/ (or 0303 123
  1113)
- Security/breach inbox: [security@ / privacy@jointemple.io — create + monitor]
