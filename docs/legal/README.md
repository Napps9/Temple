# Temple legal documents — status and fill-in checklist

Three AI-drafted, UK-focused documents live here:

- `terms-of-service.md` — Terms of Service (covers gyms as business users
  **and** individual/solo users as consumers)
- `privacy-policy.md` — Privacy Policy (Temple as controller of account data)
- `dpa.md` — Data Processing Agreement (Temple as the gym's processor)

They were reviewed against UK best practice (UK GDPR, Data Protection Act
2018, PECR, ICO guidance, and standard UK SaaS terms). **They are drafts, not
legal advice** — a UK-qualified solicitor should review them before they
govern any paying customer.

The rendered in-app versions of the Terms and Privacy Policy (shown at
`/terms` and `/privacy`) live in `src/lib/legal.ts` and mirror these — keep
the two in sync when you change the legal position.

---

## Before you publish — fill these in

Every `[bracket]` in the docs is a real value you must supply:

- [ ] **Legal entity** — is Temple a registered UK Ltd or a sole trader?
      Set the contracting-party name consistently across all three docs.
- [ ] **Company number + registered office** (if a Ltd), or trading
      name/address (if a sole trader).
- [ ] **Monitored contact inbox(es)** — a real `privacy@` / `legal@` (or
      equivalent) that someone actually reads. The repo only has example
      sending addresses today, not a monitored legal/privacy inbox.
- [ ] **Effective date** — replace every `[DATE]` / "Last updated".
- [ ] **Liability cap figure** — the `£[AMOUNT]` in the Terms.
- [ ] **Payment terms** — renewal, price-change notice, and (for any paid
      individual/consumer tier) the cancellation/refund mechanics.
- [ ] **Sub-processor Annex (DPA Annex B)** — confirm the current list, each
      one's processing location, and the transfer mechanism (UK IDTA / SCCs).
- [ ] **Sub-processor change mechanism + notice period** (DPA §7).
- [ ] **Deletion window** and **waiver retention period** (DPA §10 — drafted
      as 6 years per the Limitation Act 1980; confirm).
- [ ] **Governing law** — drafted as England & Wales; confirm for any market
      outside the UK.
- [ ] Publish the Terms + Privacy Policy where users see them before signup
      (the in-app `/terms` and `/privacy` routes are wired; also host on the
      `jointemple.io` marketing site if you want).

## Still outstanding — needs a person, not drafting

- [ ] **Solicitor review + sign-off** of all three documents.
- [ ] **DPIA** for the health-data processing, and the formal **lawful-basis
      sign-off** (flagged in `docs/feature-inventory.md`).

## Product gaps the review surfaced (decide separately)

- [ ] **No age gate.** DOB is collected with only a "not in the future"
      check, and individual/solo users agree to the Terms. The docs cover
      minors defensively (the gym is responsible for parental/guardian
      consent for under-18s), but consider adding an actual age gate /
      parental-consent flow in the product.
- [ ] **Consumer flow for paid solo.** Solo tracking is free in beta; if a
      paid individual tier launches, wire the Consumer Contracts Regs
      cancellation/refund path referenced in Terms §3.
