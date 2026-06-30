# Follow-ups

Running list of decisions / tasks to come back to. Append to the bottom;
mark done with `~~strikethrough~~` rather than deleting.

---

## 1. Edit the Supabase email template

> Folded into the full SMTP runbook: **`docs/auth-email-setup.md`**
> (steps 1-3 wire Resend SMTP; step 5 covers the template).

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

> Part of the SMTP runbook: **`docs/auth-email-setup.md`** step 3.
> SMTP without this fix still produces broken links — do them together.

The confirmation email link redirects to `http://localhost:3000` and
shows `otp_expired`. The localhost part comes from Supabase Auth's
**Site URL** setting — every confirmation link is built off it.

**Where:** Supabase Dashboard → Authentication → URL Configuration.

- **Site URL** — change from `http://localhost:3000` to the production
  domain `https://app.jointemple.io` (the custom domain on Vercel). This
  is what gets baked into every confirmation / recovery / magic-link
  email.
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

## ~~3. Consent screen needs two taps on "Accept"~~ (fixed)

Fixed: `onSuccess` now `await`s a `refetchQueries(['member-consent'])`
before `router.replace('/')`, so the index gate sees the fresh
consented row instead of bouncing back and wiping the form. Was the
third hypothesis below (navigate-before-cache-refresh).

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

---

## ~~4. Member import → working membership without re-billing~~ (shipped 0076)

Today the members importer stages rows into `pending_members` with
`plan_name` / `plan_start` / `plan_end` / `credits_remaining` etc., and
on signup the link trigger stamps the imported metadata onto the new
`gym_memberships` row as `imported_*` columns. The booking gate
(`_book_class_for`) still needs a live `plan_subscription` though, so
imported members can't book a class until staff manually create a
subscription for them.

User ask: imported members continue "seamlessly without payment
issues" — they shouldn't have to pay again to keep training.

**Proposed flow:**

1. In the import wizard, after the column-mapping step, show the unique
   `plan_name` values found in the CSV and let the owner map each one
   to an existing `membership_plans` row (or "no plan" for trial
   intros).
2. Store the chosen `membership_plan_id` on `pending_members` (new
   column `linked_membership_plan_id`).
3. Extend the `gym_memberships` insert link trigger: if the linked
   pending row has `linked_membership_plan_id` set, create a
   `plan_subscription` with:
     - `status = 'active'`
     - `credit_balance = imported_credits_remaining` (for credit
       packs / credit periods; null for unlimited)
     - `paid_period_end = imported_plan_end` so the cancel-at-period-
       end semantics still work
     - `stripe_subscription_id = null` — Temple billing is bypassed
       for the imported continuation
4. Surface a "self-serve renewal" path the member can hit when the
   imported plan ends — wire it to the same plan picker the gym uses
   for new joiners.

**Open questions:**

- Should renewals after the imported period flow through Temple's
  Stripe integration once it lands? (Probably yes — but until billing
  is live the imported state needs to last through the migration
  window without forcing the member through Stripe.)
- For credit packs that were partially used pre-import, do we count
  expiry from `plan_start` or `plan_end`? Probably `plan_end` if
  present, otherwise unlimited until manually consumed.
- Mapping UI: chip-per-unique-plan with a Picker, or a small table?
  Chip-per-plan is faster for the common 1-3 plan case.

---

## 5. Track: search / browse the full movement catalog (cross-discipline), incl. tagging

The Track home only shows the gym's discipline catalog — a Hyrox gym
sees the 8 stations + race tiles, a CrossFit gym sees the movement
groups. But the underlying `tracked_*` tables and `findMovement` already
span both catalogs (`ALL_GROUPS = MOVEMENT_GROUPS + HYROX_GROUPS` in
`src/lib/movements.ts`). So an athlete can hold history on any movement
key; they just have no way to *reach* a movement outside their gym's
catalog — neither to view it nor to log against it.

**A movement enters tracking two ways, and both are discipline-gated today:**
1. **Results** — explicit PB rows in `tracked_movement_results`
   (movement + scheme + value), logged via the Record flow.
2. **Tags** — `tracked_section_movement_tags`: after logging a workout
   *section*, the member tags it with one or more movements (optionally a
   rep scheme) so it feeds the per-movement Journal and best-of. The tag
   picker (`MovementTagPickerModal` in `RecordWorkoutModal`) is fed
   `catalogGroups(discipline)` — **same discipline limit as the home
   grid**, so a Hyrox athlete can't tag a back squat onto a section.

`MovementDetailView` already reads **both** tables per movement key and
merges them, so any movement's detail/history/PR view works
cross-discipline today — the gaps are purely *discoverability* (home) and
*the tag picker's catalog* (recorder).

**Goal:** let a tracking user search or browse every available movement —
to view it, to record a result against it, **and to tag a workout section
with it** — without cluttering the focused discipline home.

**Proposed shape (approval pending before build):**
- **One shared search index.** A single `searchMovements(query)` over the
  combined catalog (name + aliases, the same `aliases` the auto-detector
  in `movement-detection.ts` already uses), discipline-agnostic. Both
  surfaces below consume it so there's one search brain, not two.
- **Browse / search on `/track`** — a search field at the top (and/or a
  new `/track/movements` "All movements" screen) filtering the combined
  catalog. Results deep-link to the existing `/track/movement/[key]`
  detail — no new detail surface needed since `findMovement` resolves any
  key.
- **Tag picker encompassed** — give `MovementTagPickerModal` the same
  search field and widen it beyond `catalogGroups(discipline)`: the gym's
  own discipline stays pinned/expanded at the top, with the rest of the
  catalog reachable under an "All movements" section or surfaced directly
  by search. This is the change that lets a section be tagged with any
  movement. The detection auto-tagging stays discipline-scoped (it only
  pre-fills from the *programmed* body); manual search is what unlocks the
  rest.
- **Browse view** groups by category (CrossFit groups + the Hyrox group),
  gym discipline pinned first so the default stays focused; everything
  else under "All movements" / "More".
- Keep the home grid as-is; this is an additive entry point + a wider tag
  picker, not a replacement.

**Open questions:**
- Do we want gym owners to be able to curate/hide movements outside
  their discipline (for both browse *and* the tag picker), or is the full
  catalog always searchable?
- Should a logged cross-discipline PB / tag surface on the home grid
  (e.g. a "recently logged" row), or only via search/journal?
- When tagging a cross-discipline movement, do we record it against the
  member's current `gym_id` as normal (it already does), and should staff
  of a discipline-mismatched gym see it in their members' logs? (Default:
  yes — it's the member's history, RLS already allows self + staff.)
- Naming: "All movements" vs "Movement library" vs a plain search icon.
