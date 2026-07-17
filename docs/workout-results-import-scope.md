# Workout-results import — scope

The workout-history importer (`/management/members/import-workouts`)
ingests **weighted movements**: one row = a movement + reps + weight +
unit, written to `tracked_movement_results`. Fed a CrossFit/Hyrox
export instead — benchmark times, AMRAP rounds, race splits — it can't
represent the scores, so the data drops.

This documents extending it to import **scored results**. The good
news: the data models already exist — this is mostly mapping + grouping,
not new schema.

## Models already in place

- `tracked_workouts` — per-member, per-date parent. The importer
  already get-or-creates one per (profile, date).
- `tracked_workout_sections` — carries `section_category`,
  `section_format`, `title`, and aggregate columns
  (`total_time_seconds`, `total_rounds`, `total_extra_reps`,
  `did_not_finish`). Formats include **`for_time`** and **`amrap`**
  (both aggregate-first — populate the totals, no entries; the
  "aggregate invariant" in 0025). So Fran, Grace and Cindy have a
  native home with no new schema.
- `tracked_hyrox_races` + `tracked_hyrox_splits` (0096) — races with
  per-station splits. The CSV's Hyrox rows are the standard shape
  (8 runs + 8 stations + roxzone + total).
- Today's importer only writes the weighted `tracked_movement_results`
  path.

## How a results CSV maps

| Rows | Score Type | Target |
|---|---|---|
| Fran, Grace | `FOR_TIME` (mm:ss) | `for_time` section, `total_time_seconds` |
| Cindy | `FOR_ROUNDS_REPS` (`19+7`) | `amrap` section, `total_rounds` + `total_extra_reps` |
| Back Squat 1RM | `FOR_WEIGHT` (kg) | existing weighted path — needs the name to resolve to a movement |
| Hyrox London | `TIME` per segment | one `tracked_hyrox_races` + a `tracked_hyrox_splits` per station |

## Phasing

### Phase A — scored WOD sections (BUILT)

For-time and AMRAP benchmark results → `tracked_workout_sections`
(`section_category = 'wod'`). Sections are **title-based**, so the
workout name lands as the title with no movement vocabulary needed.

- Client (`workout-columns.ts`): `score_type` / `score_value` fields,
  `parseTimeToSeconds`, `parseRoundsReps`, and a row-router that splits
  each row into weighted | section | deferred (Hyrox/time) buckets by
  score type.
- RPC `import_member_results` — writes sections, get-or-creates the
  same (profile, date) parent, dedups on (workout, format, title),
  owner-gated.
- Screen previews and commits both the weighted and section paths;
  Hyrox/time rows are counted and flagged as "coming in a later step."

### Phase B — Hyrox races

Group the per-segment rows by (email, event, date) into one
`tracked_hyrox_races` + a `tracked_hyrox_splits` per station. This is
the structurally new bit — today one CSV row = one result; a race is
many rows collapsed into one entity. Station names (SkiErg 1000m, Sled
Push 50m, Roxzone, Total) map to the fixed Hyrox station set.

### Phase C — benchmark leaderboards (optional)

Give imported benchmarks a canonical identity (Fran = the named
benchmark, not just free text) so a cross-member "Fran leaderboard"
works. Only needed once someone wants leaderboards over imported data;
Phases A/B land the data without it.

## AI name-resolver (folds into Phase A/B)

The "unknown movement" wall is fuzzy entity resolution — "Fran" → a
benchmark, "Back Squat 1RM" → `back_squat`, "SkiErg 1000m" → the Hyrox
ski-erg station. A curated alias list can't keep up with every gym's
naming; the model is good at exactly this.

Reuse the existing `infer-import` edge function (the members importer's
AI mapper) with a new `mode: 'resolve_movements'`:

- **Input is deduped names only** — the distinct unmatched values (a
  few dozen strings), never per-member rows. Movement/benchmark/station
  names are generic gym vocabulary, not PII, so unlike the members
  mapper (which sends only column *shape*) we can send the actual
  names. No member linkage; tiny, cache-friendly call.
- **Output**: each name → `{ movement key | benchmark | hyrox station |
  unknown }`, with a confidence.
- **Deterministic fallback always** — if the key is unset or the call
  fails, fall back to the vocab matcher, exactly as `infer.ts` does
  today. AI proposes; the vocab + owner disposes.
- **Owner-in-the-loop for leaderboard-feeding identities** — surface AI
  resolutions in the preview for confirmation rather than
  auto-committing, and record accept-vs-override via the existing
  corrections loop (`buildCorrectionRows`) so it learns per gym.

Where NOT to use it: parsing the scores themselves (`FOR_TIME` + `3:12`
→ 192s is exact) and column mapping (deterministic auto-detect covers
it). AI earns its place only on name resolution.

## Open decisions

- Rx/Scaled/Division/Pro columns — store on the section (as a note or
  tag) or drop. Lean: note.
- Real-world messiness already seen: a run split written `34:12:00`
  but labelled `mm:ss` — parsers must tolerate mislabeled units.
- Re-import idempotency: a deterministic section/race key so a second
  run doesn't duplicate (Phase A dedups on workout+format+title).
