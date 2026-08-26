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
| 6 | Improving the product — which staff screens are used | Gym id, route pattern, date, a count | **Legitimate interests** | No identifier of any person; no device storage. LIA below. 90-day retention. |

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
- **Item 6 — which staff screens are used.** *Interest:* remove admin
  screens that the conversational surface has replaced, without deleting
  something a gym quietly relies on. *Necessity:* the only question is "has
  anyone in any gym opened this in ninety days"; the minimum that answers it
  is a gym id, a route pattern, a date and a count, which is exactly what
  `route_opens` holds. **There is no `profile_id` column** — the table
  cannot say who opened a screen, by construction rather than by policy —
  and route segments carrying an id (`/management/members/<uuid>`) are
  collapsed to `/management/members/[id]` on the device and again in the
  RPC, so no member is identified either. *Balance:* staff surfaces only,
  never the member app; nothing is stored on any device, so PECR's
  consent-for-storage rule is not engaged and the cookie banner is not the
  right gate — gating it there would have measured consent rate rather than
  usage; purged at 90 days by `purge_expired_route_opens` → **legitimate
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
| **Member SMS** — personal bests and other notices | Mobile number, message body | Gym's **PECR** consent — explicit opt-in only (`gym_memberships.sms_opt_in`, default off), withdrawable in-app or by texting STOP |

## C. Retention (summary — see DPA §10 / Privacy §5)

- Account data: life of account + a reasonable period; billing per tax law
  (~6 years).
- Health data: erased on leaving; swept 3 months after membership ends.
- Waiver signatures: 6 years after membership ends, then deleted.
- Staff screen-usage counts: 90 days, then deleted (`route_opens`).

## C2. Access to training history when a subscription lapses (0237)

A member's training record stays in the database whatever happens to their
membership or their athlete subscription. What changed in 0237 is **who can
browse it in the product**: the `tracked_*` select policies now require
either current membership of the gym the row belongs to, or an active
athlete subscription. Somebody who leaves a gym and does not subscribe
cannot page through their history in the app until they do; nothing is
deleted, and subscribing restores the view in full.

**That is a commercial gate on a product, and it is explicitly not a gate on
the right of access.** Article 15 entitles a data subject to a copy of
their personal data free of charge, and a subscription cannot be a
precondition for it. So `export_my_training_history()` returns the caller's
complete record — workouts, sections, entries, movement results, races and
splits — as one document, free, regardless of membership or tier. It is
`security definer` precisely so that it answers when the policies above do
not, and it takes no arguments and keys on `auth.uid()`, so there is no
shape of the call that reads anybody else's training.

Basis for continuing to hold the record after a subscription lapses:
legitimate interests (Art. 6(1)(f)) — the member's own interest in an
unbroken training history they can resume, and Temple's in offering it
back. It is not special-category data: workout results are performance
records, not health data, and the Article 9 surfaces (PAR-Q, injuries) are
separately governed and erased on leaving. A member who wants it gone uses
the existing erasure path, which is unaffected.

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
