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

### The website — craft keeps its canvas

The builder's canvas editing **keeps its screen**. The admin around it —
publish checklists, domain status, SEO housekeeping — becomes go-live
steps and Timeline receipts ("your domain verified overnight").

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
badge sources fold into the same stream. The two dead capability switches
(`can_issue_override`, `can_issue_comp_grant`) **retire**. PWA branding,
light/dark, the crash screen, BackLink, RLS, the capability matrix: load-
bearing substrate, untouched.

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
  so both were fixed underneath rather than papered over. **Still absent:**
  changing a class's coach — claim_cover is self-claim only and there is
  no reassignment write anywhere — and a single-class reschedule, which
  today can only be expressed as a relative shift that silently rewrites
  the whole recurrence. Both need their own fix before the bar offers
  them.
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
  each option. **Still absent:** refunding a shop order — `store_orders`
  has no refund path at all, in the app or in an edge function, so
  there is nothing to wrap — and refunding a single booking's credit,
  which `remove_member_booking` already does as part of taking someone
  out rather than as a verb of its own.
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
  voice, which is closer to craft than to admin. **Decided, not yet built:** the
  whole pipeline is gated on `can_assign_plan`, described to owners as
  "Put members onto plans and adjust subscriptions" — the wrong switch for
  a sales board. It gets split into its own capability, defaulting to
  exactly who holds it today (owner, admin, coach, front desk), so nothing
  changes on day one and the switch finally says what it does. New key in
  `default_capability` and `can.ts`, a row on the Team screen, and the
  five lead RPCs plus the four verbs move onto it.
- **Team and tags** — done for what has a write. `team.invite` ("invite
  Sam as a coach, sam@example.com") over the existing `send-invite`
  function, `team.who`, and `tags.add_rule` — the other half of
  `members.tag`, which labels one person where this describes a kind of
  person and lets the sweep find them from now on. The rule runs
  immediately rather than waiting for the nightly pass, so the receipt can
  say how many it caught. **Still absent:** changing somebody's role and
  taking somebody off the team. Neither has a write anywhere in Temple —
  no RPC, no screen, no client update — so both are in the known list
  below rather than offered as verbs that would fail. **Settled, and the one
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
  card renderer, not an argument list, and it is the next piece of work
  here rather than a gap.
- **Website** — the hardening landed (0220), the verbs did not. Publish,
  unpublish, connect a domain, check DNS and the SEO fields are all
  sentence-shaped with real writes behind them, and are the next push.
  What went first is the reason they can be honest: hiding a plan from
  your website hid it from the page and not from the server, so a verb
  offering that would have sold a privacy the server did not provide.

### 3 — It remembers what you just said — half done

Every sentence currently goes up alone. The bar sends the text and the
catalogue and nothing else — no previous turn, no subject, no history. So
"show me Marcus" followed by "put him on Unlimited" cannot work, and the
owner has to name him twice. That is the single largest gap between what
this is and what it feels like it should be, and it is not a model
problem: the conversation is simply never sent.

Three things, in order of how much they change the feel:

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
- **One sentence, several actions.** "Cancel Friday's 6am and move
  everyone to Saturday" is two actions with an order between them.
  Chaining needs memory to sequence, which is why it belongs here rather
  than in the module work. Now unblocked — the store it was waiting on
  landed with 0221.

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

### 4 — Ask anything

The bar answers about one member. It doesn't answer about the gym:
"how busy was Saturday", "who hasn't been in for a month", "what did we
take last week", "which class is dying". Every one of these is a query
that already exists behind a screen. As `ask` actions they need no new
data — only an entry each, and a way to render a number, a list and a
short series without inventing a chart language per question.

### 5 — Fewer things to say

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

- **No way to change a class's coach.** `claim_cover` is self-claim only
  — a coach takes an open cover request. Nothing anywhere reassigns a
  session from one coach to another, so "give Tuesday 6am to Sam" has
  nothing to wrap. Needs an RPC before it can be a sentence.
- **No single-class reschedule.** Moving one class can only be expressed
  today as a relative shift through `bulk_edit_sessions`, which rewrites
  the whole recurrence — so "move next Tuesday's 6am to 7am" silently
  moves every Tuesday. The bar refuses it rather than doing the wrong
  thing; the fix is a per-session move that leaves the pattern alone.
- **No way to change somebody's role, or take them off the team.**
  Nothing in Temple writes `gym_memberships.role` after the invite is
  accepted, and nothing sets `left_at` from a staff surface — `leave_gym`
  is the member's own door. So "make Jo an admin" and "Marcus has left"
  both have nothing to wrap. Two RPCs, and the role one needs the same
  owner-only ladder `create_invite` already has, or an admin could
  promote themselves.
- **Shop orders cannot be refunded at all.** `store_orders` has a
  `refunded` status that nothing writes: no screen, no RPC, no edge
  function. Membership refunds go through `stripe-refund`; the shop has
  no equivalent. Until it does, `money.refund` is deliberately scoped to
  memberships and says so.
- **A scheduled send that reaches nobody tells nobody.**
  `_send_due_campaign` flips the campaign to `failed` when the audience
  resolves to zero rows at send time, and nothing writes a notification,
  a timeline event or an email. The owner finds out by going to look.
  The audience *definition* is frozen at schedule time; the rows are
  resolved at send time, so a tag emptied in between is exactly how this
  happens.
- **A send already going out cannot be stopped.** Once the sweep flips a
  campaign to `sending`, there is no abort, no recall and no path to the
  `cancelled` status the CHECK constraint allows — the only escape is the
  ten-minute recovery path. `comms.cancel_send` reports losing that race
  rather than pretending to win it, which is the honest half of the fix,
  not the whole one.
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
