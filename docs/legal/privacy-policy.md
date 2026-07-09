> **DRAFT — pending solicitor review. Not legal advice.**
> AI-drafted starting point for Temple's legal counsel, grounded in how the
> product actually works (`docs/feature-inventory.md`, the health-data /
> GDPR section of `CLAUDE.md`, and a data-flow review of the codebase).
> Review, correct, and sign off before publishing. Placeholders in
> `[brackets]` need real values — see `docs/legal/README.md`.

# Temple — Privacy Policy

**Last updated: [DATE]**

This policy explains how **[Temple Technology Ltd / sole trader — confirm]**
("Temple", "we") handles personal data for which **we are the controller** —
principally the account data of gym owners, staff, and individual users who
sign up to Temple.

**Important distinction.** For the member data a gym stores in Temple
(bookings, training history, health data such as PAR-Q answers and injuries,
and any emergency-contact details), **the gym is the controller and Temple is
its processor**. How that data is handled is governed by the gym's own
privacy notice and by our Data Processing Agreement with the gym (`dpa.md`).
If you are a gym member, contact your gym about its use of your data.

## 1. Who we are

[Temple Technology Ltd], [company no.], [registered office]. Data protection
contact: **[privacy@jointemple.io — confirm a monitored inbox]**.

## 2. Data we control, and why

| Data | Purpose | Lawful basis (UK GDPR Art. 6) |
| --- | --- | --- |
| Account identity — name, email, password (hashed), gym role | Create and operate your account; authenticate you | Contract |
| Usage and log data | Security, debugging, keeping the service reliable | Legitimate interests (see below) |
| Billing data for **your Temple subscription** | Take payment for the platform | Contract |
| Support correspondence | Answer your queries | Legitimate interests |
| Marketing to prospective/existing gyms | Tell you about Temple | Consent or legitimate interests; electronic marketing also complies with **PECR** |

Where we rely on **legitimate interests**, we have weighed our interest
against your rights (a legitimate-interests assessment) and you may object at
any time (Section 6).

We do **not**, as controller, use members' special-category **health data**
for our own purposes — we only process it as the gym's processor under the
DPA.

## 3. Sub-processors / service providers

We rely on the following providers to run the service. Each processes data
only as needed to provide their piece:

- **Supabase** — database, authentication, and file storage.
- **Stripe** — payments. Gyms charge members on their own connected Stripe
  accounts; Stripe also processes billing for Temple subscriptions.
- **Resend** — transactional and campaign email delivery.
- **Vercel** — application hosting and delivery.
- **Anthropic** — AI assistance for optional features (e.g. import column
  mapping); receives only a privacy-safe aggregate summary, **never** raw
  member rows, and only if enabled.
- **Pexels** — stock-photo search for the website builder; receives only a
  staff search query, **no member data** (optional).

[Confirm the full, current list and each provider's role and processing
location before publishing.]

## 4. International transfers

Some providers may process data outside the UK/EEA. Where they do, we rely on
appropriate safeguards (e.g. the UK IDTA or EU Standard Contractual Clauses
with the UK Addendum). [Confirm the mechanism per provider.]

## 5. Retention

We keep account data for as long as your account is active and for a
reasonable period afterwards to meet legal, tax, and dispute-resolution
needs, then delete or anonymise it. Billing records are kept for the period
required by tax law [confirm — typically 6 years]. Member health data handled
on a gym's behalf follows the gym's settings and our built-in rules —
including erasure when a member leaves and an automatic sweep of health data
more than three months after a membership ends.

## 6. Your rights

Subject to law, you may access, correct, delete, restrict, or port your data,
object to processing based on legitimate interests, and withdraw consent
where we rely on it. To exercise rights over data **we control**, contact
**[privacy@jointemple.io]**. For data **a gym controls**, contact the gym.
You may also complain to the UK Information Commissioner's Office (ICO),
though we'd ask you to raise it with us first.

## 7. Automated decision-making

We do **not** make decisions producing legal or similarly significant effects
about you by solely automated means. The in-app class recommendation is a
non-binding suggestion computed on your own device; you are free to ignore
it.

## 8. Security

We protect data with row-level security isolating every gym's data, access
controls, encryption in transit, audit logging of health-data access, and
funnelling sensitive writes through authorised server-side routines. No
system is perfectly secure; we work to reduce risk continuously and will
notify you and/or the ICO of a personal-data breach where the law requires.

## 9. Cookies and local storage

The app is **cookie-light**. It does **not** use analytics, advertising, or
third-party tracking cookies, and it does not run behavioural analytics or
error-telemetry SDKs. It stores only what is **strictly necessary or
functional** on your device — your sign-in session and preferences such as
light/dark theme and UI state. Because none of this is non-essential
tracking, **no cookie consent banner is required** for the app.

Separately, marketing emails a **gym** sends via Temple's communications
tools may include open/click tracking; that is the gym's processing under its
own privacy notice, and every such email carries a one-click unsubscribe.
Temple's own transactional emails (sign-up, invites, receipts) do not track
opens or clicks.

## 10. Children

Temple accounts are for people aged 18 or over. Where a gym enrols a member
under 18, the gym (as controller) is responsible for obtaining
parental/guardian consent and the appropriate lawful basis; see the DPA. If
you believe a child has given us data without authorisation, contact us and
we will address it.

## 11. Changes

We may update this policy; we will notify you of material changes. The "Last
updated" date shows the current version.
