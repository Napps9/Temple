# Temple legal documents — status and fill-in checklist

Documents in this folder:

- `terms-of-service.md` — Terms of Service (gyms as business users **and**
  individual/solo users as consumers)
- `privacy-policy.md` — Privacy Policy (Temple as controller of account data)
- `dpa.md` — Data Processing Agreement (Temple as the gym's processor)
- `breach-response.md` — breach detection & response runbook (backs DPA §8)
- `lawful-basis-register.md` — Art. 30 ROPA + lawful-basis analysis
- `dpia.md` — Data Protection Impact Assessment (health data + minors)

They were reviewed against UK best practice (UK GDPR, Data Protection Act
2018, PECR, ICO guidance, standard UK SaaS terms). **They are drafts, not
legal advice** — a UK-qualified solicitor should review them before they
govern any paying customer.

The rendered in-app versions of the Terms and Privacy Policy (shown at
`/terms` and `/privacy`) live in `src/lib/legal.ts` and mirror these — keep
the two in sync when you change the legal position.

---

## Resolved

- [x] **Legal entity** — Temple Software Ltd, company no. **15867522**
      (England & Wales), set across all docs.
- [x] **Liability cap** — the fees paid in the **3 months** before the claim.
- [x] **Waiver retention** — bounded to **6 years** and a scheduled purge job
      built (`0108`/`0109`), so the DPA promise is now backed.
- [x] **Cookies** — a consent banner is built; the Privacy Policy reflects
      "analytics only with consent" instead of "no banner".
- [x] **Under-18s** — gym opt-in setting + in-app parental-consent capture +
      solo 18+ block, so the docs' minors position is now backed by the
      product.
- [x] **Claims sweep** — softened international-transfer and breach wording to
      what we can actually back.

## Before you publish — still to fill in

- [ ] **Registered office** address (the one remaining entity `[bracket]`).
- [ ] **Create + monitor `privacy@jointemple.io`** — the docs point to it; a
      DSAR must be answered within one month, so it must reach someone.
- [ ] **Effective date** — replace every `[DATE]` / "Last updated".
- [ ] **Payment terms** — renewal, price-change notice, and (for any paid
      individual/consumer tier) the cancellation/refund mechanics.
- [ ] **Sub-processor Annex (DPA Annex B)** — confirm the list, each one's
      processing location, and the transfer mechanism (UK IDTA / SCCs).
- [ ] **Sub-processor change mechanism + notice period** (DPA §7).
- [ ] **Deletion window** (DPA §10 — drafted as 30/60 days; confirm).
- [ ] Publish the Terms + Privacy Policy on the `jointemple.io` marketing site
      too, if you want them there as well as the in-app `/terms` `/privacy`.

## Still outstanding — needs a person, not drafting

- [ ] **Solicitor review + sign-off** of all documents.
- [ ] **Complete + sign off the DPIA** (`dpia.md`) — score the risks, confirm
      residual risk, director signature.
- [ ] **Complete + sign off the lawful-basis register** (`lawful-basis-register.md`),
      including the legitimate-interests assessments.
- [ ] **Fill the breach-response contacts** and enable Supabase log alerting.

## Product follow-ups the review surfaced

- [x] **Automated breach/anomaly alerting** — a scheduled security monitor
      records RLS-regression / health-exfiltration / auth-burst signals to
      `security_alerts` (migration 0111). *To email them:* enable `pg_net`, set
      the `security-alert` function secrets + the `app.security_alert_url`/
      secret GUCs (see `breach-response.md`).
- [ ] **Consumer flow for paid solo** — solo is free in beta; if a paid tier
      launches, wire the Consumer Contracts Regs cancellation/refund path
      referenced in Terms §3.
