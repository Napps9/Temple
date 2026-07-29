# Loop 1: payment recovery — implementation spec

The first autonomous loop from `docs/vision.md`, and the template-stamping
exercise that proves the bridge: take the Front Desk's anatomy (tool loop →
closed tool set → service-role RPCs → operating brief → guardrails →
human-reserved edges) and point it at the Revenue teammate's first job.

Today, dunning ends at a human. `0174_failed_payments.sql` opens with its own
mission statement — "see them, chase them, stop counting them" — and delivers
exactly that: the system sees the failure, notifies the member once, splits
the money out of the forecast, and then renders a staff list named "Needs
chasing". This loop closes the gap between *seen* and *chased*: the agent
works the case, the owner approves the judgement calls in the Timeline, and
the outcome lands as a receipt ("Recovered £74") instead of a to-do.

---

## The loop

```
trigger    invoice.payment_failed already lands in stripe-webhook →
           _record_payment_failure writes the dunning row
decision   the Revenue teammate opens a case, picks the next move from a
           deterministic policy (below); model drafts only message copy
action     a personally-timed chase email, or a proposed plan adjustment
guardrail  authority dial per action kind; caps on touches, hours, offers;
           never cancels; sent messages cannot be model-improvised —
           owner-approved templates only
outcome    recovered / adjusted / lapsed / left, closed by the hooks that
           already exist (_clear_payment_failure, leave_gym)
memory     outcome per case, so "what worked here" compounds
```

## What already exists (reuse, do not rebuild)

| Substrate | Where | Role in the loop |
|---|---|---|
| Dunning state: `past_due_since`, `payment_failure_count`, `last_payment_error`, `next_payment_attempt` | `plan_subscription_dunning` (0176 — moved off `plan_subscriptions` so decline reasons sit behind `can_see_money`) | The sensor. Presence of a row IS an open case candidate |
| `_record_payment_failure` / `_clear_payment_failure` | 0174 | Case open/close hooks — recovery already deletes the dunning row; the loop listens to both |
| Member notices: instant in-app + one email per dunning run, final notice, recovery unsend | `payment_notifications` + `send-payment-notifications` (0175) | Touch 1. Unchanged. The agent never duplicates it |
| Plan-kind-aware copy rules (unlimited / credit_period / programming_only) | 0176/0191 | Constraints the agent's drafts must satisfy |
| "Needs chasing" list | `gym_overdue_memberships` (0174) | Becomes the loop's worklist; the screen survives as evidence, demoted from to-do |
| Pay-now bearer links, self-only RLS | `membership_invoice_links` (0174) | Every chase message links here; the agent never sees the URL contents |
| Worker auth: Vault worker secret + shared caller | `_shared/caller.ts`, 0199 | The new worker authorises exactly like the existing dispatchers |
| Queue-as-audit-log pattern, idempotency keys, `skipped`-not-dropped | `cover_notifications` (0165) | The shape of `agent_messages` |
| Sweep observability | `cron_run_log` (0189/0190) | The new cron logs what it did like every other |
| Capability resolution | `effective_can`, `src/lib/can.ts` | Gates the Timeline surface; `can_see_money` for v1 |
| Tool-loop + Anthropic client conventions | `_shared/lead-agent.ts` | Copy drafting reuses the client util and the brief-reading pattern |
| Retention purge discipline | `purge_expired_payment_data` (0177) | Model for TTLs on the new tables |

## New schema (one migration)

**`agent_actions`** — the ledger seed. The Timeline renders this table
directly: `status = 'proposed'` rows are inline approval cards, terminal
rows collapse to one-line receipts. A decision can therefore never escape
the audit trail — the ask and the record are the same row.

- `id`, `gym_id`, `teammate` (`'revenue'` for now), `action_kind`
  (`'chase_message' | 'plan_adjustment_offer'`), `subject_profile`,
  `subject_subscription`, `payload jsonb` (the concrete proposal),
  `evidence jsonb` (deterministic, SQL-derived sentences — never
  model-authored), `status`
  (`'proposed' | 'approved' | 'rejected' | 'executed' | 'expired'`),
  `proposed_at`, `decided_by`, `decided_at`, `executed_at`.
- RLS: staff read gated on `effective_can(gym_id, 'can_see_money')`; no
  client INSERT/UPDATE at all — writes go through RPCs.

**`agent_authority`** — the dial. `gym_id`, `action_kind`, `level`
(`'autonomous' | 'approval' | 'reserved'`), `updated_by`, `updated_at`.
Seeded `'approval'` for both kinds when the teammate is enabled. The row's
existence doubles as the per-gym feature flag: no rows, no Revenue teammate.
"Always allow" in the Timeline flips one kind to `'autonomous'` — an owner
action through an RPC, never automatic.

**`agent_cases`** — case state across Stripe's two-week retry window.
`gym_id`, `subscription`, `opened_at`, `stage`
(`'watching' | 'touch_2_sent' | 'offer_pending' | 'closed'`),
`outcome` (`'recovered' | 'adjusted' | 'lapsed' | 'left' | null`),
`closed_at`. One live case per subscription (partial unique on open cases).

**`agent_messages`** — outbound queue + audit, on the `cover_notifications`
pattern: in-app row delivered instantly, email enqueued and drained by a
worker, blanket unsubscribe recorded as `skipped` for email but never
suppressing the in-app half — except this queue follows 0175's stance, not
the marketing stance: a failing payment is not marketing, so only the
member-level do-not-email flag is honoured, deliberately not the campaign
unsubscribe.

**Message templates** live on the gym (`agent_message_templates`: kind,
body, `approved_by`, `approved_at`). The model drafts a template from the
operating brief and the 0176 wording rules; the owner approves it once in
the Timeline; after that, sends fill placeholders (name, plan, link) with no
model in the send path. No model-improvised text ever reaches a member.

## RPCs

Service-role only, tenancy derived server-side, the `agent_capture_lead`
shape:

- `agent_open_payment_case(subscription)` — idempotent; refuses if no
  authority rows (teammate not hired).
- `agent_propose_action(case, kind, payload, evidence)` — writes
  `agent_actions`; if the kind's authority is `'autonomous'`, marks approved
  and returns immediately executable.
- `agent_execute_action(action)` — the only path that touches the world:
  enqueues the message, or applies the plan change via the existing
  plan-assignment path. Refuses anything not `approved`.
- `agent_close_case(case, outcome)` — called from the
  `_clear_payment_failure` hook (recovered), the plan-change path
  (adjusted), `leave_gym` (left), and the sweep (lapsed).

Authenticated, capability-gated:

- `decide_agent_action(action, decision, always_allow)` — owner/`can_see_money`;
  `always_allow` flips `agent_authority` for that kind in the same
  transaction, so the graduation is itself a ledgered decision.

## Decision policy (v1 — deterministic skeleton, model only for words)

1. **Touch 1** — the existing 0175 notice. Untouched, system-sent, instant.
2. **Touch 2** — chase message. Opens when `past_due_since` is 3+ days old,
   `next_payment_attempt` is still ahead, and no touch-2 exists for this
   run. Warm tone, references the Pay-now link, plan-kind-correct wording.
   Authority default: `approval` (first few sends build trust, then the
   owner flips it).
3. **Touch 3** — the judgement moment. When Stripe gives up
   (`next_payment_attempt` null, the same signal 0174 calls "urgent rather
   than routine"): propose either a final personal note or a plan
   adjustment — a cheaper existing plan chosen from actual attendance
   (booking history / class-type usage, the same data the affinity model
   reads). This is the approval card in the Timeline mockup. Authority:
   `approval`, and plan adjustments stay approval-gated until the owner
   explicitly says otherwise.

Hard rules, enforced in SQL not prompts: never cancel a membership; offers
are existing cheaper plans only, no invented discounts; maximum 2 agent
touches per case (3 messages total including the system notice); sends only
09:00–20:00 gym-local; one open case per subscription; respect the
`payment_final_notice` — the agent's touch 3 replaces nothing, it follows.

## Surface (v1): the Timeline

The owner's work here is one workflow — catch up on what happened, decide
what needs me, see what the AI did — so it gets one surface, not three.
Catch-up, approvals and the audit trail are the same chronological stream.

- **`/timeline`** in the staff group, a new pill in the staff `TopNav`
  (badge = open questions). The stream renders straight off `agent_actions`
  and `agent_messages`, newest at the bottom like a conversation:
  - **Updates** — plain prose from one sender, Temple ("I got £74 back
    from two failed payments"), no card chrome, no labels. Derived from
    executed actions and closed cases; nothing is authored separately for
    display. Which teammate acted is a detail, shown only inside the
    detail view — the owner talks to Temple, not to an org chart.
  - **Questions inline** — `proposed` rows render as the only card in the
    stream: a one-line question ("Move Emma to the smaller plan?"), one
    sentence of plain-English reasoning, a "See the details" disclosure
    (the deterministic evidence lives there, not on the surface), and two
    choices — a labelled yes ("Yes, move her") and "No". Adjusting the
    proposal and "always allow this" (offered after the same kind has
    been approved 3 times, counted from `agent_actions`) live inside the
    detail view, not on the card.
  - **Receipts** — terminal rows collapse to one soft line ("Marcus's
    pause — sorted, with 2 free classes"). Scrolling back is the record;
    there is no separate audit screen to build or forget.
- **The talk bar** is the stream's input. v1 scope is narrow and honest:
  free text files onto the relevant case and the agent answers on its next
  tick, reusing the lead-conversation machinery — case questions and
  "hold off on messaging her" work; general gym admin does not yet.
- **Money block** gains one line: "Recovered £X this month" from
  `agent_cases` outcomes — the same receipt, where the money already lives.
- No separate morning brief: the vision's Brief is simply the Timeline's
  opening entry of the day, and it gets rich when more loops can report
  (Bridge phase 3).

### How Temple talks

The audience is a gym owner, not an operator of software — "we're not good
with computers" is a direct quote from the research. Content rules, applied
to templates and update strings alike, and enforceable in review because
the strings are few:

- One idea per message. If a sentence needs an "and", it is usually two
  messages.
- First person, plain words, present tense. "I got £74 back", never
  "Payment recovery completed".
- No system vocabulary anywhere an owner can see it: no case, dunning,
  proposal, subscription, RPC, teammate. Money is "£30 less each month",
  not "£59 (down from £89)".
- A question offers exactly two choices, and the yes is labelled with the
  action ("Yes, move her"). Every extra option is cognitive load moved
  from us to the owner.
- Reasoning is one sentence; evidence is behind "See the details". The
  card earns trust by being right, not by showing its working unasked.
- Numbers appear inside sentences, never as bare figures with labels.

## Worker + cron

`send-agent-messages` edge worker on the dispatcher pattern (Vault secret,
`cron_run_log`, per-message idempotency, 3 retries). One new pg_cron job,
`agent-revenue-tick`, hourly: advances cases past their stage gates, opens
new ones from dunning rows, expires proposals older than 7 days
(`status = 'expired'`, surfaced as a Timeline receipt — silence is not
allowed to look like a decision).

## Tests

pgTAP, following `supabase/tests` conventions (`_helpers.psql`, act-as,
drive fixtures through RPCs):

- authority: proposal with `'approval'` cannot execute unapproved;
  `'autonomous'` executes; `'reserved'` refuses even when approved.
- caps: third agent touch refused; quiet-hours refused; second open case
  refused.
- close hooks: `_clear_payment_failure` closes the case `recovered` and
  expires open proposals for it.
- RLS: member cannot read `agent_actions`; coach without `can_see_money`
  cannot read or decide; `decide_agent_action` with `always_allow` writes
  the authority flip atomically.
- templates: send path refuses an unapproved template.

Vitest: always-allow counting, card payload rendering, evidence formatting.

## Rollout

Demo gym first (`@demo-ironworks.temple.test` accounts, nothing routes out),
with a manufactured failing invoice via Stripe test clocks. Then hired
per-gym: enabling the Revenue teammate writes the `agent_authority` rows —
presented as the Roster's offer-letter moment, even before the Roster screen
exists.

## Out of scope (v1, deliberately)

Member SMS and push (loop 3 owns push); the Morning Brief; the Roster
screen; other teammates; a `gym_agent` database role (the worker-secret
pattern is sufficient until the ops tool API grows); full `audit_events`
unification (`agent_actions` is its seed, not its replacement); platform
metering for agent usage.
