# Temple-branded Supabase Auth emails

Supabase Auth sends its own emails (confirm signup, change email, reset
password, magic link, reauthentication) — these bypass our edge-function
layout (`supabase/functions/_shared/email-layout.ts`), so they must be
configured **in the Supabase dashboard**. This folder holds the branded
HTML to paste in, matching the transactional (invite/receipt) emails.

All templates reference the hosted lockup at
`https://app.jointemple.io/email/temple-lockup.png` (served from
`public/email/`), the same one the edge-function emails use.

---

## Step 1 — Send auth email from jointemple.io (custom SMTP)

By default Supabase sends auth email from its own shared address with
poor deliverability. Point it at Resend so it comes from your verified
`jointemple.io`.

Supabase Dashboard → **Authentication** (left icon rail) → **Emails** →
**SMTP Settings** tab (this lives under Authentication, *not* Project
Settings):

- Enable custom SMTP: **on**
- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: your **Resend API key** (the same value as the
  `RESEND_API_KEY` secret)
- Sender email: `noreply@jointemple.io`
- Sender name: `Temple`

Save, then use **Send test email** to confirm it arrives from
`noreply@jointemple.io`.

> After enabling custom SMTP you can also raise the auth email rate limit
> under **Authentication → Rate Limits** (the built-in sender is throttled
> to a handful per hour).

## Step 2 — Paste the templates

Supabase Dashboard → **Authentication → Emails → Templates** tab. For each
type, set the Subject and paste the matching file into **Message body
(HTML)**:

| Template | File | Suggested subject |
|----------|------|-------------------|
| Confirm signup | `confirm-signup.html` | Confirm your email address |
| Change Email Address | `change-email.html` | Confirm your new email address |
| Reset Password | `reset-password.html` | Reset your Temple password |
| Magic Link | `magic-link.html` | Your Temple sign-in link |
| Reauthentication | `reauthentication.html` | Your Temple verification code |

The `{{ .ConfirmationURL }}`, `{{ .NewEmail }}` and `{{ .Token }}`
placeholders are Supabase's own variables — leave them exactly as written.

## Step 3 — Check redirect URLs

Supabase → **Authentication → URL Configuration** (same section): make sure **Site URL**
and **Redirect URLs** include `https://app.jointemple.io` so the
`{{ .ConfirmationURL }}` links resolve to the app.

## Step 4 — Test

- Sign up a throwaway account → the **Confirm your email address** email
  should arrive from `noreply@jointemple.io`, Temple-branded.
- Change your email in Account → the **Change email** email should arrive.
- From `/sign-in`, tap **Forgot password?** → the **Reset your Temple
  password** email should arrive; clicking it should land on
  `/reset-password` with a form to set a new password (not bounce you
  into the app if you're already a member — see the note in
  `src/app/(auth)/_layout.tsx`).

---

## Notes

- These are the *company* (Temple) templates. Gym campaign emails are a
  separate system (the gym's own domain + the in-app builder).
- The active flows today are **confirm signup**, **change email**, and
  **reset password** (`/forgot-password` requests the email via
  `resetPasswordForEmail`; `/reset-password` is where the emailed link
  lands and sets the new password). Magic-link is still unused — its
  template is included for whenever that flow gets built.
- Keep these files in sync with `email-layout.ts` if the brand chrome
  changes.
