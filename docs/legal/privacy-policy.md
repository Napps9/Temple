> **DRAFT — pending solicitor review. Not legal advice.**
> AI-drafted starting point for Temple's legal counsel, grounded in how the
> product actually works (`docs/feature-inventory.md`, the health-data /
> GDPR section of `CLAUDE.md`). Review, correct, and sign off before
> publishing. Placeholders in `[brackets]` need real values.

# Temple — Privacy Policy

**Last updated: [DATE]**

This policy explains how **[Temple Technology Ltd]** ("Temple", "we")
handles personal data for which **we are the controller** — principally the
account data of gym owners, staff, and individual users who sign up to
Temple.

**Important distinction.** For the member data a gym stores in Temple
(bookings, training history, and health data such as PAR-Q answers and
injuries), **the gym is the controller and Temple is its processor**. How
that data is handled is governed by the gym's own privacy notice and by our
Data Processing Agreement with the gym (`dpa.md`). If you are a gym member,
contact your gym about its use of your data.

## 1. Who we are

[Temple Technology Ltd], [company no.], [registered office]. Data
protection contact: **[privacy@jointemple.io]**.

## 2. Data we control, and why

| Data | Purpose | Lawful basis (UK GDPR Art. 6) |
| --- | --- | --- |
| Account identity — name, email, password (hashed), gym role | Create and operate your account; authenticate you | Contract |
| Usage and device/log data | Security, debugging, service improvement | Legitimate interests |
| Billing data for **your Temple subscription** | Take payment for the platform | Contract |
| Support correspondence | Answer your queries | Legitimate interests |
| Marketing to prospective gyms (if any) | Tell you about Temple | Consent / legitimate interests |

We do **not**, as controller, use members' special-category **health
data** for our own purposes — we only process it as the gym's processor
under the DPA.

## 3. Sub-processors / service providers

We rely on the following providers to run the service. Each processes data
only as needed to provide their piece:

- **Supabase** — database, authentication, and file storage (hosting of
  application data).
- **Stripe** — payments. Gyms charge members on their own connected Stripe
  accounts; Stripe also processes billing for Temple subscriptions.
- **Resend** — transactional and campaign email delivery.
- **Vercel** — application hosting and delivery.
- **Anthropic** — AI assistance for optional features (e.g. import column
  mapping); receives only privacy-safe summaries, never raw member rows.
- **Pexels** — stock-photo search for the website builder (optional).

[Confirm the full, current list and each provider's role and location
before publishing.]

## 4. International transfers

Some providers may process data outside the UK/EEA. Where they do, we rely
on appropriate safeguards (e.g. UK IDTA / EU Standard Contractual Clauses).
[Confirm per provider.]

## 5. Retention

We keep account data for as long as your account is active and for a
reasonable period afterwards, then delete or anonymise it. Member health
data handled on a gym's behalf follows the gym's retention settings and our
built-in rules — including erasure when a member leaves and an automatic
sweep of health data more than three months after a membership ends.

## 6. Your rights

Subject to law, you may access, correct, delete, restrict, or port your
data, and object to certain processing. To exercise rights over data **we
control**, contact **[privacy@jointemple.io]**. For data **a gym
controls**, contact the gym. You may also complain to the UK Information
Commissioner's Office (ICO).

## 7. Security

We protect data with row-level security isolating every gym's data, access
controls, encryption in transit, audit logging of health-data access, and
funnelling sensitive writes through authorised server-side routines. No
system is perfectly secure; we work to reduce risk continuously.

## 8. Cookies / local storage

The app uses storage strictly necessary to keep you signed in and remember
preferences (such as light/dark theme). [Confirm whether any analytics or
non-essential cookies are used; add a cookie notice/banner if so.]

## 9. Changes

We may update this policy; material changes will be notified. The "Last
updated" date shows the current version.
