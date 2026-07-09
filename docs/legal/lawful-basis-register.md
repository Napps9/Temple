> **DRAFT — pending review + sign-off. Not legal advice.** This is the record
> UK GDPR Art. 30 expects you to keep, plus the lawful-basis analysis behind
> the Privacy Policy. "Sign-off" means a responsible person (a director)
> reviews it, dates it, and keeps it current.

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
| 2 | Take payment for Temple subscriptions | Billing metadata | **Contract** | Stripe processes card data. |
| 3 | Security, debugging, reliability | Usage & log data | **Legitimate interests** | LIA needed (see below). |
| 4 | Support | Correspondence | **Legitimate interests** | LIA needed. |
| 5 | Marketing to gyms | Contact details | **Consent / legitimate interests** | Also PECR for electronic marketing. LIA if LI. |

**LIA (items 3–5) — to complete:** interest = running a secure, reliable,
improvable service / reaching prospective customers; necessity = [why less
intrusive means won't do]; balance = minimal data, no special-category data,
opt-out honoured → [conclusion]. Sign + date.

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

**Reviewed & signed off by:** ____________________ (director)  Date: ________
