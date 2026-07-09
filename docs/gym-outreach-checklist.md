# Gym-outreach readiness checklist

What has to be true before you start pitching Temple to real gyms.

The product itself is feature-complete (see `docs/feature-inventory.md`).
Almost everything below is **account / secrets / legal / go-to-market**
configuration that can't live in the repo — the code paths are built and
correct, they just need to be switched on in the hosted environment, or
they're business decisions only you can make.

Ordered by "can a gym actually use this without it." Tier 1 is
non-negotiable; a new gym literally cannot onboard, get paid, or send
mail until these are done.

---

## Tier 1 — hard blockers (a gym cannot function without these)

### [ ] 1. Fix auth email so signups actually complete

**This is the single most important item.** Today Supabase Auth's
**Site URL** is still `http://localhost:3000`, so every confirmation
link points at localhost and shows `otp_expired`. That means **no new
member or owner can confirm their email and get into the app** — it
breaks the very first step of every signup.

Runbook: `docs/auth-email-setup.md`. Concretely:
- [ ] Verify a Temple sending domain in Resend (`support.jointemple.io`)
- [ ] Point Supabase Auth at Resend SMTP (`smtp.resend.com`, sender
      `noreply@support.jointemple.io`)
- [ ] **Set Site URL to `https://app.jointemple.io`** and add
      `https://app.jointemple.io/**` to Redirect URLs
- [ ] Raise the auth email rate limit off the dev default (~30/hour)
- [ ] (optional) Brand the confirm-signup template
- [ ] Confirm `EXPO_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` on Vercel point
      at the same project you're editing

### [ ] 2. Turn on Stripe (payments)

Without this, gyms can't connect their Stripe or charge members —
memberships, store, and the whole billing story are dead. Runbook:
`docs/stripe-setup.md`.
- [ ] Enable Connect on Temple's platform Stripe account; register the
      `stripe-connect-callback` redirect URI
- [ ] Set `STRIPE_SECRET_KEY` + `STRIPE_CONNECT_CLIENT_ID` as Supabase
      edge-function secrets
- [ ] Do it in **test mode** first, then swap to live keys before taking
      real money
- [ ] Decide the Stripe webhook is registered/live so renewals + store
      orders settle (`stripe-webhook`)

### [ ] 3. Turn on Resend (all outbound email)

Until `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set, campaigns,
staff/member **invite emails**, and store **receipts** all silently
simulate or degrade to "code created, not emailed." Runbook:
`docs/resend-setup.md`.
- [ ] Set `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (e.g.
      `updates@support.jointemple.io`) on the edge functions
- [ ] Verify a real campaign send shows `delivered`, not `simulated`
- [ ] Verify an emailed staff invite actually arrives

> Note: items 1 and 3 share the same Resend account + verified domain, so
> do the domain verification once and both benefit.

---

## Tier 2 — legal & compliance (before real member health data flows)

Members submit PAR-Q and injury data — special-category health data
under GDPR Article 9. The engineering surround is done (consent gate,
erasure on leave, audit log, and the retention purge is now scheduled via
pg_cron in migration `0095`). What's left is **policy/legal, not code**:

- [ ] Formal lawful-basis sign-off + a DPIA for the health-data
      processing (needs legal/DPO input)
- [ ] Real consent-text legal copy for the `/consent` screen (currently
      placeholder clauses)
- [ ] **Temple's own Terms of Service + Privacy Policy** — none exist in
      the repo yet. You're selling SaaS to businesses; you need the
      gym-facing agreement.
- [ ] **Data Processing Agreement (DPA)** — each gym is the data
      controller, Temple is the processor. Standard for any B2B SaaS
      touching member PII/health data.

---

## Tier 3 — sales & demo readiness

- [ ] **Stand up a hosted demo gym** for sales calls. The seeder exists
      (`docs/demo-gym.md`, GitHub Action → "Demo gym" → seed). Decide
      CrossFit vs Hyrox as your showcase.
  - [ ] Known seeder gaps to fill by hand before a demo: it seeds **no
        Stripe objects** (connect a test-mode account so checkout demos)
        and **no waiver/PAR-Q** (publish one in-app so the booking gate
        is visible).
- [ ] **Decide Temple's pricing** — what you charge gyms per month, and
      whether the website builder add-on (`website_builder_enabled`, flipped
      manually by you after an invoice — there's no self-serve billing for
      it) has a price + a way to invoice it.
- [ ] **Marketing/landing site** — confirm `jointemple.io` (apex) is live
      and sells the product; `app.jointemple.io` is the app.
- [ ] **Dry-run a real migration.** Importers exist for Mindbody /
      PushPress / Glofox / Wodify / spreadsheet (members, Stripe subs, and
      workout history). Run a realistic CSV through
      `/management/members/import` end-to-end so the first onboarding call
      isn't the first time you've seen a real export.

---

## Tier 4 — optional keys (degrade gracefully, do if convenient)

These improve the experience but never block anything — every path falls
back cleanly if the key is unset.

- [ ] `ANTHROPIC_API_KEY` — AI-assisted column mapping + plan/tag
      inference in the member importer (falls back to deterministic rules)
- [ ] `PEXELS_API_KEY` — stock-photo search + website hero/gallery
      auto-population (falls back to upload-only / photo-less);
      `docs/pexels-photos-setup.md`

---

## Tier 5 — final end-to-end smoke test on production

Before the first outreach, walk the **whole new-gym journey** on the live
site yourself, exactly as a prospect would:

- [ ] Sign up → **receive and click the confirmation email** → land in-app
- [ ] Create a gym → complete the setup checklist (logo, settings, class
      type, schedule, health screening, plan)
- [ ] Connect Stripe (test mode) → create a paid plan
- [ ] Publish a waiver or PAR-Q → confirm the booking gate fires
- [ ] Invite a member by email → **the invite email arrives**
- [ ] As that member: confirm email → subscribe/pay → book a class →
      log a workout
- [ ] Send a test campaign → confirm it delivers (not simulated)

If all seven pass, a gym you pitch can actually run their gym on it.
