# Auth email setup — custom SMTP via Resend

Runbook for Supabase Auth's transactional emails (confirm signup,
invite, magic link, email change, password recovery, reauthentication):
send them on **custom SMTP through Resend** instead of Supabase's
built-in test mailer, and dress them in the Temple-branded templates.

The branded HTML lives in `supabase/templates/*.html` — the single
source of truth, deliberately with no second copy anywhere else — wired
for local dev in `supabase/config.toml` under `[auth.email.template.*]`.
CI deploys migrations + edge functions but does **not** push auth
config, so the dashboard steps below are done by hand and re-done only
when a template changes. Design rationale: `docs/email-branding.md`.

## Why custom SMTP

Supabase's built-in mailer is for development only: it caps sends at a
few per hour per address (the "email rate limit exceeded" you hit) and
the links expire fast. Pointing Auth at Resend gives real
deliverability, no artificial throttle, and a Temple-branded sender —
while keeping email confirmation **on**.

We already use Resend for the Communications Suite (`send-campaign`,
`sending-domain`), so this reuses the existing account and API key. No
new vendor.

---

## 1. Verify a Temple sending domain in Resend

Auth emails come from **Temple the platform** (the user has no gym yet
when they confirm), so they send from a Temple-owned domain — not a
per-gym sending domain.

1. Resend → **Domains → Add Domain** → `support.jointemple.io`.
   - A dedicated subdomain keeps auth/transactional sending reputation
     isolated from the apex `jointemple.io` (marketing site) and from
     per-gym domains.
2. At **Namecheap → Advanced DNS** for `jointemple.io`, add the records
   Resend generates (copy each value with its copy button — don't
   hand-type the DKIM key). Enter Hosts *without* the `.jointemple.io`
   suffix — Namecheap appends it:

   - **DKIM** — TXT, host `resend._domainkey.support`
   - **SPF** — TXT, host `send.support` (`v=spf1 include:amazonses.com ~all`)
   - **MX** — host `send.support`, priority 10, the `feedback-smtp…amazonses.com`
     value. Namecheap keeps MX under **Mail Settings → Custom MX**, not
     the Host Records table; switching to Custom MX replaces default mail
     handling, so re-add any existing `@jointemple.io` MX too.
   - (optional) **DMARC** — TXT, host `_dmarc`, `v=DMARC1; p=none;`
3. Back in Resend, **Verify**. Propagation is usually minutes.

If a Temple-level domain is already verified in Resend (check what
`RESEND_FROM_EMAIL` points at), reuse it and skip this step.

---

## 2. Point Supabase Auth at Resend SMTP

Supabase Dashboard → **Authentication → Emails → SMTP Settings** →
enable **Custom SMTP**:

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| Host           | `smtp.resend.com`                      |
| Port           | `465`                                  |
| Username       | `resend`                               |
| Password       | your Resend API key (`re_…`)           |
| Sender email   | `noreply@support.jointemple.io`        |
| Sender name    | `Temple`                               |

The API key is the same value as the `RESEND_API_KEY` edge-function
secret — Auth SMTP is configured separately in the dashboard and does
not read edge secrets, so paste it here too. The sender email **must**
be on the domain verified in step 1 or sends bounce.

---

## 3. Fix Site URL + Redirect URLs

The confirmation link is built from Auth's **Site URL** — leaving it on
`localhost` is what produced the broken `otp_expired` links.

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL** → `https://app.jointemple.io`
- **Redirect URLs** → add `https://app.jointemple.io/**` (covers
  `/sign-in`, where the app routes confirmations via
  `confirmRedirectTo()` in `src/lib/auth.ts`). Add any Vercel preview
  domains you test from too — anything not listed is refused.

Sanity check: `EXPO_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` on Vercel
must point at the same Supabase project you're editing here, or these
changes won't reach the running app.

---

## 4. Raise the auth email rate limit

With the built-in mailer gone, lift the low default so testing doesn't
re-trip it: **Authentication → Rate Limits → "Rate limit for sending
emails"** → raise to a sane value (e.g. 30/hour).

---

## 5. Paste the templates

Supabase Dashboard → **Authentication → Emails → Templates** tab. For
each type, set the Subject and paste the matching file from
`supabase/templates/` into **Message body (HTML)**. Subjects are the
ones in `supabase/config.toml`:

| Dashboard template | File | Subject |
|--------------------|------|---------|
| Confirm sign up | `confirmation.html` | Confirm your email — Temple |
| Invite user | `invite.html` | You're invited to Temple |
| Magic link or OTP | `magic_link.html` | Your Temple sign-in link |
| Change email address | `email_change.html` | Confirm your new email — Temple |
| Reset password | `recovery.html` | Reset your Temple password |
| Reauthentication | `reauthentication.html` | Your Temple verification code |

The `{{ .ConfirmationURL }}` and `{{ .Token }}` placeholders are
Supabase's own variables — leave them exactly as written. All templates
reference the hosted lockup at
`https://app.jointemple.io/email/temple-lockup.png` (served from
`public/email/`, regenerated by `scripts/brand/build-marks.mjs`), the
same one the edge-function emails use.

These are one global set — Auth runs before the user has a gym, so they
can't be per-gym branded from the dashboard alone. Per-gym branded auth
emails would need the **Send Email Hook** (render in an edge function,
send via Resend with the gym brand from `user_metadata`); that's a
larger follow-up, not part of this setup.

---

## Verify

1. Sign up with a fresh address (or use the rate-limited one once it
   resets).
2. Confirm the email arrives **from `Temple <noreply@support.jointemple.io>`**,
   not `…@mail.app.supabase.io`, wearing the Temple template.
3. Click the link → it lands on `https://app.jointemple.io/sign-in`.
4. Sign in → into the app.
5. Password reset from `/sign-in` → **Forgot password?** lands on
   `/reset-password` with a form to set a new one (see the note in
   `src/app/(auth)/_layout.tsx`).

---

## Notes

- Gym **member/staff invites are not auth emails** — they're minted as
  `invite_codes` and sent already-branded by the `send-invite` edge
  function via Resend. Nothing to configure here.
- Flows the app triggers today: confirm signup, change email, reset
  password, and magic link (the "send a fresh link" button on
  `/join/[slug]`). **Invite user** and **reauthentication** have no
  in-app trigger — they're branded so an invite sent from the
  dashboard's Users page, or a future secure-password-change flow,
  still looks like Temple.
- Keep the HTML in sync with `email-layout.ts` if the brand chrome
  changes.
