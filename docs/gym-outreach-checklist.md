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

> This is the one Tier 1 item the edge-function **Secrets** page does not
> cover — Site URL + SMTP live under **Authentication → settings**, not
> Edge Functions → Secrets. Keys being set is not the same as auth email
> working; this remains the top blocker until the Site URL is fixed.

### [ ] 2. Turn on Stripe (payments)

Without this, gyms can't connect their Stripe or charge members —
memberships, store, and the whole billing story are dead. Runbook:
`docs/stripe-setup.md`.
- [x] Set `STRIPE_SECRET_KEY` + `STRIPE_CONNECT_CLIENT_ID` as Supabase
      edge-function secrets (in hosted)
- [x] `STRIPE_WEBHOOK_SECRET` set — webhook wired so renewals + store
      orders settle (`stripe-webhook`)
- [ ] Confirm Connect is enabled on Temple's platform account and the
      `stripe-connect-callback` redirect URI is registered (the
      `CLIENT_ID` implies Connect is on — just verify the redirect)
- [ ] Confirm whether these are **test** or **live** keys — do a test-mode
      end-to-end before swapping to live and taking real money
- [ ] Run one real Connect onboarding + a member checkout to confirm the
      whole flow settles

### [ ] 3. Turn on Resend (all outbound email)

Until `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set, campaigns,
staff/member **invite emails**, and store **receipts** all silently
simulate or degrade to "code created, not emailed." Runbook:
`docs/resend-setup.md`.
- [x] Set `RESEND_API_KEY` + `RESEND_FROM_EMAIL` on the edge functions
      (in hosted)
- [ ] Confirm `RESEND_FROM_EMAIL` uses a **verified** sending domain in
      Resend (e.g. `updates@support.jointemple.io`)
- [ ] Verify a real campaign send shows `delivered`, not `simulated`
- [ ] Verify an emailed staff invite actually arrives

> Note: items 1 and 3 share the same Resend account + verified domain, so
> do the domain verification once and both benefit.

### [ ] 4. Set up company email mailboxes on the domain

Items 1 and 3 verify the domain for **sending**; you still need real
**receiving** mailboxes for humans and for the role addresses the app and
legal docs already point at. Set these up (Google Workspace / Fastmail /
etc.) on the company domain:
- [ ] Founder / staff mailboxes — e.g. `nick@jointemple.io`
- [ ] `support@jointemple.io` — member/gym support (already the Resend
      sending subdomain)
- [ ] **`privacy@jointemple.io`** — monitored; the Privacy Policy, Terms
      and DPA all direct data-subject and GDPR requests here
- [ ] **`security@jointemple.io`** — monitored; breach-response inbox
      (`docs/legal/breach-response.md`) and where the security monitor's
      alerts should land
- [ ] `noreply@` / `updates@` — transactional + campaign senders

> Domain check: every existing doc and the app use **`jointemple.io`**
> (`app.jointemple.io`, `support.jointemple.io`, `privacy@jointemple.io`).
> You wrote `jointemple.com` — decide which domain the mailboxes live on
> and make it consistent across the legal docs before publishing. If you
> switch to `.com`, update `docs/legal/` and the checklist to match.

---

## Tier 2 — legal & compliance (before real member health data flows)

Members submit PAR-Q and injury data — special-category health data
under GDPR Article 9. Most of this shipped this session and is live
(drafts in `docs/legal/`, surfaced in-app); both retention purges run on
pg_cron. What remains is **your sign-off and filling placeholders, not
code**.

Shipped:
- [x] **Terms of Service, Privacy Policy, DPA** — drafted (`docs/legal/`),
      live in-app at `/terms` + `/privacy`, sign-up consent notice wired.
- [x] **Real consent-text copy** on `/consent` — clauses aligned to the
      privacy policy + DPA (`src/lib/consent.ts`), no longer placeholder.
- [x] **DPIA + lawful-basis register** — drafted (`docs/legal/dpia.md`,
      `lawful-basis-register.md`).
- [x] **Cookie banner** — web analytics-consent banner shipped ahead of
      the product tracking to come.
- [x] **Breach detection + response** — security monitor (pg_cron, every
      15 min, records to `security_alerts`) + runbook
      `docs/legal/breach-response.md`.
- [x] **Retention purges scheduled** — health data (`0095`) and the
      6-year waiver-signature purge (`0108`/`0109`) both on pg_cron.

Left for you (policy/config, not code):
- [x] **Sign off the DPIA + lawful-basis register** — signed off
      2026-07-10 (director); two tracked residual actions remain (breach-alert
      email A1, transfer mechanisms A2), review 2027-07-10.
- [x] **Fill the legal-doc placeholders and drop the DRAFT banner** —
      registered office (49 Deeside Road, London SW17 0PH), effective date
      (10 Jul 2026), `privacy@` contact, DPA Annex B, the 30-day
      change-notice + deletion window, and Annex C measures all filled;
      DRAFT banners dropped in `docs/legal/` and the in-app `/terms` +
      `/privacy` screens. **These docs have not been reviewed by a
      solicitor** — you chose to publish without one; get a one-off review
      of the ToS + DPA when you can afford it.
- [ ] **Create + monitor the contact inboxes** the legal docs reference
      (`privacy@`, `security@`) — see Tier 1 item 4 — then confirm the
      real addresses in the docs.
- [ ] **Make breach alerts actually email** — set the `security-alert`
      function's shared secret + the monitor's GUCs in hosted; until then
      alerts record silently in `security_alerts`.
- [ ] **(per gym, optional) Under-18 members** — decide whether to enable
      `allow_minors` (off by default); it captures DoB + guardian details.

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

- [x] `ANTHROPIC_API_KEY` — set in hosted. AI-assisted column mapping +
      plan/tag inference in the member importer (falls back to
      deterministic rules if ever unset).
- [x] `PEXELS_API_KEY` — set in hosted. Stock-photo search + website
      hero/gallery auto-population (falls back to upload-only / photo-less
      if ever unset); `docs/pexels-photos-setup.md`

---

## Tier 5 — final end-to-end smoke test on production

Before the first outreach, walk the **whole new-gym journey** on the live
site yourself, exactly as a prospect would:

- [ ] Confirm `/terms` + `/privacy` render and the sign-up consent notice
      shows before you go live
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
