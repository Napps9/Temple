# The Temple roadmap

What keeps its screen, what moves into the Timeline, and in what order.
Companion to `docs/vision.md` (the argument), `docs/how-temple-works.md`
(the product on one page) and `docs/loop-1-payment-recovery.md` (the
first loop's engineering). This document is a full review of
`docs/feature-inventory.md` — every live area is accounted for below, so
the migration can't quietly orphan something that works today.

The sorting rule and the inventory below are unchanged since the first
draft; they held up. What changed is the mechanism and therefore the
order — see "Where we got to" and "What changed on the way".

## The sorting rule

The Timeline replaces the admin, not the tools. A screen survives when it
is where craft, judgement or evidence lives — writing programming, running
a class, listening to a call, signing a waiver. A screen dissolves when it
only exists so a human can operate the machinery — settings forms, queues,
wizards, dashboards that end in a human doing the work. The machinery
itself (the RPCs, workers, crons and RLS) survives everything: it becomes
the loops' sensors and hands.

Every live feature lands in one of four dispositions:

1. **Keeps its screen** — the interface stays as it is, same look and
   feel, assembled from the same component kit. It may gain context (the
   programming block strip) or lose admin invisibly (auto-tagging), but
   nobody relearns anything.
2. **Moves to the Timeline** — the interaction becomes a sentence you
   say, a question with two choices, or a one-line receipt. The screen it
   replaces demotes to the Back Office and burns down from there.
3. **Splits** — the routine path becomes conversational; the full screen
   survives one tap deeper for the deep dive or the pixel-level control.
4. **Retires** — absorbed by a loop or deleted outright.

## The inventory, sorted

### The member app — keeps its screen, wholesale

Booking (calendar, agenda, quick-book recommendation, waitlist,
multi-membership picker), Track (journal, recorder, PR badges,
sparklines, 1RM percentages, streaks and heatmap, movement library,
leaderboards, Hyrox mode), the injury tracker, DMs, announcements and the
inbox, the programming view with percentage chips, individual
programming, self-serve membership and plan changes, the store, email
preferences, family accounts, athlete mode. All of it stays exactly as it
is — members feeding the system its data is what makes every loop
possible, and it already works. Anything new on the member side is
additive (a push nudge as the teammate's voice, a milestone message),
never a redesign. The consent, waiver and PAR-Q signing flows keep their
screens permanently: a member's own hand is the point.

### Running classes — keeps its screen

Today (the class calendar in its current look), the class detail modal —
roster, check-in, waitlist, the session leaderboard, message-class,
add-member, switch-plan. The admin evaporates *in place*: everyone booked
marks as attended unless the coach unticks them, no-shows resolve after
class, and the patterns flow to the retention loop on their own. The
coach's screen doesn't change; the transcription work inside it
disappears.

### Programming — keeps its screen, gains the roadmap

The calendar editor stays the writing surface, for class programming and
individual programming both. Already-invisible admin stays invisible: the
classifier reads what the coach wrote, percentages resolve to each
member's numbers. The one addition is the roadmap — named blocks, the
strip above the week, the Year view, share with coaches — built inside
the editor from the same kit. **Splits**: the Analysis page. Its verdicts
become Timeline messages with hands ("Thursday is shoulder-heavy right
after Tuesday's push day — want a swap?"); the full page survives in the
Back Office for the deep dive. Bought programming (PRVN, Mayhem) pastes
in chat and lands in the editor as a draft.

### Classes and operations — the changes become sentences

The class-types editor, recurrence rows, bulk-edit picker, closure and
reopen flows all **move to the Timeline** as interactions: "close the gym
22 December to 3 January", "cap Saturdays at 20", "add a 7am Wednesday
spin class" — each answered with a preview and one question. The editors
demote to the Back Office; the machinery underneath (materialisation,
closure suppression, refund-and-tell-everyone, the schedule-splitting
arithmetic) is exactly what makes a sentence trustworthy, and none of it
changes. Day-one setup already works this way in `/setup`; this phase is
the ongoing version.

### The Manage cockpit — mostly moves, two splits

- **Settings and branding** — every settings card becomes the rule sheet:
  the same sentences-with-tappable-values surface `/setup` already
  builds, permanent, so "make the cancel cutoff 2 hours" works for the
  life of the gym. **Moves.**
- **Plans and billing** — creating and changing memberships is a sentence
  with a preview card ("Unlimited is £89 with 30 days notice"); the plans
  editor demotes. Stripe connection health becomes a go-live check and a
  Timeline receipt when something needs attention. **Moves.**
- **Membership change requests** — the queue becomes Timeline questions;
  routine requests approve themselves against the owner's precedent.
  **Retires** as a screen.
- **Refunds** — a question with two choices; the preview arithmetic sits
  behind "see the details". **Moves.**
- **Member list and profiles** — **splits**: "show me Marcus" brings the
  picture first; the searchable list and full profile stay one tap deeper
  for genuine roster work.
- **Tags and tag rules** — tags become signals feeding loops (the
  automation triggers already read them); the rule editor demotes.
  **Moves.**
- **Insights KPIs** — every chart ends in a verb: the numbers arrive as
  Timeline lines with drafted actions, and Goals carries the trends.
  **Moves.**
- **Team, invites, permissions** — inviting is a sentence ("invite Sam as
  a coach"); the roster page becomes the Roster — people and Temple's
  jobs side by side, each job with its rules and its rope. The capability
  matrix stays the authz substrate underneath. **Moves**, with the Team
  editor surviving in Back Office for fine-grained permission work.

### The money — the first loop

Dunning already sees, notifies and builds the chase list; loop 1 upgrades
"see them, chase them" to *chased for you*. "Needs chasing" **retires** —
the first list deleted. The Money tiles become Timeline receipts ("I got
£74 back") and Goals numbers. Store: the member side keeps its screen;
product authoring keeps a screen (craft); the orders/fulfilment queue
**moves** to receipts with batch actions.

### The front desk — already the proof

The lead agent keeps acting; its receipts and judgement calls are the
Timeline's founding content. The pipeline board **splits** into the Back
Office; the conversation review and call-QC screen **keeps its screen**
(listening to a call is evidence work). The agent setup wizard folds into
`/setup` and the Roster's job sheets. Coaching corrections stay — that
*is* the owner teaching the voice everything else will write in.

### Switching platforms — a sentence at go-live

"Send me your member list" already runs from `/setup`. The CSV, workout
and Stripe importers' review steps **split**: they keep their screens for
the judgement calls (plan mapping, fuzzy duplicates, the double-bill
guard) and are reached from the conversation rather than a menu. The
import machinery — inference, corrections learning, legacy billing
continuation — is untouched.

### Reaching members — sentences over the shipped machinery

A newsletter is a sentence; the draft is the preview card. A sequence is
described, laid out as steps, turned on. Audiences resolve through the
tag machinery; new audiences stay approval-gated. The block Design
builder, the audience builder and the automation editor **split** into
the Back Office (pixel control when it's wanted); scheduled sends, A/B
subjects, topics, suppression, sending domains — all of it is hands,
unchanged. The front desk's taught voice becomes the one voice.

### The website — removed

The builder was removed entirely (0259): no gym ever published a site
or connected a domain, so the whole surface left the product rather
than earning verbs.

### The team's own work

Cover *asking* is a sentence from the coach ("I can't do tomorrow's
6:30"); cover *finding* becomes the ops loop — the nightly nag emails
retire when the loop places cover itself. Claim offers arrive as
Timeline cards. Earnings **keeps its screen** (a coach checking their
pay is evidence). Tasks and SOPs: reading **keeps a screen**; assignment
and chasing **move** to the Timeline.

### Health and the law — permanently human, permanently unchanged

Consent, waivers, PAR-Q, erasure, retention purges, the access audit log,
breach monitoring. No loop touches any of it; the boundary is stated in
every job's rules ("I never talk about health"). Guardian flows included.

### The plumbing — the Timeline is the missing screen

`cron_run_log` is the sharpest case: every sweep now records what it did,
and the whole interface is a SQL query. Those rows become quiet Timeline
lines — the gym's pulse, visible for the first time. The notification
badge sources fold into the same stream. PWA branding, light/dark, the
crash screen, BackLink, RLS, the capability matrix: load-bearing
substrate, untouched.

This section used to say the two dead capability switches
(`can_issue_override`, `can_issue_comp_grant`) **retire**. Neither is dead
any more and neither retired — they were wired up instead.
`can_issue_override` gates going over a class cap in `book_member_for`
(0213, with a pgTAP test) and `can_issue_comp_grant` gates
`grant_member_comp` (0211) and the `members.comp` action. A switch an
owner can see and a server that ignores it is the bug this codebase keeps
finding; both of these were that, and both were fixed by enforcing them
rather than by deleting them.

## Where we got to

The first nine phases are built and live. They were sequenced by what
each unlocked, and in order:

- **The Timeline** is the staff home. `timeline_feed` unions eight kinds
  of thing that happen in a gym — someone joined, a payment failed, the
  front desk took a lead, a class needs cover, the sweeps ran — into one
  stream, gated per kind by capability. The gym's existing activity
  became legible in one place before anything new was asked to act.
- **Three jobs act, on a rope.** Payment recovery, keeping members and
  finding cover each run as a proposal on `agent_actions`: at `approval`
  it's a question with exactly two choices and its evidence behind "see
  the details"; "always allow this" flips the same job to `autonomous` in
  the same transaction. Hard rules live in SQL, not in a prompt — one
  open question at a time, a rejection ends that case's asks for good,
  never cancel a membership, never invent a discount, quiet hours
  enforced at the send. "Needs chasing" was the first list deleted.
- **Rules are sentences.** The whole settings surface reads as grouped
  sentences with tappable values, and changing one in the bar applies
  through the same setter RPCs the forms used.
- **Day one is a conversation.** `/setup` runs the checklist's nine steps
  in the checklist's order, each with the real component embedded — the
  branding picker, the schedule editor, the invite section — and each
  answerable by tapping or by typing.
- **The programming roadmap** — blocks, the strip, the Year view —
  inside the kept editor, which is what the coaches asked for.
- **A newsletter is a sentence**, drafted into the comms suite's own
  document and opened for the owner to send.
- **The Roster and Goals** — Temple's jobs in plain names with rope
  dials, and "200 members by December" scored off the live roster.

## What changed on the way

Two things we learned by building it, both of which redraw the rest.

**The chat is the spine; the containers are the hands.** The first
version of setup asked for everything in prose. Describing a logo upload
is slower than tapping one, and listing a week of classes out loud is
worse than the schedule editor that already exists. The conversation is
right for sequencing, context and the record; the existing components are
right for the work. Every conversational surface now embeds real
components rather than replacing them.

**Hand-built verbs don't reach a platform.** Each thing the bar could do
cost a field on the tool schema, a sanitiser, a resolver, a card and an
apply path. That's fine for five verbs and hopeless for a hundred, and
"run your gym by saying what you want" is a promise about everything. So
actions now declare themselves once — what an owner would say, the typed
arguments, the capability, how to preview, how to apply — and the
parser's vocabulary is generated from the registry at call time, filtered
to what that person may actually do. Adding an action is adding one
entry. The store is the first module: add a product, change a price, ask
how sales are going.

This is the change that matters for everything below. The roadmap is no
longer a sequence of features to design; it is a catalogue to fill.

## The order from here

### 1 — One path — done

Migrate the five hand-built verbs — rules, new classes, new plans,
closures, newsletters — plus the member lookup and the class edit onto
the registry, and delete the bespoke branches. Two dispatch paths is one
too many, and every module after this inherits whichever is left.

Shipped as `src/lib/actions/{gym,classes,members,store}.ts`. The Timeline
now knows one card kind and one confirm handler; the parser's tool holds
no vocabulary of its own — the catalogue, argument shapes and value
conventions are all sent per call from the registry, filtered to what the
person asking may actually do. Two things the migration earned, rather
than guessed in advance: a preview may name a **card** the feed renders
(a member is a face and a standing, not two lines of prose), and it may
come back with **choices** instead of an answer — one chip per candidate,
each re-running the same action with the ambiguity settled. Both are
generic; nothing about either is member-specific.

One narrowing, stated: a sentence now resolves to one action. The old
tool could fill several of its fixed fields at once, so "close 24 to 28
December and cap Saturdays at 20" would have raised two cards and now
raises one. Sequencing several actions from one sentence belongs with
step 3, where the ordering between them has to mean something.

### 2 — The modules, in the order an owner meets them

Each is a file of registry entries over writes that already exist and are
already authorised. Roughly in order of how often an owner touches them:

- **Members** — done (0211). It was the biggest gap in the platform, not
  just in the bar: there was no staff-side "put Marcus on Unlimited"
  anywhere in Temple, members self-served through Stripe, and comp grants
  were displayed but never issued. The money question was the owner's to
  settle and they settled it — assignment is a **continuation**, the same
  semantics the CSV importer already produced, so nobody re-signs-up and
  nobody re-pays. Assign, comp, tag and message all ship over it.
- **Classes and bookings** — done, except two things that turned out to
  have no write behind them at all (0212–0214). Cancel a class, book
  someone in, take them out, work the waitlist. Cancelling a class
  notified nobody before this and class-change emails had no dispatcher,
  so both were fixed underneath rather than papered over. **The two that
  had no write behind them now do** (0224): `classes.move` ("push
  Friday's barbell club to Thursday at 6:30") and `classes.set_coach`
  ("Jo is taking Saturday's 9am").

  `bulk_edit_sessions` was the only writer of a session's time, and it is
  a *relative* shift over a date range that refuses anything crossing
  midnight — so moving one class to a different day had no expression at
  all, and the client could not do it either (0195 revoked UPDATE on
  `class_sessions`, deliberately). `coach_id` had exactly one writer in
  the whole schema: `claim_cover`, which sets it to `auth.uid()`. A coach
  could volunteer for a class; nobody could be given one.

  Three things the new RPCs had to learn that the trigger layer could not
  teach them. The closure-suppression trigger is BEFORE INSERT only — on
  purpose, per 0164, since firing on `UPDATE OF coach_id` would make a
  coach who claims a class inside their own away window immediately
  re-offer it — so moving a class *into* a live closure is a hole only the
  RPC can close, and it does. The unique index on `(recurrence_id,
  starts_at)` turns a move onto a sibling's slot into a `unique_violation`,
  caught and said in words. And the coach change replicates `claim_cover`'s
  two hard-won checks: no double-booking, and nobody put in front of a
  class type they are marked unqualified for.

  Two things they deliberately do not do, both said on the card rather
  than hidden. **They do not touch `class_recurrences`** — 0170 refuses to
  rewrite a pattern from a partial selection because "these three
  Tuesdays but not that one" has no representation in a recurrence, and
  one session is the most partial selection there is; so the schedule
  still says the old slot and editing the schedule later puts the class
  back, which the card states. **A coach change tells no members** —
  `class_change_notifications.kind` has no coach-change value and
  `claim_cover` tells the requesting coach and nobody else, so adding
  member mail on one path and not the other would make cover and
  assignment behave differently for the same visible event. It is one gap
  across both paths, listed below.
- **Money** — done for memberships (0215). Read the month back
  (`money.summary`, per currency, with what is failing right now),
  change a plan's price, and refund a member. Two of the three needed
  nothing new underneath; the price change needed a migration, because
  the cached Stripe Price was never invalidated and an owner who put a
  plan up kept selling it at the old rate with no screen disagreeing.
  The refund is the one place a chip is not a convenience: four refunds
  hide behind "refund Marcus" and they differ by tens of pounds and by
  whether he trains tomorrow, so the mode is kept out of the parser's
  vocabulary entirely and the card asks with the arithmetic already on
  each option. **The shop can be refunded now too** (0225):
  `store.refund_order` over a new `refund-store-order` function, the same
  shape as the membership one — Stripe on the gym's connected account, the
  amount recomputed server-side, the secret key nowhere near a client.
  `store_orders` has carried a `refunded` status since the shop was built
  and nothing had ever written it, so a wrong-size hoodie was refunded in
  the Stripe dashboard and the order sat in Temple saying paid.

  What Stripe knows nothing about is the half that needed deciding.
  **Stock comes back only if nothing shipped** — refunding a posted hoodie
  does not put it on the shelf, and silently adding it back would have
  somebody sell it twice. **A digital delivery is revoked** — it cannot be
  un-downloaded and the card says so, but leaving a live link on a
  refunded order means the gym is still serving a file to somebody who has
  their money back. And **a partial refund still ends the order**, because
  inventing a `partly_refunded` status would spread through every surface
  that reads status; the amount lives on the billing event, which is where
  money already lives. **Still absent:** refunding a single booking's
  credit, which `remove_member_booking` already does as part of taking
  someone out rather than as a verb of its own.
- **Comms** — done. Send to a tag (the newsletter finally carries an
  audience, resolved against the gym's real labels and counted on the
  card), describe a sequence, which lands as a disabled automation over
  the engine that already had five triggers, step delays and suppression
  and no way in but a form, and now **schedule a send and call one off**.
  The standing rule was that nothing sends from the bar, and a scheduled
  send is a send with a delay. The owner's call was yes, on one condition
  — the card must render the actual email, name the audience and the
  exact time, and the send stays cancellable until it goes. All three
  hold: the card is the compiled HTML the worker will post, the audience
  line carries its count, the time is spelled out with how far away it is,
  and `comms.cancel_send` pulls it back to a draft by sentence right up
  until the dispatcher takes it. Losing that race is reported as losing
  it — "it has already gone out" — because saying "cancelled" would be
  the worst available lie.

  Two writes, deliberately not one transaction. The user's rule for
  chaining was stop and say exactly where, so a draft that saves and a
  schedule that doesn't leaves a real, openable draft and a sentence
  saying so. Rolling the draft back would leave nothing and a sentence to
  retype.

  A bug fell out of building it: **nothing in the comms path read
  `gyms.timezone`.** The editor resolved the typed time in the *device's*
  zone and said so in the hint text, so a coach scheduling from a beach
  booked the wrong hour for the members. Both surfaces now read the gym's
  zone through one parser (`src/lib/send-time.ts`), which is the same
  rule the timetable and the cancel cutoffs already followed.
- **Leads** — done for the pipeline (0217). Take an enquiry down while
  they are still on the phone, move one along, hand one over, and ask how
  the week is going — including who has been left untouched, which is
  what a board is worst at showing. The front desk's own settings are
  still a screen and stay one for now: they are the owner teaching a
  voice, which is closer to craft than to admin. **The pipeline has its own
  switch now** (0226). It was gated on `can_assign_plan`, described to
  owners as "Assign plans: put members onto plans and adjust
  subscriptions" — the wrong switch for a sales board, so an owner who
  wanted a coach on the phones had to hand them membership billing to do
  it. `can_work_leads` defaults to exactly who held the old key (admin,
  coach, front desk; owner true by short-circuit), so nothing changes on
  day one and from day two the two can move apart, which is the point.

  The second half was the reason to do it now rather than later. Nine
  policies across seven tables — `leads`, `lead_sources`,
  `lead_assignment_rules`, `lead_notifications`, `agent_conversations`,
  `agent_messages`, `gym_agent_settings` — still read
  `user_can_assign_plan`, the raw-role helper with no `left_at` guard and
  no override lookup. So 0217 made the writes honour the switch while the
  *reads* ignored it: a coach whose switch an owner turned off could still
  read every name, email and phone number in the pipeline, and somebody
  who left in March could read them in July. Same bug class, one layer
  down. What did not move is `plan_subscriptions`, `comp_grants` and
  `membership_change_requests` — membership machinery, where
  `can_assign_plan` is the only key it should ever have been.
- **Team and tags** — done for what has a write. `team.invite` ("invite
  Sam as a coach, sam@example.com") over the existing `send-invite`
  function, `team.who`, and `tags.add_rule` — the other half of
  `members.tag`, which labels one person where this describes a kind of
  person and lets the sweep find them from now on. The rule runs
  immediately rather than waiting for the nightly pass, so the receipt can
  say how many it caught. **The two that had no write anywhere now do**
  (0223): `team.set_role` ("make Jo an admin", "Dan is not coaching any
  more, just a member") and `team.remove` ("Marcus has left"). Changing a
  role meant deleting the person and re-inviting them, which threw away
  the membership row and everything hanging off it. The verbs keep the
  two operations apart on purpose — a demotion keeps the membership,
  bookings and history; a removal cancels the lot and erases the health
  answers, and reading one as the other is only recoverable in one
  direction, so both cards say plainly which one they are.

  Three rules govern anything touching a role, and they live in SQL
  rather than in the client, because they are what makes granting the
  capability safe: only an owner mints or changes an owner or an admin;
  only an owner removes one; and a gym always keeps at least one owner,
  since a gym whose only owner walked out has nobody who can administer
  it and no support console to fix it from. A role change also clears
  that person's per-member capability overrides — they were granted for
  the job they had, and carrying them across is how a demoted admin keeps
  admin powers under a coach's label.

  One more bug fell out: **`user_can_admin` had no `left_at` guard.** It
  backs thirteen policies across eight tables and the destructive verbs
  lean on it, so an admin who left in March could still remove members in
  July. `effective_can` has required `left_at is null` since it was
  written; this was the last raw-role holdout on that path. `leave_gym`
  moved onto `effective_can(gym_id, 'can_archive_members')` at the same
  time — the screen has always gated its Remove button on that key, and
  the server was asking a different question, which is 0218's bug on a
  more destructive verb. **Settled, and the one
  capability change that widened rather than tightened** (0218):
  `create_invite` gated on `can_manage_staff` while the invite form read
  `can_invite`, so an owner who granted "Send invites" to a coach gave
  them a button that failed — the switch's entire effect. The owner's call
  was that the label meant what it said, so the gate is now `can_invite`
  and somebody granted it can invite members and staff. The owner-only
  ladder does not move and now matters more, not less: it is the only
  thing between the widened gate and a coach making themselves an admin.
- **Programming** — done for the scaffolding (0219). The year plan
  (`programming.block_out`, `move_block`, `drop_block`), who is on
  individual programming and what it costs them
  (`programming.set_access`, `who_is_programmed`), and whether a plan
  carries it (`plans.include_programming`). **The craft line held**:
  nothing here writes a workout, and the things that would have —
  "copy last week into next week", "clear Saturday's programming", "put
  today's WOD on the leaderboard" — are deliberately not built. Each is a
  wholesale replace of a `sections` array whose honest preview would have
  to render the coach-written content it is about to overwrite. That is a
  card renderer, not an argument list — **so the renderer was built and
  two of them shipped**: `programming.copy_week` and
  `programming.clear_day`, previewed by a card that quotes the coach's own
  titles on the days they are about to disappear from, struck through, with
  a confirm label that changes when something is lost. "Put today's WOD on
  the leaderboard" is still deliberately unbuilt: it is a judgement about a
  session, not scaffolding around one.
- **Website** — retired. The five verbs shipped, then the whole
  builder was removed (0259) before any gym published a site; the verbs
  went with it.

### 3 — It remembers what you just said — done

Every sentence used to go up alone: the text and the catalogue, nothing
else. No previous turn, no subject, no history. So "show me Marcus"
followed by "put him on Unlimited" could not work and the owner named him
twice — never a model problem, the conversation was simply never sent.

Three things, in the order they changed the feel:

- **The last few turns travel with the sentence.** Done. Pronouns and
  ellipsis resolve — "him", "that one", "the same again". The subject of
  the last card becomes the default subject, which is most of what makes
  something feel like talking rather than typing commands.
  `src/lib/chat-memory.ts` bounds it by both count and recency and is
  pure, so the freshness rule below is tested rather than trusted.
- **The conversation survives.** Done (0221). `chat_turns` stores who
  said it, what they said, when, and which member it was about; the
  Timeline restores the last twenty on open. Turns come back as the words
  they were and never as cards — a preview is a snapshot of a gym that has
  since moved, so re-offering its confirm would ask somebody to agree to a
  world that no longer exists. **Restoring does not weaken the freshness
  rule**: `recentTurns` still drops anything past ten minutes before it is
  sent, so yesterday reads back on screen and carries nothing forward into
  today's sentence. You read your own conversation and not the gym's — an
  owner reading back every question a coach ever asked is a surveillance
  feature nobody asked for, and the ask was first person both times.
  Ninety days, then purged on the same cron shape as the lead sweep; and
  erasing a member takes the turns naming them with it, from inside
  `_erase_member_health_data`, which is where every forget-this-member
  path already goes.
- **One sentence, several actions — built.** "Put Marcus on Unlimited and
  tag him VIP" is two writes with an order between them, and making
  somebody say it twice is the kind of small tax that adds up to a surface
  nobody uses. The parser emits `steps` rather than one action, capped at
  three and instructed not to invent one.

  The rule that decides whether they travel together is the load-bearing
  part, and it is pure and tested (`src/lib/chain.ts`): **every step must
  be a write that came back with something to confirm.** A step that
  resolved to a question ("which Marcus?") cannot be agreed to in advance
  alongside something else, because agreeing to a question is agreeing to
  whichever answer the bar picks; a step whose sanitiser refused leaves a
  sentence with its middle missing. Either way the chain collapses to its
  first step and the bar says how many were left, naming the number — one
  sentence to repeat is a different job from "some other things".

  **The failure mode was the owner's call: stop and say exactly where.**
  No transaction and no rollback, deliberately — these are separate writes
  across separate tables and some have already left the building, with an
  email sent or Stripe having moved money. Inventing a reverse for every
  verb would be a second set of writes to get wrong, and a reverse that
  itself failed leaves the owner worse off than being told plainly. So the
  run stops at the first failure, the receipt carries what did happen, and
  everything after is left untouched rather than attempted, because the
  later step usually assumed the earlier one.

Two costs, both real and both decisions rather than implementation:

- **A stale subject is worse than no subject.** Settled: ten minutes and
  six turns, whichever runs out first, because an owner who walked away
  and came back is a different context on the same screen. Acting on the
  wrong person is not recoverable; failing to understand is. The card
  names the subject in full ("Put Marcus Webb on Unlimited?"), so who
  "him" resolved to is visible before confirming rather than after.
- **A persisted conversation is a record of which staff member asked
  what about which member.** That sits next to health-adjacent surfaces
  and must not become a way around the access audit log — asking the bar
  about someone has to leave the same trace that opening their profile
  does. **Settled: ninety days, then purged.** Long enough to answer "what
  did I ask last month", short enough that it is not a permanent record of
  who asked what about whom, and the same shape as the lead retention
  sweep (`purge_expired_leads`, 0115) so it is one more entry on a cron
  that already exists rather than a new mechanism. The audit trace is not
  optional and is not part of the trade: it lands either way.

Placed here because asking about the gym is where follow-ups are worth
most: "how busy was Saturday" wants "and Sunday?" to work. But it is
independent of the module work and can be pulled forward the moment the
current verbs start feeling like a command line rather than a
conversation.

### 4 — Ask anything — done

Two of the four shipped first (0231): `classes.attendance` ("how busy
have we been", "how busy was Saturday", "which class is dying") over the
attendance page's own reads plus the preceding period, and
`members.quiet` ("who hasn't been in for a month") over a new
`gym_quiet_members` RPC — the one question here with no screen behind it.
"What did we take last week" was already `money.summary`.

**And then the shape of the answers, which was the actual remainder.**
Every one of them rendered as prose, and the gap that left was specific:
`classes.attendance` computed the run of days and then threw it away, so
an owner rebuilt their own week in their head from "busiest was Saturday
with 47".

One vocabulary rather than a renderer per question, which is exactly what
this phase said it would not do — a figure, a short series, a ranked list
(`src/lib/answer.ts`), drawn once (`AnswerFigures`) and filled by any
`ask` action. No chart language was invented because none of the three
forms is a chart: a single value with a change is a stat tile, a run of
counts is bars, a set of names is a list. One series, one hue — the gym's
own brand primary — so there is nothing to tell apart and no legend to
carry.

The prose stays underneath, and one line of it went: the class split was
being drawn *and* written out, which read as two sets of numbers until
you checked they agreed. What the answers refuse to draw is the rest of
the work — no percentage off a base under ten, because the caption
already refuses that comparison; no headline figure when two currencies
came in, because £900 plus €400 is not £1,300 of anything; and no series
from `money.summary` at all, because those reads return period totals and
a trend drawn from one number is the chart that lies.

The original note:

The bar answers about one member. It doesn't answer about the gym:
"how busy was Saturday", "who hasn't been in for a month", "what did we
take last week", "which class is dying". Every one of these is a query
that already exists behind a screen. As `ask` actions they need no new
data — only an entry each, and a way to render a number, a list and a
short series without inventing a chart language per question.

### 5 — Fewer things to say

**Seven retired.** `/management/membership-requests` went first — the
Timeline asks the same question with the same two choices through the same
RPC, and gates those rows on the same capability, so the one role the
screen existed for is served without it. The other six were all the same
shape: a heading wrapped around a panel the Manage screen's Settings tab
already rendered behind the same capability. Leaderboards and Messaging
had nothing in the repository linking to them at all; Branding, Class
types, Health screening and Gym settings were held up only by the
first-run checklist navigating to them, which now opens the section
instead and carries the step key so the owner is still returned to
`/onboarding` when the step completes. Every tile stays and opens its
section first and expanded — a surface that folds into a tab has to stay
findable by the words it was findable by before, or the retirement cost
something.

**The evidence clause is dormant, and saying so matters.** `route_opens`
counts which staff screens get opened per gym per day, with no identifier
of any person in the table. But one gym is not a sample: every screen
reads near-zero and silence still proves nothing — "nobody has opened this
in ninety days" is not yet a fact anybody can establish off a single
tenant. Until there are enough gyms to read, a screen goes only when
something demonstrably does its job, which is the bar all seven actually
met. The reasoning for collecting it at all
is in the lawful-basis register, item 6.

**The baseline is in the repository now.** `src/lib/back-office.ts` holds
every management surface that exists as data, and `RETIRED_ROUTES` the
routes that no longer do with the reason each went — so "routes retired"
is a number a test asserts rather than a claim a document makes. Deletion
is not reversible, so nothing goes without a demonstrated replacement:
the same panel, behind the same capability, reachable by the same words.
Ninety days of silence is the second bar and it is not available yet, so
it is not being used. What also changed is that everything behind the door
is findable by typing, and that two surfaces which had no door at all —
Goals and the Roster — now have one.

**And the bar stopped refusing what it could point at.**
`system.find_screen` searches the same manifest the Manage index searches,
filtered to what the asker can actually open, and offers the way through
as a chip — the bar's worst failure was "I can't do that" when there is a
surface and only the sentence is missing. It offers the door rather than
taking it, which is the standing rule: navigating on somebody's behalf
empties the conversation they were in the middle of. That rule turned out
to be broken in practice — three `ask` actions had been calling
`ctx.offer` into a no-op since they were written, so no chip had ever
rendered.

**And a fifth (0235).** `credits_low_message` tells a member on a class
pack when they are down to their last one or two, while they are still
training. Renewing a pack is the easiest revenue a gym has and the one
most often missed, because noticing it means somebody watching a number
that only ever goes down. Its sharpest rule is the one about *which* plan:
a `credit_period` balance resets every month, so "two left" there is a
normal Thursday, and a note about it would be a nag. Only a pack can
actually run out.

**And a sixth (0241), which is the first one that argues with another.**
`plan_upgrade_offer` notices a member whose pack costs them more than one
of the gym's own memberships would, and says so as the pack runs out. It
fires at the same moment the fifth job does, deliberately: that is when
the member is about to spend money again, and the only moment the sum is
help rather than a pitch. Which means the two jobs would otherwise reach
the same person five minutes apart with "top up your pack" and "don't buy
another pack" — so the sixth replaces the fifth for that member rather
than arriving beside it. The exclusion reads the *status*, so an owner who
says no to the upgrade hands the member back to the top-up nudge on the
next tick; that answer was about the membership, not about the reminder.
The rules that keep it honest are the two arithmetic ones — the
alternative has to cover how much they actually train, and save them at
least a fifth — because a job that upsells on a rounding error is worse
than no job.

**And the gym took on a fourth job (0234).** Everything above makes the
owner's typing cheaper; this is the first thing in a while that makes them
type less. `first_week_message` notices somebody who joined and has never
trained — a gap the other jobs structurally cannot see, because
`agent_retention_tick` joins `class_bookings` on `attended_at is not
null` and so only ever notices people who have trained and stopped.
Stamped from the 0206 framework: same dial, same card, same
owner-approved template. Its four hard rules live in SQL, and the one that
matters most is that it never writes to somebody who came across from
another platform — they may have trained at that gym for years, and
Temple has no idea when, so telling them it noticed they have not been in
is the worst message in the product.

**Phase 5 has a finish line now.** `status` on a Back Office entry said
where a surface sits; it could not tell Coach earnings — which keeps
its screen, because checking pay is evidence — from Tag rules, which is
a form waiting to become a sentence. So the manifest carries `ends` as
well, taken from the sorting rule at the top of this document rather than
from anybody's memory: **keeps** (craft, judgement, evidence),
**moves** (exists so a human can operate machinery), **splits** (routine
path said, deep dive one tap deeper).

The scoreboard reads **13 moves, 9 splits, 5 keeps**, and phase 5 is done
when `moves` reaches zero — not when the list is empty. Five surfaces are
supposed to survive and two of them settled a question by being written
down: the roadmap says Earnings **keeps its screen** because a coach
checking their pay is evidence, and Tasks and SOPs **split** rather than
move, because reading them keeps a screen and only the chasing goes.

**And the first cut it measured took four replacements, not one.** Cover
looked like the clean swap — the ops job has chased the coaches since
0208 — but chasing was never the same as replacing the screen, and the
screen did more than it looked. Seeing what is waiting became
`classes.uncovered`. Handing one class over became
`classes.request_cover`, and a holiday the same sentence with two dates.
Claiming became a Timeline card for exactly the coaches the feed already
gated on `can_claim_cover`, with the claim still first-come in
`claim_cover` rather than an owner's decision. A coach's own outstanding
requests turned out to have been in the feed all along.
Two passes at the bar, and the first one failed: it was written down as
not-earned before it was earned. **Nine retired, one owed.**

**Auditing before building keeps finding the work half-done and the
permissions wrong.** Plans was the third surface in a row where the
sentence half already shipped — `gym.add_plans` creates,
`money.set_plan_price` prices, `plans.include_programming` decides what a
plan carries — and the only verbs genuinely owed were retiring one and
bringing it back (`plans.retire`, `plans.restore`, 0245). Billing was the
same: `require_membership_to_book` had been a rule sentence since the
sheet existed, Stripe Connect is an OAuth redirect and stays a screen, and
what was actually missing was the roadmap's own words — *connection health
becomes a Timeline receipt when something needs attention*. Insights is
the one where the audit says the opposite: the five questions
(`money.summary`, `classes.attendance`, `members.quiet`, `store.sales`,
`leads.pipeline`) all draw their numbers already, so **pull is done and
push is the whole remaining job** — the numbers arriving without being
asked for, which is a job on the rope, not another chart.

What the audits keep turning up alongside the work is one bug wearing
different clothes: a switch an owner can see and a server that ignores it.
Six more instances this pass. `archive_plan`, `restore_plan` and
`delete_plan` asked `user_is_owner_of` while their buttons were gated on
`can_archive_plans` and `can_hard_delete` — a granted admin refused.
`archive_class_type`, `restore_class_type` and `delete_class_type` asked
`user_can_admin_or_coach`, which happens to equal `can_archive_classes` at
its default and ignores a revocation entirely — an owner who took the
permission away still had coaches who could use it. And two actions were
advertising capabilities their own writes could not honour:
`gym.change_rules` offered every coach a settings change behind eight
owner-only setters, and `gym.close_dates` offered coaches a week-long
closure that `close_gym_dates` has always gated on
`can_bulk_edit_classes`. The RPC half is 0245; the vocabulary half is
`ActionSpec.roles` and an `actionsFor` that takes the caller's role.

**And the audit named the next job.** Insights' pull half being finished
meant the missing half was push, and push in this codebase has a shape
already: a job on the rope. `class_return_message` (0246) is the seventh,
and the first that proposes about a *class* rather than a person — a slot
that has clearly thinned out, and an offer to ask back the regulars who
stopped coming to it. What makes it a new job rather than a second
retention is a positive rule: it only writes to people who are **still
training here**. Somebody who stopped altogether is retention's and gets
retention's sentence; somebody who trains three times a week and has
quietly dropped one class is invisible to every other job, because every
other predicate is satisfied by them attending anything. It is also the
framework's first fan-out — one tap, up to twelve emails — which is why
it takes one slot a day where the others take three, and why
`_agent_execute_action` now keys its outbound rows per recipient. The
measure it moves is the second one, and it is the first thing built that
moves it without the owner typing at all.

**The seven settings sections came to four sentences and one cut.** The
audit found the same shape a fourth time: two of the seven were already
done — Leaderboards is `leaderboards_on` and Messaging is `dm_scope`, both
sentences in the rule sheet since the sheet existed. Only Messaging could
be *cut*, because `set_dm_scope` is owner-only and the sheet already
serves every person the section did; `set_leaderboard_config` is the one
rule setter gated on a capability rather than on being the owner, so
deleting its panel would take a permission away from an admin who holds
`can_configure_leaderboards`. It stays owed until the rules can be spoken
by somebody who is not the owner, which is a real design question and not
a chore.

Three more were shown to people the database refuses — Gym settings,
Branding and Messaging on `can_manage_staff`, with nine owner-only setters
behind them. That is the tenth instance of one bug, and the count is the
point: a switch an owner can see and a server that ignores it is not an
oversight this codebase made once.

**And "moves" got a definition.** A section folding into the rule sheet
takes its words with it, and the words need somewhere to land — the
manifest's own guard says a folded surface "has to stay findable by the
words it was findable by before, or the retirement cost something", and
retiring Messaging made a search for "dm" return nothing. So the sheet is
a destination now: `/timeline?rules=1` opens it and it has a manifest row
carrying the keywords of every rule it speaks. That is what unblocks the
rest of the settings burndown — each section that folds points its words
at the sheet instead of losing them.

**And then the burndown turned out to be counting the wrong thing.** Eleven
surfaces read as owed. Nine of them had already moved. `ends` records where
a surface is *going*; nothing recorded whether it had got there, so a
finished move counted against the scoreboard forever and the only way to
reach zero was to delete the manifest — which is not what `moves` means.
The roadmap's own definition is that the interaction becomes a sentence and
the screen **demotes to the Back Office**, which is exactly where all of
them already sat.

So the manifest gained `movedTo`: the actions that took each surface's job.
Named rather than a boolean, because a boolean is a claim and a name is
checkable — a test asserts every one exists in the registry, so deleting an
action re-opens the surface it was closing instead of leaving a lie behind.
Insights, Attendance, Tag rules, Plans and Closures needed nothing at all;
Branding and Class types needed one verb each (`gym.rename`,
`classes.rename_type`); Billing needed one rule field
(`members_can_self_checkout`, now a sentence in the sheet like every other
rule). Health screening was reclassified to **keeps** — a waiver is a PDF
somebody signs with their own hand and a PAR-Q is a questionnaire being
authored, so neither was ever going to become a sentence.

**One is left, and it is blocked rather than unbuilt.**
`set_leaderboard_config` is the only rule setter gated on a capability
rather than on being the owner, so its panel is the single door an admin
holding `can_configure_leaderboards` has. Deleting it would take a
permission away. It moves when the gym's rules can be spoken by somebody
who is not the owner — a product decision, not a chore.

The endpoint is not an owner typing more. It's the gym telling them what
needs deciding, and the answer being one tap. Every job that graduates
from asking to acting removes sentences. The measures stay what they
were: **routes retired** and **owner interventions per member per
month**. A screen deleted is progress; a screen rebuilt prettier is not.

## Known and not yet fixed

Bugs found while building the modules that could not be closed in the
same change, either because there is no write to fix or because the fix
is a feature. Written down rather than left in a commit message, so the
next session finds them.

- **`email.failed` is not mapped, so a send that never left counts as
  sent.** `resend-webhook` maps three event types — delivered, bounced,
  complained — and acknowledges everything else with `200 ok, ignored`.
  `email.failed` means Resend could not send at all, and those recipients
  keep whatever status the sender wrote, which is `sent`. The campaign
  report's `failed` column exists and is drawn (`Never sent`, "rejected at
  the door"), but only ever fills from a synchronous rejection at send
  time — an asynchronous failure reported afterwards has no path into it.
  Spotted while wiring the webhook up and deliberately not fixed mid-setup.
  The fix is a fourth branch in the event map plus a status the RPC will
  accept; the care needed is in not double-counting a recipient that both
  failed and later bounced.

- **The timetable's own tables are gated on a role, not a capability.**
  `class_sessions`, `class_types` and `class_recurrences` all write behind
  `user_can_manage_classes`, which is `role in ('owner','admin','coach')`
  with `left_at is null` — correct and well-maintained (0236), but a role
  check where the screens in front of it ask `can_edit_classes`. At the
  defaults the two agree exactly, so nothing is wrong today; revoke
  `can_edit_classes` from coaches and the buttons vanish while the tables
  keep saying yes. Same shape as the archive family fixed in 0245, and the
  eleventh instance of it. Not fixed with the phase-5 close because it is
  three tables and roughly a dozen policies rather than six functions, and
  it deserves its own change with its own pgTAP rather than riding along
  with a burndown.

- **`extend_recurrence` has no horizon.** Found while auditing the
  settings panels. It is `security definer`, granted to `authenticated`,
  and guarded only by `user_belongs_to` — which is *deliberate* and
  documented in 0005: the member calendar materialises the timetable
  lazily on view, and RLS would otherwise block it. The gate is right.
  What is missing is a ceiling on `until_date`: `end_at := least(until_date,
  coalesce(rec.ends_on, until_date))`, so an indefinite recurrence with a
  far-future date materialises everything in between. Any member of the
  gym can pass `2099-12-31` and write thousands of bookable sessions into
  their own gym's timetable. Not fixed here because picking the ceiling is
  a judgement call with a silent-truncation failure mode on the other
  side: `close_gym_dates` legitimately reaches a year out through
  `extend_gym_recurrences`, staff scroll the calendar ahead, and a clamp
  that is too tight quietly stops materialising with no error. Roughly two
  years is probably right, and it wants a pgTAP that pins both the clamp
  and a legitimate long closure still working.

- **Does leaving a gym cut you off from your own training record? —
  answered (0237).** It was written here as an open question; it is not one
  any more. The tracking product is sold separately, so the history is part
  of what the athlete tier buys: the `tracked_*` read policies now want
  current membership or an active subscription, and the record itself is
  never touched. Two things fell out of settling it. The old worry was
  backwards — the read path never called `user_belongs_to`, so guarding it
  cost nobody their history and closed a hole where somebody who left kept
  logging into the gym they left, free. And gating a *product* is not
  gating a *right*, so `export_my_training_history()` ships alongside:
  complete record, free, no subscription, `security definer` so it answers
  when the policies do not. One thing 0237 broke on its own and 0238 fixed:
  gating the rows also gated the *count*, so the screen selling the tier
  showed an empty state to somebody with years logged.
  `my_training_summary()` returns counts and a date span and no training,
  so the card can say what is behind the lock without giving it away.

- **Email reports a number nobody should trust — built (0229).** All four
  decisions below are implemented: a signed `resend-webhook` function, an
  `email_suppressions` table subtracted from every audience, a
  `delivery_tracked` marker flipped by the first real event, and a
  `comms_campaign_stats` that returns sent / delivered / successful
  separately. Live on all three surfaces. **The two operator steps are
  now done**: the signing secret is set and the endpoint is registered
  against `email.delivered`, `email.bounced` and `email.complained`, and
  the first real send came back measured. That also lit up the suppression
  check added to `send-agent-messages` — `email_suppressions` can finally
  be populated, so the six senders that consult it are consulting
  something.

  The first measured send exposed the report itself. Seven stat tiles drew
  unconditionally, four of them percentages, so one recipient read
  "SUCCESSFUL 100%" — not a rate, a way of spelling "1". Rewritten around
  three rules in `src/lib/campaign-report.ts`: the value is a count, a
  rate appears only at ten or more, and a tile for something that did not
  happen is absent rather than zero.

  The transactional senders honour it too, since
  `_shared/suppression.ts`: class changes, cover, payment notices and
  automation sequences all load the gym's suppression list once per drain
  and record a skip with the reason rather than mailing a dead address and
  collecting a provider refusal. Done at the dispatcher rather than in the
  eight enqueue functions — suppression is a fact about delivery, not
  about whether the notice should exist, and one shared helper beats eight
  verbatim restatements.

  The original finding, kept for the reasoning:
  `email_campaign_recipients` has carried `delivered_at`, `open_count`,
  `click_count`, `unsubscribed_at`, `provider_message_id` and a status of
  `queued|sent|delivered|simulated|bounced|failed|skipped` since 0044, and
  `email_events` has kinds for `delivered`, `bounce` and `complaint`. The
  columns were built for a provider webhook that was never stood up. So
  `send-campaign` writes `sent`/`failed`, the tracking pixel writes opens
  and clicks and *infers* `delivered` from an open — and **bounce rate is
  structurally zero**, not low. "Received" is really "opened", which
  under-reports by however much image blocking costs you. On top of that,
  a send that reaches nobody flips to `failed` and tells no one.

  Four decisions, all the owner's:

  1. **Successful means delivered and not bounced.** The honest measure of
     the send itself and the only part the gym controls; opens and clicks
     sit underneath as engagement rather than being folded into one
     flattering figure.
  2. **A hard bounce suppresses the address and says so.** Repeatedly
     mailing dead addresses is what wrecks a sender reputation and starts
     putting everything in spam. Suppression is not an unsubscribe and
     must not share its table — one is "we cannot reach you", the other is
     "you asked us to stop", and they have different remedies.
  3. **Tracking starts now; older sends say so.** Everything from the
     webhook onward is real. Campaigns sent before it keep their
     sent/opened/clicked and mark delivered and bounced *not tracked* —
     a real zero and an unmeasured zero are different facts, and only one
     of them is good news.
  4. **Three surfaces:** the campaign report screen, an answer in the bar
     ("how did the Christmas email do"), and a quiet Timeline line when a
     send finishes — which is also what closes the reaches-nobody case.

- **The talk bar is owner-only while the registry speaks staff.** The
  Timeline renders its whole bottom block — chips and bar — behind
  `isOwner`, yet `actionsFor(can, role)` filters the catalogue per staff
  capability and several actions exist precisely for coaches (cover,
  attendance, check-in). Either the bar should render for staff with
  their filtered vocabulary, or the per-role plumbing below it is
  serving one person. Found when the coach e2e journey waited for a bar
  that can never come. A product decision, not a bug: the answer decides
  whether "the chat is the spine" means the owner's spine or the gym's.

- **Four pgTAP files fail in the local harness for the harness's own
  reasons** (storage path helpers, recurrence pattern rewrite, closure
  reopen, ordered onboarding responses) — listed in
  `scripts/pgtap-local/README.md`. They pass in CI against real Supabase.
  A failure anywhere else is real.

## What deliberately doesn't move

Worth restating, because a catalogue this general invites overreach:

- **The member app.** Members feeding the system its data is what makes
  every loop possible, and it works. Anything new there is additive.
- **Craft surfaces.** Writing programming, building a page, authoring a
  product, listening to a call. The bar reaches them; it doesn't replace
  them.
- **Health and the law.** Consent, waivers, PAR-Q, erasure, the access
  audit log. No loop touches any of it, no action wraps any of it, and
  the member card in the chat carries no health data by design.
- **Authorisation.** The capability filter on the registry is a courtesy
  to the model — it stops the bar offering what someone can't do. The
  write still runs in that person's own session against RLS, which is
  what actually decides. That stays true however large the catalogue
  gets.
