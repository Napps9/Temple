> **Completed and signed off 2026-07-10. Not legal advice — keep under
> review.** A DPIA is required here because Temple processes
> **special-category health data** (PAR-Q, injuries) systematically, at scale,
> across many gyms — and now data about **children** where a gym opts in. This
> follows the ICO's method. Two residual actions remain tracked in section 5;
> next review 2027-07-10 or on any material change.

# Data Protection Impact Assessment — Temple

## 1. How to do a DPIA (the "how")

The ICO's steps: **(1)** describe the processing; **(2)** assess its
**necessity and proportionality**; **(3)** identify and score the **risks to
individuals**; **(4)** identify **measures to reduce** those risks; **(5)**
**sign off** and record the outcome; **(6)** keep it **under review**.
Consult your DPO if you have one; consult data subjects/their reps where
appropriate. If high risks remain that you can't mitigate, consult the ICO
before starting.

## 2. Describe the processing

- **What:** a multi-tenant gym platform — bookings, memberships, programming,
  training logs, communications, store, website — plus **health screening**
  (PAR-Q answers, injury records) and emergency contacts.
- **Whose data:** gym members (incl. **under-18s** where a gym opts in),
  prospects/leads, and staff.
- **Scale:** many gyms, potentially thousands of members; ongoing.
- **Roles:** the gym is controller; Temple is processor (health data). Temple
  is controller for account data.
- **Data flows / sub-processors:** Supabase (DB/auth/storage), Stripe
  (payments), Resend (email), Vercel (hosting); optional Anthropic, Pexels.

## 3. Necessity & proportionality

- **Lawful basis:** health data on **explicit consent** captured at
  `/consent`; parental/guardian consent for under-18s (gym opt-in). See the
  lawful-basis register.
- **Data minimisation:** PAR-Q/injury data is only what screening needs;
  members can withdraw and erase; no health data used for Temple's own
  purposes.
- **Rights:** access/erasure via in-app tools; audit log of health-data
  access.
- **Product-improvement measurement:** Temple counts which *staff* screens
  get opened, per gym, per route pattern, per day. There is no identifier of
  any person in the table — no `profile_id` column exists — and id-carrying
  route segments are collapsed to `[id]` before storage, so it cannot say
  who opened what or about whom. Nothing is written to any device, so this
  is not cookie/PECR processing and is not behind the consent banner;
  retained 90 days. The purpose is deleting admin screens the conversational
  surface has replaced without removing one a gym still relies on. See item
  6 of the lawful-basis register. It is deliberately *not* merged into
  `health_data_access_log` or `agent_recording_access_log`, which are
  per-person audit trails serving a different purpose.

- **Marketing-site measurement (0279):** two layers, and the line between
  them is whether a person is named. `site_events` counts an event, a day, a
  page, a source, a device and a count — no identifier, nothing written to
  any device, so not cookie/PECR processing and not behind the banner,
  retained 90 days, legitimate interests (register item 7). `site_visits`
  attaches a random visitor uuid so the same person's path can be followed
  from a pricing page to a booking; that id lives in `localStorage`, so PECR
  **is** engaged and it is written **only on consent** (register item 8).
  The demo half is confined to demo tenants — `record_demo_event` refuses
  any gym that is not `is_demo` (0278) — so neither table can become a
  record of which screens a real gym's staff opened, which is the property
  `route_opens` was built to guarantee and this deliberately does not
  weaken.

## 4. Risks to individuals & mitigations already in place

Scoring: likelihood × severity, each Low/Medium/High, giving a residual
rating **after** the mitigations already in the product.

| Risk | Likelihood / severity | Residual | Mitigation in the product |
|---|---|---|---|
| One gym accessing another's member/health data | Low / High | **Low** | **RLS** on every table (tenant-isolated, pgTAP-tested); dangerous writes only via authorised server-side routines |
| Staff over-access to health data | Medium / High | **Low–Medium** | Access **audit log** (`health_data_access_log`); capability gating; **automated exfiltration monitor** flags an actor viewing many members' health data (detective, not preventive → not Low) |
| Health data kept too long | Low / Medium | **Low** | Erased on leaving; **auto-purge** 3 months after membership ends (scheduled, `0095`) |
| Waiver records kept indefinitely | Low / Low–Medium | **Low** | Now bounded to **6 years**, then purged (scheduled, `0108`/`0109`) |
| A child's data processed without authority | Low / High | **Low** | Age check from DOB; gym **opt-in** required; **guardian consent** captured; solo sign-up blocked under 18 |
| Consent not meaningful / not recorded | Low / Medium | **Low** | Explicit tick-box consent gate, versioned; re-consent on policy change |
| Breach exposure | Medium / High | **Medium** | Encryption in transit; RLS; a **scheduled security monitor** (RLS-regression, health-data exfiltration, auth bursts → `security_alerts` + optional ops email); breach runbook (`breach-response.md`). Residual stays Medium until the ops-email alert is live (action A1). |
| Data transferred outside the UK | Medium / Medium | **Low–Medium** | Non-UK/EU sub-processors relied on under **SCCs / UK IDTA / adequacy (EU–US DPF)** — **confirm per sub-processor (DPA Annex B)** (action A2) |

## 5. Residual risk & sign-off

**Tracked actions (do not block sign-off; both reduce a Medium residual to
Low):**
- **A1 — configure the security monitor's ops email/secret** so breach alerts
  are pushed, not just recorded in `security_alerts`. Owner: director.
  Target: before first real member onboarding.
- **A2 — confirm the international-transfer mechanism for each sub-processor**
  (Supabase, Stripe, Resend, Vercel, and optional Anthropic/Pexels) and record
  it in DPA Annex B. Owner: director. Target: before first real member
  onboarding.

**Residual risk after mitigations: Low–Medium.** The strong preventive
controls (tenant RLS, consent gate, scheduled purges, minor safeguards) put
most risks at Low. Two items sit at Medium — breach alerting (A1) and
international transfers (A2) — and drop to Low once those actions complete. No
residual **high** risk remains, so prior ICO consultation is not required.

**Assessed by:** Nick, Director — Temple Software Ltd (company no. 15867522)
**Signed off (director):** Nick — Temple Software Ltd
**Date:** 2026-07-10  **Review date:** 2027-07-10 (or on material change)
