> **DRAFT — pending solicitor review. Not legal advice.**
> This document is an AI-drafted starting point for Temple's legal counsel.
> It reflects how the product actually works today (see
> `docs/feature-inventory.md`) so a solicitor has accurate facts to work
> from, but it must be reviewed, corrected, and signed off before it
> governs any real customer. Placeholders in `[brackets]` need real values —
> see `docs/legal/README.md` for the full fill-in checklist.

# Temple — Terms of Service

**Last updated: 10 July 2026**

These Terms of Service ("Terms") govern access to and use of the Temple
platform ("Temple", "we", "us"). They apply to two kinds of user:

- **Gyms** — a gym, studio, or other fitness business ("the Gym") that
  creates an account to run its business on Temple. These are
  business-to-business terms.
- **Individual users** — a person who creates their own account to train
  solo or to join a gym as a member ("Individual User"). Where an Individual
  User is acting as a consumer, **Section 3 (Consumer users)** applies and
  nothing in these Terms removes their statutory rights.

"You" means whichever of the above applies to you. By creating an account or
clicking to accept these Terms, you agree to them (and, for a Gym, on behalf
of that business).

The operating entity is **Temple Software Ltd**, a company registered in
England and Wales (company no. **15867522**), registered office
[registered office — to be confirmed].

## 1. The service

Temple is a multi-tenant software platform for running a fitness business:
class scheduling and bookings, membership plans, member management,
programming and training tracking, communications, a storefront, a website
builder, and related tools. Features available depend on your plan and any
add-ons. Some features are labelled **beta** or **free-during-beta** and may
change or be withdrawn.

## 2. Accounts, eligibility and age

- **Account holders must be 18 or over.** This applies to Gym owners/staff
  and to Individual Users who create their own account.
- **Under-18 gym members.** Temple checks a member's age from their date of
  birth. By default a gym cannot enrol members under 18; a gym may opt in via
  its settings. Where it does, Temple captures a parent or guardian's consent
  in-app before that member proceeds. The Gym remains **responsible** for
  ensuring that consent is valid and for any age-appropriate safeguards, and
  must not use Temple to collect a child's data without it. (See the DPA,
  `dpa.md`.)
- **Individual (solo) accounts are strictly 18 or over** — solo sign-up is a
  direct contract with Temple, with no gym or guardian involved, so under-18
  solo sign-up is refused.
- You are responsible for the accuracy of the information you provide, for
  your staff's use of the platform, and for keeping account credentials
  secure.
- A one-active-gym-per-user rule applies, as implemented in the product.

## 3. Consumer users

If you are an Individual User acting as a consumer (for example a solo
athlete or a gym member using Temple for personal, not business, purposes):

- These Terms do **not** exclude or limit your statutory rights under the
  **Consumer Rights Act 2015**, the **Consumer Contracts (Information,
  Cancellation and Additional Charges) Regulations 2013**, or other
  consumer-protection law. Where any provision of these Terms conflicts with
  those rights, your statutory rights prevail.
- For any **paid** subscription you buy directly from Temple, you have a
  14-day right to cancel from the day the contract is made, unless you have
  asked us to start the service within that period and it is fully performed.
  [Confirm the cancellation and refund mechanics for any paid Individual
  User tier before launch. Solo tracking is currently free during beta.]
- Note that memberships and class purchases you make **with a gym** are a
  contract between you and that gym (charged on the gym's own Stripe
  account), not with Temple — raise refunds and cancellations for those with
  your gym.

## 4. Your members' data — the Gym's responsibility

The Gym is the **data controller** for its members' personal data
(including special-category health data such as PAR-Q answers and injury
records). Temple acts as the Gym's **data processor** for that data. The
respective obligations are set out in the **Data Processing Agreement**
(`dpa.md`), which forms part of these Terms. The Gym is responsible for:

- having a lawful basis to collect and process its members' data (including
  parental/guardian consent for under-18s, per Section 2);
- providing its members with its own privacy information;
- obtaining any consents its operations require, including for electronic
  marketing (PECR) where it uses Temple's communications tools; and
- responding to its members' data-subject requests (Temple provides export,
  erasure, and audit tooling to help).

## 5. Payments and billing

### 5.1 What your members pay you
Temple uses **Stripe Connect (Standard)**. A Gym connects its **own** Stripe
account and charges its members **directly**. Temple is **not** a party to
those transactions, is **not** the merchant of record, and takes **no
application fee** — the Gym keeps 100% of what its members pay, less Stripe's
own fees. The Gym's relationship with Stripe is governed by Stripe's own
terms. The Gym is responsible for the tax treatment of its revenue, refunds,
chargebacks, and disputes with its members.

### 5.2 What you pay Temple
Fees for a Temple subscription and any paid add-ons (for example the website
builder) are as agreed at sign-up or by separate invoice. Unless stated
otherwise, fees are exclusive of VAT. [Payment terms, renewal, and
price-change notice to be confirmed.]

## 6. Acceptable use

You will not, and will not permit anyone to: use Temple unlawfully or to
process data you have no right to process; upload malware or attempt to
breach security, row-level isolation, or other tenants' data; scrape or
overload the service; resell or white-label the service except as expressly
permitted; or use the communications and website tools to send spam or
unlawful, infringing, or harmful content. You are responsible for content
you and your staff publish (gym website, campaigns, programming, store
listings), and for complying with PECR and marketing law when you email your
members.

## 7. Availability

We aim for high availability but the service is provided on an "as is" and
"as available" basis. We may modify, add, or remove features. We are not
liable for downtime, deploys, or third-party outages (Supabase, Stripe,
Resend, Vercel, and others) — subject always to Section 11 and your
statutory rights.

## 8. Suspension

We may suspend or restrict your access, on notice where practicable, if:
(a) you fail to pay fees when due; (b) we reasonably believe you are in
material breach of these Terms (including Section 6); or (c) suspension is
needed to protect the security or integrity of the service or other users.
We will restore access once the cause is resolved.

## 9. Intellectual property

Temple and its software are owned by us. You retain ownership of your own
content and data. You grant us the limited licence needed to host and
operate the service on your behalf. Any feedback you give us may be used
without obligation.

## 10. Term and termination

Either party may terminate as set out here [notice period to be confirmed].
A consumer Individual User may also close their account at any time and
exercise any cancellation right under Section 3. On termination we will make
your data available for export for a reasonable window and then delete it in
line with the DPA and our Privacy Policy. Sections that by their nature
should survive (fees owed, IP, liability, governing law) do.

## 11. Warranties and liability

Nothing in these Terms limits liability that cannot lawfully be limited —
including death or personal injury caused by negligence, fraud, or (for
consumers) anything that may not be excluded under the Consumer Rights Act
2015.

Subject to that:

- To the maximum extent permitted by law we disclaim implied warranties.
- We are not liable for indirect or consequential loss, loss of profit,
  goodwill, or data.
- Our total aggregate liability to you is capped at the total fees you paid
  Temple for the service in the **3 months** before the claim.

For consumers, these limits apply only so far as the law allows and do not
affect your statutory rights.

## 12. Indemnity (business users)

If you are a Gym or other business user, you will indemnify us against claims
arising from your unlawful use of the service, your content, or your
handling of your members' data in breach of these Terms or applicable law.
This Section does not apply to consumers.

## 13. Changes to these Terms

We may update these Terms. For material changes we will give reasonable
advance notice (for example by email or in-app) before they take effect.
Continuing to use the service after a change takes effect means you accept
the updated Terms; if you do not accept, you may stop using the service and,
if you are a consumer, exercise any rights you have. The "Last updated" date
shows the current version.

## 14. General

- **Force majeure** — neither party is liable for delay or failure caused by
  events beyond its reasonable control.
- **Assignment** — you may not assign these Terms without our consent; we may
  assign them to a successor to our business on notice.
- **Entire agreement** — these Terms, the DPA, and the Privacy Policy are the
  whole agreement between us on their subject matter.
- **Severance** — if any provision is unenforceable, the rest continues.
- **Waiver** — not enforcing a right is not a waiver of it.
- **Third parties** — except as stated, a person who is not a party has no
  rights under the Contracts (Rights of Third Parties) Act 1999.
- **Notices** — we may give notice by email or in-app; you may contact us at
  the address in Section 16.

## 15. Governing law

These Terms are governed by the laws of **England and Wales**, and the
courts of England and Wales have exclusive jurisdiction. If you are a
consumer resident elsewhere in the UK, you may also bring proceedings in your
local courts. [Confirm for any target markets outside the UK.]

## 16. Contact and complaints

Questions or complaints about these Terms or the service:
**privacy@jointemple.io**. We aim to acknowledge complaints promptly and
resolve them fairly.
