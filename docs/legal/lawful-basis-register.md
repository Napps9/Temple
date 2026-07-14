> **Reviewed and signed off 2026-07-10. Not legal advice — keep current.**
> This is the record UK GDPR Art. 30 expects you to keep, plus the
> lawful-basis analysis behind the Privacy Policy. Reviewed, dated and signed
> by a director (see foot of document); revisit on any material change.

# Lawful-basis register & record of processing (ROPA)

## How to complete this (the "how do I do it")

1. For **each processing activity**, record the purpose and the **Art. 6
   lawful basis** (and, for health data, the **Art. 9 condition**).
2. Where the basis is **legitimate interests**, do a short **LIA**
   (Legitimate Interests Assessment): the interest, why processing is
   necessary, and a balancing test against the individual's rights.
3. Keep the sub-processor list and retention periods current (they mirror the
   DPA).
4. A director **reviews, dates, and signs** it, and revisits on any material
   change.

## A. Temple as controller (account data)

| # | Processing | Data | Art. 6 basis | Notes |
|---|---|---|---|---|
| 1 | Create & operate accounts, authenticate | Name, email, hashed password, gym role | **Contract** | Necessary to provide the service. |
| 2 | Invoice Temple subscriptions | Billing metadata | **Contract** | Invoiced directly; no card or payment processor involved. |
| 3 | Security, debugging, reliability | Usage & log data | **Legitimate interests** | LIA needed (see below). |
| 4 | Support | Correspondence | **Legitimate interests** | LIA needed. |
| 5 | Marketing to gyms | Contact details | **Consent / legitimate interests** | Also PECR for electronic marketing. LIA if LI. |

**LIA (items 3–5):**

- **Item 3 — security, debugging, reliability.** *Interest:* run a secure,
  reliable, debuggable service. *Necessity:* usage and log data are the
  minimum needed to detect abuse, investigate faults and maintain uptime; no
  less-intrusive means achieves this. *Balance:* operational data only, no
  special-category data, short retention, and users reasonably expect a
  service to keep security/reliability logs → **legitimate interests
  appropriate.**
- **Item 4 — support.** *Interest:* respond to and resolve user requests.
  *Necessity:* the correspondence itself is required to help. *Balance:* the
  user initiates contact, data is minimal and expected → **legitimate
  interests appropriate.**
- **Item 5 — marketing to gyms.** *Interest:* reach prospective business
  customers. *Necessity:* B2B outreach to named business contacts is the
  direct means. *Balance:* business (not member/health) contacts, easy opt-out
  honoured, and PECR observed (soft-opt-in or consent for electronic
  marketing) → **legitimate interests appropriate for existing/business
  contacts; consent where PECR requires.**

Signed + dated at the foot of this document.

## B. Temple as processor (gym's member data — the gym holds the basis)

For member data, **the gym is the controller** and holds the lawful basis /
Art. 9 condition; Temple only processes on the gym's instructions (see the
DPA). Recorded here for completeness:

| Processing | Data | Controller's basis (gym) |
|---|---|---|
| Bookings, memberships, training logs, comms | Member identity, activity | Contract / legitimate interests (gym decides) |
| **Health screening** — PAR-Q, injuries | **Special-category (Art. 9)** | Art. 6 **consent** + Art. 9 **explicit consent**, captured at `/consent`; for under-18s, **parental/guardian consent** (gym opt-in) |
| Emergency contact | Third-party contact data | As above (health-adjacent) |
| Waiver signatures | Signature, liability record | Contract / **legal claims** (retained 6 years, DPA §10) |
| Marketing email + open/click tracking | Engagement | Gym's **PECR** consent/soft-opt-in |

## C. Retention (summary — see DPA §10 / Privacy §5)

- Account data: life of account + a reasonable period; billing per tax law
  (~6 years).
- Health data: erased on leaving; swept 3 months after membership ends.
- Waiver signatures: 6 years after membership ends, then deleted.

## D. Sub-processors

Supabase, Stripe, Resend, Vercel, and (optional) Anthropic, Pexels — see DPA
Annex B for locations and transfer mechanisms.

---

**Reviewed & signed off by:** Nick — Director, Temple Software Ltd (company
no. 15867522)  **Date:** 2026-07-10  **Next review:** 2027-07-10 or on
material change

**Correction, 2026-07-14:** Item 2's Art. 6 basis entry corrected — Temple
invoices gym subscriptions directly, not via Stripe (Stripe was never
accurate here; it only processes the separate gym-to-member payments under
Connect). No change to the underlying lawful basis (Contract) or to any
other item. Re-affirmed by: Nick — Director, Temple Software Ltd.
