# Gym-outreach launch plan

Execution plan for the readiness checklist (`docs/gym-outreach-checklist.md`).
The checklist says *what must be true*; this says *do it in this order, and
who does what*.

Most of this is dashboard / legal / business work that only you can do
(secrets, DNS, Stripe, pricing, legal sign-off). A handful of pieces I can
draft in the repo — flagged **[Claude]** — so they're ready for you to
paste/review rather than write from scratch.

---

## Two milestones

- **Milestone A — Demo-ready:** you can show a live prospect the product
  working end-to-end (test mode throughout). Gate: Phases 0–1 + 4a.
- **Milestone B — Onboard-a-paying-gym:** a real gym signs up, takes real
  money, on solid legal footing. Gate: everything.

## Critical path to Milestone B

```
Verify Resend domain ─┬─▶ Auth email working (signups) ─┐
                      └─▶ Resend secrets (comms/invites) ─┤
                                                          ├─▶ Smoke test ─▶ OUTREACH
Stripe test ─▶ Stripe live ───────────────────────────────┤
Legal drafts ─▶ legal review ─────────────────────────────┘
```

Everything hangs off **one** thing: verifying the Resend sending domain.
Do that first — it unblocks both auth email and all outbound mail.

---

## Phase 0 — Foundation: verify the Resend domain (do this first)

Single DNS task that unblocks two Tier-1 blockers at once.

- [ ] **[You]** Resend → Add Domain `support.jointemple.io`; add the DKIM
      / SPF / MX (+ optional DMARC) records at Namecheap; Verify.
      (`docs/auth-email-setup.md` step 1.)

Everything in Phase 1 and Phase 3 depends on this being green.

---

## Phase 1 — Unblock signups + email (Tier 1, the real gating work)

### 1a. Auth email — the #1 blocker
- [ ] **[You]** Point Supabase Auth at Resend SMTP (`smtp.resend.com`,
      sender `noreply@support.jointemple.io`).
- [ ] **[You]** Set **Site URL** → `https://app.jointemple.io`; add
      `https://app.jointemple.io/**` to Redirect URLs. *(This is what
      fixes the broken `otp_expired` links.)*
- [ ] **[You]** Raise auth email rate limit to ~30/hour.
- [ ] **[You]** Confirm Vercel `EXPO_PUBLIC_SUPABASE_URL` / `..._ANON_KEY`
      match the project you're editing.
- [ ] **[Claude]** Draft a Temple-branded confirm-signup email template
      (HTML + subject) for you to paste into the Supabase dashboard.

### 1b. Outbound mail (campaigns, invites, receipts)
- [ ] **[You]** Set `RESEND_API_KEY` + `RESEND_FROM_EMAIL`
      (`updates@support.jointemple.io`) on the edge functions.
- [ ] **[You]** Verify a test campaign shows `delivered`, not `simulated`;
      verify an emailed staff invite arrives.

**Exit:** a brand-new account can sign up, get the confirmation email, and
sign in. Nothing works before this.

---

## Phase 2 — Payments (Tier 1)

Runbook `docs/stripe-setup.md`. Sequence matters: prove it in test mode,
then swap to live.

- [ ] **[You]** Enable Connect on Temple's platform Stripe; register the
      `stripe-connect-callback` redirect URI.
- [ ] **[You]** Set `STRIPE_SECRET_KEY` + `STRIPE_CONNECT_CLIENT_ID`
      (**test** keys) as edge-function secrets.
- [ ] **[You]** Register the `stripe-webhook` endpoint so renewals + store
      orders settle.
- [ ] **[You]** Connect a test gym, run a member checkout + a store order
      end-to-end.
- [ ] **[You]** Swap to **live** keys (blocks real money → this is a
      Milestone B gate, not needed for a demo).

---

## Phase 3 — Legal & compliance (Tier 2, run in parallel from day one)

Independent of the technical phases — start now, because the long pole is
external review, not drafting.

- [ ] **[Claude]** Draft Temple's **Terms of Service** (gym-facing SaaS
      agreement) — starting point for your lawyer, clearly marked not legal
      advice.
- [ ] **[Claude]** Draft the **Privacy Policy**.
- [ ] **[Claude]** Draft a **Data Processing Agreement** (gym = controller,
      Temple = processor).
- [ ] **[Claude]** Draft real **consent-clause copy** for `/consent` to
      replace the placeholders.
- [ ] **[You]** Get all four reviewed/signed off by a solicitor with UK
      GDPR experience; commission the **DPIA** + lawful-basis sign-off for
      the health-data processing.
- [ ] **[You]** Publish ToS/Privacy where gyms can see them before signup.

*(Engineering side of GDPR is already done — consent gate, erasure, audit
log, and the retention purge is scheduled in migration `0095`.)*

---

## Phase 4 — Sales & demo readiness (Tier 3)

### 4a. Demo environment (needed for Milestone A)
- [ ] **[You]** Seed a hosted demo gym (GitHub Action → "Demo gym").
      Decide CrossFit vs Hyrox as the showcase.
- [ ] **[You]** On the demo gym, connect a test-mode Stripe account and
      publish a waiver/PAR-Q by hand (the seeder omits both).
- [ ] **[Claude]** If useful, script/document the exact demo walkthrough
      (login → the 3–4 screens that sell it).

### 4b. Go-to-market (Milestone B, business decisions)
- [ ] **[You]** Decide Temple's **pricing** (monthly per gym; website
      builder add-on price + how you invoice it, since it's flipped by hand).
- [ ] **[You]** Confirm the `jointemple.io` marketing site is live and sells.
- [ ] **[You]** Dry-run a real Mindbody/PushPress/Glofox/Wodify CSV through
      `/management/members/import` so a real export holds no surprises.

---

## Phase 5 — Final smoke test on production (Milestone B gate)

Walk the full new-gym journey yourself, live, before the first outreach.
The seven steps are in `docs/gym-outreach-checklist.md` Tier 5. If all
seven pass, you're ready to pitch.

---

## Optional (any time, never blocking)

- [ ] **[You]** `ANTHROPIC_API_KEY` — sharper importer inference.
- [ ] **[You]** `PEXELS_API_KEY` — website stock photos.

---

## What I can start on now

If you want, I'll take the **[Claude]** items in one pass: draft the ToS /
Privacy / DPA / consent copy (for your lawyer to review) and the branded
confirm-signup email template. Say the word and I'll open them as drafts on
this branch.
