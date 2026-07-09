> **DRAFT — pending solicitor review. Not legal advice.**
> AI-drafted starting point for a UK GDPR Data Processing Agreement between
> Temple (processor) and a gym (controller), grounded in the platform's
> actual data-protection design (`CLAUDE.md` health-data section,
> `docs/feature-inventory.md`). Review, correct, and sign off before use.
> Placeholders in `[brackets]` need real values.

# Temple — Data Processing Agreement

**Last updated: [DATE]**

This Data Processing Agreement ("DPA") forms part of the Terms of Service
between **[Temple Technology Ltd]** ("Processor", "Temple") and the gym or
fitness business that uses Temple ("Controller", "the Gym"). It governs
Temple's processing of personal data on the Gym's behalf under UK GDPR and
the Data Protection Act 2018.

## 1. Roles

The Gym is the **controller** of its members' personal data. Temple is the
**processor**, acting only on the Gym's documented instructions (the Terms,
this DPA, and the Gym's use of the platform's features). Where Temple
determines purposes for its own account/usage data, it acts as an
independent controller under its Privacy Policy — that is outside this DPA.

## 2. Subject-matter, duration, nature and purpose

- **Subject-matter / purpose:** providing the Temple platform so the Gym can
  run its business (bookings, memberships, programming, training tracking,
  communications, store, website).
- **Duration:** for the term of the Terms, plus the deletion window in §9.
- **Nature:** hosting, storage, retrieval, transmission, and deletion of
  personal data via the platform.

## 3. Categories of data subject and data

- **Data subjects:** the Gym's members, prospective members/leads, and its
  staff.
- **Personal data:** identity and contact details, membership and booking
  records, payment-status metadata (payments themselves run on the Gym's
  own Stripe account), training/performance logs, communications.
- **Special-category data (Art. 9):** health data — **PAR-Q screening
  answers and injury records**. Waiver signatures are processed as liability
  records, not health data. The Gym is responsible for its Art. 9 lawful
  condition; Temple provides the consent-capture and erasure tooling.

## 4. Processor obligations

Temple will:

1. process personal data only on the Gym's documented instructions;
2. ensure persons authorised to process are bound by confidentiality;
3. implement the technical and organisational measures in §5;
4. respect the conditions in §6 for engaging sub-processors;
5. assist the Gym, taking account of the nature of processing, to respond
   to data-subject requests (via export, erasure, and audit tooling);
6. assist the Gym with security, breach notification, DPIAs, and prior
   consultation (§7);
7. at the Gym's choice, delete or return personal data at the end of the
   service, and delete existing copies except where law requires retention
   (§9); and
8. make available information needed to demonstrate compliance and allow
   for audits (§8).

## 5. Security measures

Temple maintains, at minimum:

- **Tenant isolation** — row-level security (RLS) on every table so one
  gym's data is inaccessible to another.
- **Least-privilege writes** — dangerous operations run only through
  authorised, server-side security-definer routines.
- **Health-data access logging** — every staff view/erase of health data is
  recorded in an audit log (`health_data_access_log`).
- **Erasure and retention** — health data is erased when a member leaves,
  and an automatic scheduled sweep purges health data more than three
  months after a membership ends.
- **Consent gate** — members record data-processing consent before any
  health data can be stored.
- Encryption in transit; access controls; monitoring and error reporting.

## 6. Sub-processors

The Gym gives general authorisation for Temple to engage sub-processors to
provide the service, currently including: **Supabase** (database/auth/
storage), **Stripe** (payments infrastructure), **Resend** (email),
**Vercel** (hosting), and — for optional features — **Anthropic** (AI
assistance, privacy-safe summaries only) and **Pexels** (stock photos).
Temple imposes data-protection terms on each sub-processor no less
protective than this DPA, remains liable for their performance, and will
give notice of intended changes so the Gym may object. [Confirm the current
list and a change-notification mechanism before signing.]

## 7. Breach, DPIA, assistance

Temple will notify the Gym without undue delay after becoming aware of a
personal-data breach affecting the Gym's data, with the information the Gym
reasonably needs to meet its own notification duties. Temple will provide
reasonable assistance with the Gym's DPIAs and prior consultations.

## 8. Audit

Temple will make available information necessary to demonstrate compliance
with this DPA and allow for and contribute to audits, including inspections,
conducted by the Gym or an auditor it mandates, subject to reasonable
confidentiality, security, and notice conditions.

## 9. Return or deletion

On termination, or on the Gym's request, Temple will delete or return the
Gym's personal data and delete existing copies within [30/60] days, except
to the extent law requires retention. Deletion cascades from the gym record
across tenant data as implemented in the platform.

## 10. International transfers

Where a sub-processor processes data outside the UK/EEA, Temple ensures an
appropriate transfer mechanism is in place (e.g. UK IDTA / EU SCCs).

## 11. Liability

Liability under this DPA is subject to the limitations in the Terms.

---

**Signed for the Controller (Gym):** ____________________  Date: ________
**Signed for the Processor (Temple):** __________________  Date: ________
