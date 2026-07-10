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
2018, PECR, ICO guidance, standard UK SaaS terms). **They have not been
reviewed by a UK-qualified solicitor** — that's a deliberate, informed
decision to publish without one for now; get a one-off review of the ToS
+ DPA (the two that most need it — liability, IP, indemnity) when you can.
Not legal advice.

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

## Filled in

- [x] **Registered office** — 49 Deeside Road, London SW17 0PH.
- [x] **Effective date** — set to **10 July 2026** on ToS, Privacy, DPA.
- [x] **Privacy contact** — `privacy@jointemple.io` un-bracketed in the docs
      (the mailbox itself still needs creating — checklist Tier 1 item 4;
      a DSAR must be answered within one month, so it must reach someone).
- [x] **Sub-processor Annex (DPA Annex B)** — locations + transfer mechanisms
      filled (Supabase = project region; US vendors on UK IDTA / EU SCCs / DPF;
      Pexels = no personal data), each marked "confirm on vendor DPA".
- [x] **Annex C — technical and organisational measures** — filled with the
      product's actual controls (RLS, encryption, access control, retention,
      monitoring, backups).
- [x] **Sub-processor change mechanism + notice period** — 30 days, by email
      to the gym's registered admin contact (DPA §7).
- [x] **Deletion window** — 30 days (DPA §10).
- [x] **Termination notice** — 30 days' written notice (ToS §10).
- [x] **Breach-response contacts** filled (internal lead + security/privacy
      inbox).
- [x] **DRAFT banners dropped** — `docs/legal/*.md` and the in-app `/terms` +
      `/privacy` screens (`src/lib/legal.ts`) no longer show a draft/pending
      notice. This is a real decision, not just tidy-up: **no solicitor has
      reviewed these** — see the note above.

## Before you publish — still open

- [ ] **Payment terms** — renewal, price-change notice, and (for any paid
      individual/consumer tier) the cancellation/refund mechanics.
- [ ] Publish the Terms + Privacy Policy on the `jointemple.io` marketing site
      too, if you want them there as well as the in-app `/terms` `/privacy`.

## Still outstanding — needs a person, not drafting

- [ ] **Solicitor review** of ToS + DPA — recommended, not done. No banner
      enforces this anymore, so it's on you to schedule it.
- [x] **Complete + sign off the DPIA** (`dpia.md`) — scored, residual risk
      Low–Medium, director signature 2026-07-10 (two tracked residual actions).
- [x] **Complete + sign off the lawful-basis register**
      (`lawful-basis-register.md`) — LIAs done, signed 2026-07-10.
- [x] **Fill the breach-response contacts**; log alerting still to enable
      (the `security-alert` secret/GUCs — checklist Tier 2).

## Product follow-ups the review surfaced

- [x] **Automated breach/anomaly alerting** — a scheduled security monitor
      records RLS-regression / health-exfiltration / auth-burst signals to
      `security_alerts` (migration 0111). *To email them:* enable `pg_net`, set
      the `security-alert` function secrets + the `app.security_alert_url`/
      secret GUCs (see `breach-response.md`).
- [ ] **Consumer flow for paid solo** — solo is free in beta; if a paid tier
      launches, wire the Consumer Contracts Regs cancellation/refund path
      referenced in Terms §3.
