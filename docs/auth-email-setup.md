# Auth email setup — custom SMTP via Resend

Runbook for putting Supabase Auth's transactional emails (confirm
signup, password recovery, magic link, email change) on **custom SMTP
through Resend**, instead of Supabase's built-in test mailer.

## Why

Supabase's built-in mailer is for development only: it caps sends at a
few per hour per address (the "email rate limit exceeded" you hit) and
the links expire fast. Pointing Auth at Resend gives real
deliverability, no artificial throttle, and a Temple-branded sender —
while keeping email confirmation **on**.

We already use Resend for the Communications Suite (`send-campaign`,
`sending-domain`), so this reuses the existing account and API key. No
new vendor.

These dashboard/Resend steps can't be done from the repo — this is the
checklist to run them.

---

## 1. Verify a Temple sending domain in Resend

Auth emails come from **Temple the platform** (the user has no gym yet
when they confirm), so they send from a Temple-owned domain — not a
per-gym sending domain.

1. Resend → **Domains → Add Domain** → `mail.jointemple.io`.
   - A `mail.` subdomain keeps auth/transactional sending reputation
     isolated from the apex `jointemple.io` (marketing site) and from
     per-gym domains.
2. Resend shows the exact DNS records to add (generated — copy them
   verbatim). At **Namecheap → Advanced DNS** for `jointemple.io`, add:
   - the **MX** record (return-path / bounce handling)
   - the **TXT SPF** record
   - the **TXT DKIM** record
   - (optional but recommended) a **DMARC** TXT record
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
| Sender email   | `noreply@mail.jointemple.io`           |
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

## 5. (Optional) Brand the confirm-signup template

**Authentication → Email Templates → Confirm signup** — rewrite the
subject/HTML so it doesn't read as a stock Supabase email. Template
vars: `{{ .ConfirmationURL }}`, `{{ .Token }}`.

This is one global template — Auth runs before the user has a gym, so
it can't be per-gym branded from the dashboard alone. Per-gym branded
auth emails need the **Send Email Hook** (render in an edge function,
send via Resend with the gym brand from `user_metadata`); that's a
larger follow-up, not part of this setup.

---

## Verify

1. Sign up with a fresh address (or use the rate-limited one once it
   resets).
2. Confirm the email arrives **from `Temple <noreply@mail.jointemple.io>`**,
   not `…@mail.app.supabase.io`.
3. Click the link → it lands on `https://app.jointemple.io/sign-in`.
4. Sign in → into the app.
