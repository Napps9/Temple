> **DRAFT — pending completion + sign-off. Not legal advice.** A DPIA is
> required here because Temple processes **special-category health data**
> (PAR-Q, injuries) systematically, at scale, across many gyms — and now data
> about **children** where a gym opts in. This template follows the ICO's
> method; fill the risk scoring and sign it off. Keep it under review.

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

## 4. Risks to individuals & mitigations already in place

| Risk | Likelihood / severity | Mitigation in the product |
|---|---|---|
| One gym accessing another's member/health data | [score] | **RLS** on every table; dangerous writes only via authorised server-side routines |
| Staff over-access to health data | [score] | Access **audit log** (`health_data_access_log`); capability gating; **automated exfiltration monitor** flags an actor viewing many members' health data |
| Health data kept too long | [score] | Erased on leaving; **auto-purge** 3 months after membership ends (scheduled) |
| Waiver records kept indefinitely | [score] | Now bounded to **6 years**, then purged (scheduled) |
| A child's data processed without authority | [score] | Age check from DOB; gym **opt-in** required; **guardian consent** captured; solo sign-up blocked under 18 |
| Consent not meaningful / not recorded | [score] | Explicit tick-box consent gate, versioned; re-consent on policy change |
| Breach exposure | [score] | Encryption in transit; RLS; a **scheduled security monitor** (RLS-regression, health-data exfiltration, auth bursts → `security_alerts` + optional ops email); breach runbook (`breach-response.md`) |
| Data transferred outside the UK | [score] | IDTA/SCCs where applicable — **confirm per sub-processor (DPA Annex B)** |

## 5. Residual risk & sign-off

- Outstanding items to resolve: configure the security monitor's ops email;
  confirm all international-transfer mechanisms; [others].
- Residual risk after mitigations: [low / medium / high — justify].

**Assessed by:** ______________  **Signed off (director):** ______________
**Date:** ________  **Review date:** ________
