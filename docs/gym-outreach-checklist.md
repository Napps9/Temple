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

> **Production reset (2026-07-12):** all users, gyms and billing events
> wiped clean via SQL (`delete from billing_events; delete from gyms;
> delete from auth.users;` — in that order, to clear a check-constraint
> and an FK block). No real accounts existed yet, so nothing was lost.
> The "Dolly Box" test gym used to verify Stripe/auth earlier no longer
> exists — the verification itself still stands, but don't go looking
> for that data. The platform is a genuine blank slate for the demo-gym
> work below.

---

## Tier 1 — hard blockers (a gym cannot function without these)

### [x] 1. Fix auth email so signups actually complete — verified end-to-end

Runbook: `docs/auth-email-setup.md`. Concretely:
- [x] Resend sending domain verified (`jointemple.io`, apex)
- [x] Supabase Auth pointed at Resend SMTP, sender `noreply@jointemple.io`
- [x] **Site URL is `https://app.jointemple.io`**, Redirect URLs include
      `https://app.jointemple.io/**`
- [x] Auth email rate limit at 30/hour (fine at this scale)
- [x] Vercel's `EXPO_PUBLIC_SUPABASE_URL` confirmed pointing at the same
      project (matches `app.jointemple.io` in Vercel's domains)
- [x] **Real test:** signed up with a fresh address, received the
      confirmation email from `Temple <noreply@jointemple.io>` within
      seconds, clicked through, landed signed in on `app.jointemple.io`.
- [ ] (optional, not done) Brand the confirm-signup template beyond the
      default — cosmetic, not blocking.

### [x] 2. Turn on Stripe (payments) — verified end-to-end

Runbook: `docs/stripe-setup.md`.
- [x] Set `STRIPE_SECRET_KEY` + `STRIPE_CONNECT_CLIENT_ID` as Supabase
      edge-function secrets (in hosted)
- [x] `STRIPE_WEBHOOK_SECRET` set — webhook wired so renewals + store
      orders settle (`stripe-webhook`)
- [x] Connect confirmed enabled, with the `stripe-connect-callback`
      redirect URI correctly registered.
- [x] Ran a real Connect onboarding (gym "Dolly Box") through the live
      app, then a real member checkout (£10/mo unlimited plan, test
      card) — membership went **ACTIVE**, payment history shows
      **PAID**, webhook fired correctly. Whole flow proven working with
      the secrets currently live in production — no config was changed.
- [x] Business-verification review cleared — Stripe emailed confirmation
      (2026-07-15) that "Temple Software LTD is approved to create live
      accounts and charges."
- [x] Swapped to live (2026-07-15): `STRIPE_SECRET_KEY`,
      `STRIPE_CONNECT_CLIENT_ID` (`ca_UjVXQbUmKQECK3kEvinEJ0Gz5oeFr4PU`),
      and `STRIPE_WEBHOOK_SECRET` all updated to live values in Supabase.
      Live-mode redirect URI confirmed already registered (shared across
      test/live in Stripe's Connect OAuth settings). Also turned on
      **"OAuth for Stripe Dashboard accounts"** in Connect → Settings →
      OAuth, which was off — without it a gym could only create a brand
      new Stripe account through Connect, not sign in with an existing
      one, contradicting the documented "signs in / creates an account"
      flow in `docs/stripe-setup.md`. Confirmed live OAuth actually works
      — the account picker showed real existing Stripe accounts to sign
      in with, proving the toggle took effect.
- [x] (cleanup) Webhook destinations tidied (2026-07-16).
      `brilliant-harmony-thin` (Thin payload — `stripe-webhook`'s signature
      check only understands the classic `t=…,v1=…` Snapshot scheme, so it
      could never verify) deleted. `brilliant-harmony-snapshot` confirmed
      the live destination: Active, URL `…/functions/v1/stripe-webhook`,
      **Events from: Connected accounts**, API version `2026-05-27.dahlia`
      (the version the function is written against), 18/18 deliveries
      succeeded with **0 failed** — which itself proves
      `STRIPE_WEBHOOK_SECRET` in Supabase matches this endpoint's signing
      secret (a mismatch returns 400 before any handling).
- [x] **Live-key end-to-end proven (2026-07-16).** The previously deferred
      real-money test is done. A live sole-trader account
      (`acct_1TtnxkRHw1LVxbDD`) was connected to Good Life Crossfit — the
      billing card reached the genuine `ready` state (health check reports
      reachable **and** charges-enabled; a live platform key can't even
      reach a test account, so this confirms a real live account). A real
      member then checked out a £1 credit pack with a **real card** — the
      card was debited £1.00 (statement descriptor "CROSSFIT GOOD LIFE")
      and the membership went **ACTIVE** with the credit granted. Confirmed
      in `billing_events`: a `stripe`/`checkout`/`100`/`GBP` row at
      14:47:27 UTC — that row is written only by the
      `checkout.session.completed` handler *after* the signature verifies,
      so it proves the webhook delivered, verified and returned 200, and
      `billing_live` is now on for the gym. Gyms can be told Stripe is
      ready.
    - Housekeeping: the £1 test charge was **left un-refunded by choice** —
      it sits in the gym's own standalone sole-trader Stripe balance (a
      separate login from the Temple platform account), so it's the owner's
      own money, not lost, and refunding blocks nothing. Optionally clear
      the test membership row from Good Life if keeping it pristine for
      demos.

### [ ] 3. Turn on Resend (all outbound email)

Until `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set, campaigns,
staff/member **invite emails**, and store **receipts** all silently
simulate or degrade to "code created, not emailed." Runbook:
`docs/resend-setup.md`.
- [x] Set `RESEND_API_KEY` + `RESEND_FROM_EMAIL` on the edge functions
      (in hosted)
- [x] Confirm `RESEND_FROM_EMAIL` uses a **verified** sending domain in
      Resend — already true: Comms/invites reuse the same account +
      domain (`jointemple.io`) verified for Auth SMTP in Tier 1 item 1,
      per `docs/resend-setup.md`'s note that the two share one domain.
- [ ] Verify a real campaign send shows `delivered`, not `simulated`
- [ ] Verify an emailed staff invite actually arrives

> Note: items 1 and 3 share the same Resend account + verified domain, so
> do the domain verification once and both benefit.

### [x] 4. Set up company email mailboxes on the domain — done

Google Workspace (Business Starter) set up on `jointemple.io`: domain
verified, MX activated, SPF-safe DKIM added (Google's own selector, no
conflict with Resend's), no conflicts with the existing Resend
sending records.
- [x] `nick@jointemple.io` — real mailbox, Workspace admin
- [x] `support@jointemple.io` — alias on `nick@`
- [x] **`privacy@jointemple.io`** — alias on `nick@`; monitored, the
      Privacy Policy/Terms/DPA all direct data-subject and GDPR
      requests here
- [x] **`security@jointemple.io`** — alias on `nick@`; monitored,
      breach-response inbox (`docs/legal/breach-response.md`) and
      where the security monitor's alerts should land
- [x] `noreply@` / sending addresses — already covered by the existing
      Resend setup (send-only, no mailbox needed)

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
- [x] **Create + monitor the contact inboxes** the legal docs reference
      (`privacy@`, `security@`) — done, see Tier 1 item 4. Real addresses
      already match what's in the docs (`privacy@jointemple.io`,
      `security@jointemple.io`) — no doc changes needed.
- [ ] **(deprioritized) Make breach alerts actually email** — not blocking:
      detection already works and records to `security_alerts` every 15 min
      regardless (`select * from security_alerts order by created_at desc;`
      in the SQL editor), and a failed notify never breaks anything —
      `pg_net` is fire-and-forget, so it can't throw. Live email needs the
      Vault secret (`security_alert_secret`) and the `security-alert`
      function's `SECURITY_ALERT_SECRET` set to the *same* real random
      value — currently mismatched (the Vault one was accidentally set to
      literal placeholder text), so the notify silently no-ops. Revisit
      when convenient; see `docs/legal/breach-response.md`.
- [x] **(per gym, optional) Under-18 members** — not a platform decision;
      `allow_minors` is a self-serve per-gym toggle (off by default) each
      gym owner sets in their own settings. Nothing for you to decide here.

---

## Tier 3 — sales & demo readiness

- [x] **Stand up hosted demo gyms** — both seeded (production was reset
      clean first, see the note above).
  - [x] **Good Life Crossfit** — slug `demo-good-life`, owner
        `owner@demo-good-life.temple.test` / `TempleDemo1!`. 43 accounts,
        850 bookings, 352 tracked workouts, published website.
  - [x] **Redline Hyrox** — slug `demo-redline-hyrox`, owner
        `owner@demo-redline-hyrox.temple.test` / `TempleDemo1!`. 43
        accounts, 713 bookings, 6 Hyrox races/144 splits, 4 store
        products. Seeded gym display name came through lowercase
        ("redline hyrox") — rename to "Redline Hyrox" via Manage →
        Settings before demoing.
  - [x] **Good Life Crossfit** seeder gaps filled: Stripe connected
        (test mode, `acct_1TsP4bRMTyih4ZgW`), a waiver uploaded +
        signed, a member invited and signed up. Worth a quick recheck
        that the waiver signature actually stuck — a fix landed on
        `main` right around this ("wait for gate refetch before
        navigating, so first sign sticks") that this test may have
        hit.
  - [x] **Good Life Crossfit plan purchase verified end-to-end** —
        created/edited the "8 Classes / Month" plan (`credit_period`
        kind — the exact path a bug in the Plans screen's UPDATE query
        broke, missing `period_length` and throwing
        `membership_plans_check`) and completed a real member
        checkout: Stripe payment received, membership shows
        **ACTIVE**, 8 credits, correct renewal date. Confirms both the
        Plans fix (commit `fb96319`, CI green) and Good Life
        Crossfit's Stripe Connect checkout flow work live, not just in
        tests.
  - [ ] **Redline Hyrox** still needs the same: connect Stripe (test
        mode) + publish a waiver/PAR-Q.
- [x] **Decide Temple's pricing** — **£200/month, all-inclusive**,
      matching what the marketing site's stat strip and pricing page
      already commit to. The website builder add-on
      (`website_builder_enabled`, flipped manually by you after an
      invoice — no self-serve billing for it) is **included**, not
      priced separately.
- [x] **Marketing/landing site** — done, live at `jointemple.io` (apex,
      canonical; `www` 308-redirects to it, SSL valid). Repo
      `napps9/temple-website`, trunk (`main`) auto-deploys to Vercel.
      Built from real research (25 owner/member conversations, an
      11-platform competitor pricing study): home, `/features` + 7
      deep-dive pages, `/switching`, `/pricing` (verified competitor
      rates, monthly auto-refresh + email), `/about`, `/for-members`,
      `/book-a-demo`, theme-aware light/dark design, full SEO/OG/sitemap.
      `app.jointemple.io` remains the product app. DNS confirmed not to
      have disturbed the Google Workspace / Resend email records set up
      earlier this session.
  - [x] Legal footer links + DRAFT-banner placeholders — already resolved
        earlier this session (registered office, effective date filled,
        banners dropped); no action needed despite what the site's own
        wrap-up note said.
  - [x] **Demo inbox** — decided: `nick@jointemple.io` is the
        `book-a-demo` mailto target, footer uses `support@`; no separate
        `demo@` alias. Confirm the `nick@` mailbox is actually watched
        daily (process, not config — nothing left to build).
  - [x] **Google Search Console** — verified, sitemap submitted.
  - [x] **Analytics** — Vercel Web Analytics wired in, cookieless (no
        consent-banner obligation triggered).
  - [x] ~~Refresh the WhatsApp/OG share-card cache~~ — decided not
        needed.
  - [x] **Phone QA pass** — done, happy with mobile.
  - [x] **Fact-check the About page** — done.
  - [x] ~~Named testimonials~~ — decided against; staying anonymised
        (real 2025 CrossFit Stags & Does survey quotes, no names).
  - [x] Housekeeping: stale `claude/temple-marketing-website-o231ss`
        branch deleted.
  - Backlog, not urgent: a "For your members" page, real app screenshots
    replacing the CSS mockups (demo-gym seeder would help here), a
    launch post/case study.
- [ ] **Dry-run a real migration.** Importers exist for Mindbody /
      PushPress / Glofox / Wodify / spreadsheet (members, Stripe subs, and
      workout history). Run a realistic CSV through
      `/management/members/import` end-to-end so the first onboarding call
      isn't the first time you've seen a real export.
    - Hardened ahead of the dry-run (2026-07-16) after probing the pure
      import helpers with real-export shapes: the CSV parser now sniffs the
      delimiter (comma / **semicolon** — EU-UK Excel's default — / tab)
      instead of collapsing a non-comma file into one column;
      `toIsoDate` accepts slash/dot ISO, spelled-out months and Excel
      serials on top of the existing formats; surname-first "Smith, John"
      names are stored natural-order and match the cross-email dedup. All
      covered by unit tests. Still worth running one **real** gym export
      through the live app — the value of this item is seeing genuine
      messiness (encoding, stray columns, plan-name chaos), not the code
      paths, which are now tested.

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
