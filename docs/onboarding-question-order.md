# Onboarding question ordering — Phase 4 contract

## Why this exists

Tier 6 (Phase 3) ships the **non-health** half of the onboarding flow:
`public.onboarding_responses` stores answers to questions like *goals*,
*how-did-you-hear*, *emergency contact*, *kit size*, etc. The table
includes an explicit `display_order int` column, and every read surface
sorts by it.

PAR-Q answers are deferred to **Phase 4** because PAR-Q data is Article 9
special-category health data — it can only land alongside the GDPR
controls (consent capture, retention policy, access asymmetry) that
Phase 4 introduces. `gym_memberships.par_q_id` is the orphan FK that
will resolve when the table lands.

## The contract

When Phase 4 lands `public.health_screenings` (or whatever it's called),
the question table **must** carry a `position int` column (or a
`display_order int` — match the existing onboarding_responses name for
consistency) and **every display surface must sort by it**.

This is not a "nice to have." A jsonb blob's key iteration order is
**not** guaranteed in Postgres — even when the values are stable, the
visual order can flip between client reads. Explicit ordering is the
only correct shape.

## Read-surface checklist

When implementing the Phase 4 health screening UI:

- [ ] Member onboarding form renders questions `ORDER BY position`.
- [ ] Staff member-detail page (`src/app/(staff)/management/members/[profile].tsx`)
      renders health responses `ORDER BY position`. (The non-health
      responses section already does this against `onboarding_responses.display_order`.)
- [ ] Any CSV / PDF export sorts by `position`.
- [ ] If the question template is editable, edits do NOT renumber
      existing responses — like `onboarding_responses.question_text`,
      `position` should be snapshotted at answer time so a later
      question reorder doesn't rewrite history.

## Mirror onboarding_responses' design

The Tier 6 table is the model:

```sql
create table public.onboarding_responses (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null references public.gyms(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  question_key    text not null,
  question_text   text not null,   -- snapshot
  answer          text not null,
  display_order   int  not null,   -- snapshot
  answered_at     timestamptz not null default now(),
  unique (gym_id, profile_id, question_key)
);
```

Health screenings will likely diverge in shape (multiple answer types,
maybe a separate `health_question_definitions` table), but the
`position`/`display_order` contract carries over.

## What Tier 6 does NOT ship

- A member-facing onboarding form. Members can't fill in
  `onboarding_responses` themselves yet — Phase 2 §2.4 owns that flow.
- An admin question-template editor. Owners can't currently configure
  which onboarding questions to ask. For Tier 6, responses are
  expected to be populated by a future form (or via SQL seed during
  setup).
- Health questions of any kind. Those land in Phase 4 alongside the
  GDPR cascade.
