# Temple — Data Processing Agreement

**Last updated: 10 July 2026**

This Data Processing Agreement ("DPA") forms part of the Terms of Service
between **Temple Software Ltd** (company no. 15867522) ("Processor",
"Temple") and the gym or fitness business that uses Temple ("Controller",
"the Gym"). It governs Temple's processing of personal data on the Gym's
behalf under UK GDPR and the Data Protection Act 2018. Where this DPA
conflicts with the Terms on a data-protection matter, **this DPA prevails**.

## 1. Roles

The Gym is the **controller** of its members' personal data. Temple is the
**processor**, acting only on the Gym's documented instructions (the Terms,
this DPA, and the Gym's use of the platform's features). Where Temple
determines purposes for its own account/usage data, it acts as an
independent controller under its Privacy Policy — that is outside this DPA.

## 2. Details of processing

The subject-matter, duration, nature and purpose of the processing, and the
types of personal data and categories of data subject, are set out in
**Annex A**. In summary: Temple hosts, stores, retrieves, transmits and
deletes personal data so the Gym can run its business, for the term of the
Terms plus the deletion window in §10.

## 3. Categories of data subject and data

- **Data subjects:** the Gym's members (including, where the Gym enrols them,
  **members under 18**), prospective members/leads, its staff, and the
  **emergency contacts** members provide (third-party data).
- **Personal data:** identity and contact details, membership and booking
  records, payment-status metadata (payments themselves run on the Gym's own
  Stripe account), training/performance logs, communications, and
  **email-engagement data** (opens/clicks) where the Gym uses Temple's
  marketing tools.
- **Special-category data (Art. 9):** health data — **PAR-Q screening
  answers and injury records**, and emergency-contact details treated as
  health-adjacent. Waiver signatures are processed as liability records, not
  health data (retention in §10). The Gym is responsible for its Art. 9
  lawful condition; Temple provides the consent-capture and erasure tooling.

## 4. Processor obligations

Temple will:

1. process personal data only on the Gym's documented instructions,
   including on transfers, unless required by law (and will tell the Gym of
   any such legal requirement before processing, unless the law forbids it);
2. **notify the Gym if, in its opinion, an instruction infringes UK GDPR or
   other data-protection law** (Art. 28(3)(h));
3. ensure persons authorised to process are bound by confidentiality;
4. implement the technical and organisational measures in §6 / Annex C;
5. respect the conditions in §7 for engaging sub-processors;
6. assist the Gym, by appropriate technical and organisational measures, to
   respond to data-subject requests (via export, erasure, and audit tooling);
7. assist the Gym with security, breach notification, DPIAs, and prior
   consultation (§8);
8. at the Gym's choice, delete or return personal data at the end of the
   service, except where law requires retention (§10); and
9. make available information needed to demonstrate compliance and allow for
   and contribute to audits (§9).

## 5. Controller obligations

The Gym warrants and undertakes that it:

- has a **lawful basis** and (for health data) an Art. 9 condition to
  process the personal data it puts into Temple, and the right to provide it
  to Temple for processing;
- gives its members the required **privacy information** and handles their
  requests (Temple assists per §4.6);
- where it opts in to enrolling a **member under 18** (a gym setting),
  obtains verifiable parental/guardian consent — Temple captures a
  guardian's consent in-app as a supporting record, but the Gym remains
  responsible for its validity — and applies age-appropriate safeguards;
- complies with **PECR** and marketing law when it uses Temple's
  communications tools — including any consent/soft-opt-in for marketing
  email and its open/click tracking, and honouring unsubscribes; and
- gives instructions that are lawful.

## 6. Security measures

Temple maintains, at minimum (detailed in Annex C):

- **Tenant isolation** — row-level security (RLS) on every table so one
  gym's data is inaccessible to another.
- **Least-privilege writes** — dangerous operations run only through
  authorised, server-side security-definer routines.
- **Health-data access logging** — every staff view/erase of health data is
  recorded in an audit log (`health_data_access_log`).
- **Erasure and retention** — health data is erased when a member leaves,
  and an automatic scheduled sweep purges health data more than three months
  after a membership ends.
- **Consent gate** — members record data-processing consent before any
  health data can be stored.
- Encryption in transit; access controls; platform logging (via Supabase).

## 7. Sub-processors

The Gym gives general authorisation for Temple to engage the sub-processors
listed in **Annex B** (currently Supabase, Stripe, Resend, Twilio, Vercel,
and — for optional features — Anthropic and Pexels). Temple imposes data-protection
terms on each no less protective than this DPA and remains liable for their
performance. Temple will give the Gym at least **30 days' notice** before
adding or replacing a sub-processor (by email to the Gym's registered admin
contact); the Gym may object on reasonable data-protection grounds within
that period, and if the parties cannot resolve the objection the Gym may
terminate the affected service.

## 8. Breach, DPIA, assistance

Temple will notify the Gym **without undue delay** after becoming aware of a
personal-data breach affecting the Gym's data, with the information the Gym
reasonably needs to meet its own notification duties to the ICO and data
subjects (the Gym, as controller, must report to the ICO within 72 hours
where required). Temple's detection and response process is described in
`docs/legal/breach-response.md`. Temple will provide reasonable assistance
with the Gym's DPIAs and any prior consultation with the ICO.

## 9. Audit

Temple will make available information necessary to demonstrate compliance
with this DPA and allow for and contribute to audits, including inspections,
conducted by the Gym or an auditor it mandates, subject to reasonable
confidentiality, security, frequency, and notice conditions.

## 10. Return or deletion

On termination, or on the Gym's request, Temple will delete or return the
Gym's personal data and delete existing copies within **30 days**,
except to the extent law requires retention. Deletion cascades from the gym
record across tenant data as implemented in the platform.

**Waiver signatures** are an exception: they are retained as liability
records on the lawful basis of establishing/defending legal claims, for the
limitation period — **6 years from the end of the relevant membership**
(Limitation Act 1980) — and then deleted, rather than being swept by the
health-data erasure/retention machinery.

## 11. International transfers

Where a sub-processor processes data outside the UK/EEA, Temple ensures an
appropriate transfer mechanism is in place (e.g. the UK IDTA or EU SCCs with
the UK Addendum). See Annex B.

## 12. Liability

Liability under this DPA is subject to the limitations in the Terms.

---

## Annex A — details of processing

- **Subject-matter:** provision of the Temple platform to the Gym.
- **Duration:** the term of the Terms plus the §10 deletion window.
- **Nature:** hosting, storage, retrieval, transmission, and deletion.
- **Purpose:** enabling the Gym to run bookings, memberships, programming,
  training tracking, communications, store, and website.
- **Types of personal data / categories of data subject:** as set out in §3.

## Annex B — sub-processors

| Sub-processor | Service | Processing location | Transfer mechanism |
| --- | --- | --- | --- |
| Supabase | Database, auth, storage | Project region (confirm in Project → settings; London/Frankfurt = UK/EU) | None if UK/EU region; otherwise UK IDTA / EU SCCs — confirm on vendor DPA |
| Stripe | Payments infrastructure | US + global | UK IDTA / EU SCCs (+ EU–US DPF where certified) — confirm on vendor DPA |
| Resend | Email delivery | US | UK IDTA / EU SCCs — confirm on vendor DPA |
| Twilio | SMS + voice delivery (member phone number, message body) | US + global | UK IDTA / EU SCCs — confirm on vendor DPA |
| Vercel | Hosting / delivery | US + global | UK IDTA / EU SCCs (+ EU–US DPF where certified) — confirm on vendor DPA |
| Anthropic (optional) | AI import assistance (aggregate, no member rows) | US | UK IDTA / EU SCCs — confirm on vendor DPA |
| Pexels (optional) | Stock-photo search (no member data) | US | No personal data processed |

## Annex C — technical and organisational measures

The measures in §6, plus:

- **Tenant isolation** — Row-Level Security on every table; privileged writes
  only via authorised server-side routines.
- **Encryption** — in transit (TLS); at rest for the database and storage, as
  provided by the managed Supabase platform.
- **Access control** — authentication with hashed passwords; role- and
  capability-based authorisation; health-data access recorded in an audit log.
- **Retention** — scheduled purges of health data and (after 6 years) waiver
  signatures.
- **Monitoring & response** — an automated security monitor
  (`security_alerts`) and a documented breach-response runbook
  (`breach-response.md`).
- **Backups** — managed database backups provided by the Supabase platform.

---

**Signed for the Controller (Gym):** ____________________  Date: ________
**Signed for the Processor (Temple):** __________________  Date: ________
