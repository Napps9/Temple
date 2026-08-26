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

## ~~5. Track: search / browse the full movement catalog (cross-discipline), incl. tagging~~ (shipped)

> Shipped: Movement Library (`/track/movements`) with name+alias search,
> discipline-first browse, per-member starred favourites
> (`tracked_movement_favourites`, migration 0091), and a widened +
> searchable tag picker. Decisions taken: full catalog always searchable
> (no owner curation); reach via Journal / Search / Starred (no
> recently-logged home row); named "Movement Library". Original plan
> retained below for context.

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

---

## 6. Full native white-labeling (per-gym App Store apps) — assessed, holding off

Competitive gap: Glofox pitches "your logo on the App Store"; PushPress,
Zen Planner and Wodify sell it as a $39-97/mo add-on. Temple's native
iOS/Android binary stays Temple-branded for every gym today — only the
web/PWA install is per-gym (runtime manifest/icon swap from
`useGymBrand()`, see `docs/feature-inventory.md`). Assessed feasibility
2 July 2026; decision is to hold off, not build.

**It's technically buildable.** Expo/EAS supports exactly this pattern:
build profiles keyed on a per-tenant variable, each producing its own
bundle ID / icon / name / splash screen, with `eas build --auto-submit`
handling the store upload once a listing exists. Proven at 100+-app
scale by other teams on the same stack Temple uses.

**The real blocker is Apple policy, and it got harder in 2026, not
easier.** App Store Review Guideline 4.2.6: "Apps built from templates
must be submitted by the content owner." Apple's automated review
specifically flags one developer account publishing many near-identical
template apps as reseller spam, and Apple tightened enforcement on this
exact pattern on 8 June 2026. Two operating models, both with real cost:

- **Each gym enrolls its own Apple Developer account** ($99/yr, gym
  owner submits as "content owner") — the compliant path at scale, but
  adds real friction (developer enrollment + their own app review wait)
  to the exact experience meant to feel effortless.
- **Temple submits every gym under one developer account** — cheapest
  and most centralized, but is now the specific pattern Apple's 2026
  policy update targets; likely fine at a handful of gyms, real rejection
  risk at 50+.

**Structural constraint, not just a policy one:** a native app's OS-level
icon is 1:1 with its installed bundle. Someone active at more than one
differently-branded gym (an owner who's also a member elsewhere, a coach
working two locations) would need one native install per gym — there's
no way for a single installed binary to show Gym A's icon in one context
and Gym B's in another. The existing PWA reskin doesn't have this problem
(same install, re-skins live per active gym), which is why it's the
lower-risk near-term answer to the same competitive pressure.

**Resolved on the "two apps" worry:** confirmed the concern was staff
needing a separate generic Temple app alongside their own gym's branded
app for admin work — not a blocker, since white-labeling would rebuild
the *same* codebase (same role-gated UI serving both staff and member
views from one binary) under a different bundle ID/icon, exactly like
today. The multi-gym-person edge case above is a known, unresolved
constraint worth remembering if this gets picked up later, not something
that's been designed around yet.

**Revisit when:** a real sales conversation surfaces this as a blocker
(per Plan Three's original discovery-spike recommendation), and the
business has picked one of the two Apple operating models above.

---

## ~~7. Announcements members actually see, and a word when they hit a PB~~ (both shipped)

Gym-owner feedback, 25 August 2026. Two asks, both about the gym's
voice reaching the member instead of waiting in a list.

### ~~7a. Pin an announcement to the top of the member app, for a window~~ (shipped 0261)

**The job:** the owner has something everyone needs to know *this
week* — the gym is closed Monday, the summer schedule starts, the
comp sign-up closes Friday — and needs it seen without hoping people
open the Inbox.

**What exists:** `gym_announcements` (0029) already carries a `pinned`
boolean and the gym-created index sorts on it. Posting is gated by
`can_post_announcements`. The post lands in the member Inbox
(`/inbox`) and rolls into the "what needs you" bell count
(`inbox_unread_summary` → `useNotificationCount`). That's the whole
surface: a member who doesn't open the Inbox never sees it.

**What's missing:**
- A **time window** on the pin — `pinned_from` / `pinned_until` rather
  than a boolean the owner has to remember to switch off. The
  boolean's failure mode is a stale notice pinned for a month.
- A **header surface** in the member app. `TopNav` (member variant,
  `src/app/(member)/_layout.tsx`) renders above every member tab, so a
  banner strip under it appears on Book, Track, Programming — wherever
  they are — and doesn't need a new screen.
- Per-member **dismiss** state, so a seen pin stops shouting but stays
  in the Inbox. `announcement_reads` already exists from 0029; a pin
  dismissal is arguably the same row.

**Open questions:**
- One pin at a time, or a stack? (Recommendation: one — the newest
  in-window pin wins; a stack is a second inbox.)
- Does the banner recolour, or stay ink with the accent reserved for
  the page's single action? The accent rule says ink.
- Should staff see pins too, or only members? (The owner posting it
  doesn't need it shouted back at them.)
- Does a pin push to email, or is it in-app only? Today announcements
  are in-app only, and there is no push anywhere in the app.

### ~~7b. Tell the member when they hit a personal best~~ (shipped 0263)

**The job:** a member finishes a session, logs a lift, and beats their
old number — that's the moment the gym should say something.

**What exists:** PB detection is real but **client-side and
display-only** — `prRowIds` in `src/lib/movement-journal.ts` walks the
journal ascending and marks the rows that were records when recorded;
`MovementDetailView` renders the badge. Nothing is written down, so
nothing can be sent. The messaging plumbing to send it is all there
(inbox, `inbox_unread_summary`, the bell).

**What's missing:** the record has to become an event, not a derived
badge — something the recorder writes (or a trigger writes) at log
time, which is what a milestone message can hang off. Then the message
itself: a member-facing inbox card in the teammate's voice ("New best
back squat — 105 kg, up 2.5 from March"), consistent with the roadmap's
"a milestone message, never a redesign".

**Open questions:**
- Every PB, or only meaningful ones? A first-ever log of a movement is
  technically a PB and shouldn't read as a celebration. Likely rule:
  needs a prior best to beat.
- Rate limit — a member logging six movements after a session
  shouldn't get six cards. One "today's bests" card per day?
- Does staff see it? A PB feed is a genuinely good coach surface, but
  it's a separate ask; don't build it into this one.
- Opt-out: this is celebratory, some members won't want it. Email
  preferences already have categories; in-app cards don't.

---

## ~~8. Free trials — a free way in, and a limited-time offer~~ (both shipped)

Gym-owner feedback, 25 August 2026. Both are the same job seen from
two ends: get a prospect through the door without them committing.

### ~~8a. A link that books a lead into one specific class, free~~ (shipped 0262)

**The job:** the owner meets someone (Instagram, a walk-past, a
referral) and wants to send one link that puts them in Saturday's
9am — no card, no membership, no phone tag.

**What exists:** the pieces are unusually close.
- `/lead/<slug>` captures an enquiry with no account
  (`capture_public_lead`, granted to `anon`, gated on
  `gyms.public_lead_capture_enabled`).
- `/join/<slug>` signs someone up as a member, and already accepts
  pre-seeded `name` / `email` params — the AI agent sends personalised
  onboarding links today.
- The lead pipeline has a `trial_attended` stage waiting for exactly
  this signal, and `converted` attribution hangs off it.
- Staff can already book a non-paying person into a class
  (`staff_book_member`, used for walk-ins, guests and comps).

**What's missing:** a **trial invite** object — a gym-created,
tokenised link that names one class session (or a class type and lets
them pick a session), carries an expiry and a use count, and on
redemption creates the profile + membership, books the session, and
either creates the lead at `trial_attended` or moves an existing one.
The guardrails matter more than the flow: waiver + PAR-Q + consent
still have to be signed by their own hand before they're on a gym floor
(the roadmap is explicit that those screens are permanent), and a
booking made by a trial link must not consume a plan's credits,
because there is no plan.

**Open questions:**
- One link per lead (tokenised, single-use, attributable) or one
  shareable link per class the owner can post publicly? They're
  different products — the first is sales, the second is marketing.
  Recommendation: build the shareable one, and let the sales one be
  the same link with a `lead` param.
- Does a trial land as a real `gym_memberships` row with a
  zero-entitlement state, or as something lighter? `entitlement-states.md`
  is the place to answer this — a trialist who books but has no plan is
  a state the booking code already has opinions about.
- Cap per person: one trial ever, one per quarter, or the owner's call?
- What does the owner see when it's used — a Timeline receipt ("Sam
  took Saturday 9am on a trial link") is the obvious answer.

### ~~8b. Limited-time coupons — first month free, one-off, not recurring~~ (shipped 0264)

**The job:** the owner runs an offer — first month free, 50% off
January, a referral reward — and needs it to apply once and then stop,
without them remembering to undo it.

**What exists:** nothing. `membership_plans` carries a single
`monthly_price_cents`; `plan_subscriptions` bills from it via Stripe.
There is no discount concept anywhere in the schema, in the store
(`store_products.price_cents` is flat), or in checkout. The dunning
work (0176) is the closest neighbour and it's about failed payments,
not discounted ones.

**What's missing:** a coupon object (code, percent or fixed amount,
duration = once / N cycles, valid-from / valid-until, max redemptions,
per-member limit) and redemption rows that record who used what and
when. The billing half is the real work: Stripe has first-class
Coupons and Promotion Codes, and the right answer is almost certainly
to mirror rather than reimplement — create the coupon in the connected
account and attach it to the subscription, so proration, invoices and
the receipt email all stay Stripe's job. A Temple-side discount that
Stripe doesn't know about will drift from the invoices the member
actually receives.

**Open questions:**
- Membership plans only, or the store too? (Recommendation: plans
  first. Store discounts are a different checkout path and a different
  job.)
- Does a coupon apply at self-serve signup (member types a code), or
  does staff attach it when assigning a plan, or both? Both is likely
  right, but the self-serve path needs abuse limits the staff path
  doesn't.
- "First month free" on a `credit_pack` plan is meaningless — which
  plan kinds can a coupon attach to?
- Interaction with 8a: is "free trial class" just a 100%-off coupon
  with one use? Probably not — the trial link's value is that it needs
  no account and no card, and a coupon presumes both.
- Who can create one? New capability key (`can_manage_offers`) or
  fold into owner-only, like plan pricing is today.

---

## ~~9. Twelve asks from four gyms~~ (ten shipped, two are decisions)

Gym-owner feedback, 26 August 2026 — ACE Performance, Zade & Gareth,
James, plus two we had already put in writing and not built. Five
shipped in the first pass; the rest are written down here rather than
left in a chat log.

Two things reframed the list before any of it was built. The session
started on a checkout five days stale, and against the real tip most of
the "verified gap" notes were already right — `0260` had shipped
pro-rata on upgrades and `0263` had made a PB a row, both of which change
what these items cost. And **"targets" is a member word in Temple**:
macros and a member's own goals. The owner's intros/conversions/retention
figures are a dashboard comparison, they do not go on Goals, and they are
not called targets.

### ~~9a. Hide how full a class is~~ (shipped 0266)

**The job:** ACE open a new slot, the first weeks are thin, and "3 spots
left" on a class of twelve is both honest and the reason nobody books it.

**What shipped:** `gyms.show_class_capacity`, owner-only. Two things fell
out of it that were not in the ask. Members could already read every
booking row in the gym off the table — `class_bookings_tenant_select` had
been a bare `user_belongs_to` since `0006` and was never narrowed — so
"who's booked" needed no setting, it needed the leak closing. And
"Full — N waiting" was a live wrong number: it counted `class_waitlist`
client-side under a policy that hands a member only their own row, so a
queue of three read as one, or none. Staff saw it correctly, which is why
it passed review.

**~~Still open:~~** `class_waitlist_self_or_staff_select` had the same
guardian gap `class_bookings` just had — a parent who waitlists a child
could not see the entry. Closed in `0277`.

### ~~9b. Average member lifetime~~ (shipped 0267)

**The job:** Zade & Gareth want to know what a new member is worth.

**What shipped:** `membership_episodes`, and the number second. The dates
looked like they were already there and were not — `rejoin_gym` clears
`left_at`, so every rejoin was silently overwriting the only completed
stay the gym had. `compute_member_tenure` reports the completed median
**and** how long the people still here have been here, because averaging
only the departed is the survivorship trap.

### ~~9c. Abandoned checkout recovery~~ (shipped 0269)

**The job:** somebody reached the payment page and stopped; nobody finds
out.

**What shipped:** `checkout_attempts` plus a ninth stamped job. Built as
a job rather than an email automation because every branch of
`enqueue_due_automation_runs` joins `comms_audience_rows` on
`all_members`, and an abandoner may hold no membership at all. Checkout
sessions now expire after an hour rather than Stripe's default day.

### ~~9d. Macro targets per member~~ (shipped 0268)

**The job:** ACE keep protein, carbs and fat in a spreadsheet beside
Temple.

**What shipped:** `member_macro_targets`, coach-written on the profile,
member-read on Track. Calories derived 4/4/9, never stored. **Numbers
only and no note field** — that is the Article 9 line: a protein target
is a prescription, a note beside it ("cutting for her wedding") is health
data. If a note is ever wanted it arrives with the erasure sweep and the
audit log attached, not by widening the table.

### ~~9e. The owner's own numbers~~ (shipped, no migration)

**The job:** Zade & Gareth want the dashboard to measure them.

**What shipped:** the three lifecycle tiles on Leads gained "vs previous
period", and Members kept is new — `retention_now/retention_base` had
been in `compute_insight_summary` since `0102` and rendered nowhere.
`gym_insight_targets` stays unread; its editor was dropped deliberately
in `0207` and its `*_target` columns are 0 for every gym.

### ~~9f. Celebrate a PB by email or text~~ (shipped 0270-0272)

**The job:** a member hits a personal best and hears about it even if
they never open the app.

**What exists:** `0263` did the hard half. `member_milestones` is a real
row with a frozen body, a prior best to beat, and idempotency per
profile/track/day, and it already reaches the in-app inbox and the bell.
The automation engine is five triggers (`0201`) and email-only.

**What's missing:** one widened CHECK, one `elsif` branch in
`enqueue_due_automation_runs` anchored on `member_milestones.created_at`,
and four TS surfaces. Use the frozen `body` as a single merge field
rather than decomposing the numbers — the email then says exactly what
the in-app card said, and the ESP never handles a training record.

**Open questions:**
- `topic_id` is optional on the other five triggers. A PB email is a
  training-data disclosure, so it should be required here — which makes
  this trigger the odd one out in the editor.
- One card per PB or one per day? The milestone row is already
  per-day-idempotent, so per-day falls out for free.

### ~~9g. Write ahead for coaches only~~ (shipped 0273)

**The job:** a head coach plans weeks ahead without members reading next
week's session.

**What exists:** nothing. `class_programming`'s select policy is a plain
`user_belongs_to(gym_id)` (`0007`, never touched), so a save is a publish
to the whole gym. `programming_blocks` (`0205`) is already coach-only on
select and is the precedent.

**What's missing:** `published_at` — null is draft, past is live, future
is scheduled, and `published_at <= now()` in the member policy is the
entire release mechanism. No cron, no worker.

**Open questions:**
- **Backfill in the same migration.** A bare `add column` defaults null
  and every gym's live programming vanishes on deploy; it wants
  `published_at = updated_at`.
- `ProgrammingModal` writes `class_programming` by direct upsert. Draft
  state is exactly the kind of thing that should go through an RPC.
- Does `RecordWorkoutModal`'s pre-fill read published rows only? It must.
- A coach can only author on days that already have a materialised
  session (~12 weeks by default), so "weeks ahead" has a ceiling that
  is not this feature's.

### ~~9h. A common billing date, pro-rated to the 1st~~ (shipped 0274)

**The job:** ACE want everyone billed on the same day so chasing is one
job a month.

**What exists:** more than the note claimed. `0260` shipped pro-rata on
upgrades (`proration_behavior=always_invoice`) and the deferred-change
idiom for downgrades, and `0264` set the doctrine this should follow:
*the code is ours, the arithmetic is Stripe's*.

**What's missing:** `gyms.billing_anchor_day`, **nullable and defaulting
null** so nothing changes for a gym that does not opt in, plus
`subscription_data[billing_cycle_anchor]` on the session. 1–28 only:
29/30/31 is a February bug.

**It must be transparent.** The member sees what the first charge is and
when the next lands, before they pay — and the figure has to come *from*
Stripe (preview the first invoice) rather than being computed twice.
Degrade to the shape in words rather than to a number we invented.

**Open questions:**
- A proration below Stripe's minimum charge is not an error — it rolls
  onto the customer balance silently, so a member joining on the 30th
  appears to pay nothing and no `invoice.paid` fires. Below roughly a
  pound, send `proration_behavior: 'none'` and say so.
- New joins only. Moving live members needs `trial_end` at the next
  anchor, and changing what somebody already pays without asking is the
  worst surprise in the product.

### ~~9i. WhatsApp as a front-desk channel~~ (inbound shipped 0275)

**The job:** committed to James. People reach the gym where they already
talk.

**What exists:** the groundwork is genuinely good. `_shared/lead-agent.ts`
is channel-agnostic, `agent_conversations` is keyed
`(gym_id, phone, channel)` — and phone-keyed is exactly right for
WhatsApp — and Twilio, who already carry the SMS, carry WhatsApp too.

**What's missing:** the CHECK is `('sms','voice')` and has never been
widened; a cloned `lead-agent-sms`; and the Meta constraints, which are
the schedule risk rather than the code: business verification per gym,
and the 24-hour window meaning any agent-initiated outbound needs
pre-approved templates.

**Open questions:**
- Store E.164 in `phone`, never the `whatsapp:` prefix — keep it at the
  wire edge or `agent_stop_conversation` and every `leads.phone` match
  silently misses.
- Inbound-only is a real product. Agent-initiated outbound is a
  different, larger thing, and worth splitting.
- Every outbound job assumes `agent_outbound_messages.channel in ('email')`.
  A second channel built before those jobs want it gets built twice.

### ~~9j. Appointment booking — consults, intros, PT~~ (shipped 0276)

**The job:** publish bookable one-to-one slots.

**What exists:** classes only, and `0262`'s trial passes changed the
inputs favourably — the entitlement question is answered (`comp_grants`,
already preferred by `_select_default_entitlement_unchecked`) and the
seat-hold pattern exists. `intro_booked` is still a `lead_status` label
with no time, coach or session attached.

**What's missing:** build on `class_sessions`, not a new table. Capacity
1 is already legal, and everything an appointment needs — bookings,
waitlist, notifications, cancellation, entitlements — already hangs off
that row. Appointments differ in capacity and who picks the time, not in
kind. So: `class_types.is_appointment`, a `coach_availability` table, and
an `open_appointment_slot(...)` RPC materialising a capacity-1 session
under an advisory lock.

**Open questions:**
- Appointment sessions must be filtered out of `ClassesCalendar` and the
  public schedule (`0160`), or a 1:1 shows up as a class with one spot.
- Does an intro appointment link back to its `leads` row? It should —
  that is the join the enquiry board has never had.

### 9k. MyFitnessPal — a seam, not a build

**The job:** a member's intake appears against their targets.

**Where it stands:** MyFitnessPal's API is partner-gated and access is
not a given. Before anyone promises ACE a date, a half-day spike answers
one question: can we get credentials at all? If not, the fallback worth
costing is Apple Health / Health Connect, which needs no partner and
reaches the same data on the member's own device.

**The seam, kept open by 9d:** `member_macro_targets` is a pure
*prescription*. Intake is a different table keyed the same
`(gym_id, profile_id)` way, with a `source` column from day one so a day
typed by hand and a day imported stay distinguishable. Not building a
food log is what keeps that clean; putting intake columns on the targets
table is what would close it.

### 9l. ClassPass — a decision, not a feature

**The job:** ClassPass bookings appear in Temple.

**Where it stands:** a margin call before it is engineering. ClassPass
fills classes and takes margin, and that is the owner's decision to make
once, not per gym.

**The seam:** `_book_class_for` is the single authority on capacity and
`class_session_spot_counts` (`0266`) is display-only, so an external
source can be added behind the same gate. The real question is identity:
`class_bookings.profile_id` is a hard FK to a Temple profile, so an
external booking has nobody to point at. Either external bookings mint a
shadow profile, or the table grows a nullable external-party column.
`used_entitlement_kind` / `used_entitlement_id` already exist to record
what paid for a seat.


---

### What the twelve came to

Ten shipped. The two that were never engineering — MyFitnessPal (9k) and
ClassPass (9l) — stayed decisions, with their seams written down above so
neither is harder to start than it was.

**The three that turned out bigger than the note said, and why:**

- **9f was not "one more trigger".** In-app was done (0263) and email was
  indeed small, but *text* did not exist: no member SMS path anywhere, and
  the one seam that looked like one (`lead_notifications.channel = 'sms'`)
  is force-`skipped` by its worker. Worse, the number every gym gets
  provisioned is a UK **local** number, which cannot carry SMS at all —
  the "option A, voice-first" decision. So it took a general member
  channel (0271), an SMS-capable number and a normalised phone (0270), and
  an opt-in, before the PB itself (0272) was three lines.
- **9a hid two defects** — see above.
- **9j needed availability from scratch.** The booking half was nearly
  free because an appointment is a capacity-1 class session; what did not
  exist anywhere was any notion of when a coach is around.

**Two things a person still has to do:**

1. **Twilio needs the DPA's 30 days' notice.** It is in Annex B and the
   lawful-basis register now (0272), but §7 requires the Gym be told
   before a new sub-processor starts processing. Member texts should not
   go live until that notice has run.
2. **Existing gyms hold voice-only numbers.** `sms_capable` backfilled
   false for them, correctly — their number genuinely cannot text. New
   provisions ask Twilio for a mobile first. A swap path (buy mobile,
   move the Vapi assistant, release the local number) is not built, and
   probably never needs to be: the live path is still gated on Temple's UK
   regulatory bundle, so in practice no gym has a number yet.

**And one follow-up this created**, `class_waitlist_self_or_staff_select`'s
missing guardian clause, is closed in `0277` along with the rest of the
sweep below.

---

## 10. The three defects, swept as families (shipped 0277)

Three defects were found while building the twelve above, and all three
were fixed where they were found. What was not done was to ask whether
each was an instance or a pattern. Restated as rules the codebase should
hold, they are:

- **A.** A number shown to a member must not be counted client-side over a
  table whose policy hands them a subset.
- **B.** A column whose own migration says it is not the displayed value
  must not be displayed.
- **C.** A suppression written in one place must be read by every sender.

Sweeping for those found five more, plus one inconsistency. Where there
were three, there were eight.

**A — the roster a member cannot read.** `gym_memberships`' tenant select
was dropped in `0002` and never re-widened, so a member reads exactly one
row: their own. The DM recipient picker read the table, excluded the
caller, and came back **empty for every member** — and correct for every
owner, which is why nobody reported it. The thread header read it too, so
the coach/owner label the code's own comment argues for never appeared.
Both now go through `gym_directory`, a definer gated on `user_belongs_to`,
the same move `0258` made for the journal's avatar stack. It exposes
nothing new: `profiles_gym_member_select` has handed names gym-wide since
`0006`, and `dm_scope = 'member_coach_only'` cannot work without knowing
who is a coach. The class-broadcast composer's raw `class_bookings(count)`
embed was correct today but only via a two-hop argument about which roles
can reach the screen; it moved to `class_session_spot_counts` on `0266`'s
own grounds.

**B — a rank that is not a rank.** The waitlist card printed
`#{position}`, and `0016` says in as many words that position is insertion
order and is **never** renumbered. So every departure ahead of a member
inflated their number, and once the original #1 left, nobody ever read
"You're next in line" again. The class modal computed the rank properly,
so two screens showed two numbers for one class. `my_waitlist_ranks` is
the batch sibling of the existing singular, shaped like
`class_session_spot_counts` because the screen lists several entries.

**B — "Emails delivered" over a pre-send snapshot.** `recipient_count` is
written once, at send authorisation, as the size of the audience snapshot
(`0194`) and never revised. `0229` exists to kill exactly this word — *"a
200 from the API is a promise to try, not an arrival"* — and fixed the
per-campaign report, but this tile was missed. It says **Recipients**
now, which is what the number is; the delivered figure is one tap away on
the campaign's own report.

**C — the one queue that skipped `email_suppressions`.**
`send-member-messages` had no suppression read, and its drain re-picks
`failed` rows three times, so a hard-bounced address was retried three
times per message — the precise harm `_shared/suppression.ts` says it
exists to convert into one recorded skip. The check went in beside the
unsubscribe test in `_enqueue_member_message`, because `0271`'s doctrine
is that consent is decided at enqueue, and as a *separate* test: `0229` is
right that the member's choice and the address being dead are different
facts.

**C — an unsubscribe read too late to matter.**
`pending_members.unsubscribed` is imported from the gym's old system and
was converted into a real `email_unsubscribes` row only at signup. Between
import and signup the refusal existed nowhere the senders look, and two of
them mailed those people. Fixing the two call sites would have left the
shape wrong, so the row is now written at import time by a trigger, with a
backfill — it is address-keyed and never needed a profile, so there was no
reason to wait for one. The join-invite worker consults
`email_unsubscribes` not at all, so it also reads the flag directly.

**One refusal, one behaviour.** Texting STOP skips messages already
queued: *"a queued text is a message the member has now refused, and
sending it because it was written first is the definition of not
listening."* Turning the same switch off in the app did not. Both
`set_my_sms_opt_in(false)` and `set_my_email_blanket_unsub(true)` now
perform the same skip. The enqueue-time doctrine still holds for
everything else; what changed is that the two ways of saying no get the
same answer.

### The worker that missed its deploy

`0277`'s migration shipped; its edge-function change did not, and the
reason is worth writing down because it will happen again.

The CI run GitHub created for the `0277` commit sat at status `queued`
for two hours with no jobs assigned, and the cancel API refused it —
*"cannot cancel a workflow run that has not been queued yet"* — so it had
never been dispatched at all. `ci.yml` has no `workflow_dispatch`, so the
only lever was a fresh push, and an empty commit provided one.

That empty commit is what did the damage. The **Work out which edge
functions changed** step diffs `github.event.before → GITHUB_SHA`, and
for that push `before` was the commit carrying the edge-function change.
The diff was empty, the log read *"No edge function changed. / Nothing to
deploy."*, and `send-member-join-invites` stayed on its old code while the
migration went out. Green CI said so in three jobs.

**The shape of the trap**: an empty commit re-triggers CI but resets the
changed-function window past whatever the previous push contained. Any
push that follows a skipped or undispatched run has the same hole. The
fix is to make the next push touch the function's own directory — there
is no way to widen the window backwards.

The reads it now carries are not a touch for its own sake. Of the six
senders it was the only one consulting neither `email_suppressions` nor
`email_unsubscribes`, which is exactly why `pending_members.unsubscribed`
had to be read directly here. It checks all three now, and reports
`skipped` alongside `sent` and `failed` — the two single-row callers said
*"the email address may be undeliverable"* for a person who had simply
said no, which sends staff chasing a fault that is not there.

### What could and could not be verified

The two member surfaces were checked against a database with all 277
migrations applied: `gym_directory` and `my_waitlist_ranks` carry the
argument names and return columns the call sites use, execute is granted
to `authenticated` and revoked from `anon`, a member reading
`gym_memberships` directly still gets exactly one row while the definer
returns the roster minus the caller, and after the person at the front of
a waitlist leaves the raw `position` stays 3 while the rank correctly
reads 2.

What that does not cover is the HTTP hop — PostgREST's schema cache, and
the client actually rendering what comes back. `src/types/database.ts` is
hand-maintained and both call sites cast through `as unknown as`, so a
wrong parameter name typechecks perfectly. `e2e/08-member-surfaces.spec.ts`
is the only thing in the repo that would catch it; it runs against the
deployed app, which this container's network policy cannot reach, so it
has to run in CI or from a machine that can.
