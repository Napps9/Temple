# Follow-ups

Running list of decisions / tasks to come back to. Append to the bottom;
mark done with `~~strikethrough~~` rather than deleting.

---

## 1. Edit the Supabase email template

Customize the "Confirm signup" auth email so it doesn't look like a
generic Supabase email.

**Where:** Supabase Dashboard → Authentication → Email Templates →
*Confirm signup*. Rewrite HTML/subject; use template variables like
`{{ .ConfirmationURL }}` and `{{ .Token }}`.

**Sender domain:** stays `noreply@mail.app.supabase.io` until custom
SMTP is configured. Supabase Auth → SMTP Settings can point at Resend
(reuse the same Resend account `send-campaign` / `sending-domain`
already use).

**Limitation:** one global template — Supabase Auth runs before the
user has a gym, so it can't be per-gym branded from the dashboard
alone. For per-gym branding the proper fix is the Send Email Hook
path (Path C from chat) — render the email in an edge function and
send via Resend with the gym's brand pulled from `user_metadata`.

---

## 2. Fix Supabase Site URL + Redirect URLs

The confirmation email link redirects to `http://localhost:3000` and
shows `otp_expired`. The localhost part comes from Supabase Auth's
**Site URL** setting — every confirmation link is built off it.

**Where:** Supabase Dashboard → Authentication → URL Configuration.

- **Site URL** — change from `http://localhost:3000` to the deployed
  Vercel URL (e.g. `https://temple.vercel.app` or whatever the live
  domain is). This is what gets baked into every confirmation /
  recovery / magic-link email.
- **Redirect URLs** — add the same production URL plus any preview
  domains you need to test from (Vercel previews, custom domains).
  Anything not on this list is refused as a redirect target.

After saving, request a fresh confirmation email — the existing
expired link can't be re-used (Supabase one-shots them).

**Related:** also check `EXPO_PUBLIC_SUPABASE_URL` / `..._ANON_KEY`
env vars on Vercel match the same Supabase project the dashboard
edits go to. If they point at a different project, Site URL changes
won't reach the running app.

---

## 3. Consent screen needs two taps on "Accept"

Reported: hitting **Accept** on the consent screen the first time
didn't register — had to tap a second time before it took.

Most likely causes to check:
- Submit handler debouncing/state issue — the button might be
  disabled-on-press but re-enable too fast, swallowing the first tap.
- Optimistic state not invalidating `useConsentState` so the root
  index doesn't see the new consent and re-renders /consent.
- The mutation isn't awaited before navigating, so the redirect fires
  before the row is written — second tap wins because the row arrived
  in the meantime.

**Where to look:** `src/app/consent.tsx` (or wherever the consent
screen lives) — the Accept button's `onPress` and the mutation
`onSuccess`. Verify `queryClient.invalidateQueries({ queryKey:
['consent-state'] })` fires before navigation.

