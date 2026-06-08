-- Programming sections grow two new keys:
--   section_category — coach-facing category (Strength & Skill, WOD,
--                      Primer, Mobility, Accessories, Warm-up,
--                      Miscellaneous)
--   section_format   — display-shape tag (for_time, amrap, emom,
--                      intervals, strength_sets, max_load, no_score,
--                      other)
--
-- This migration is a one-shot backfill only. No CHECK constraint —
-- shape validation lives in TypeScript (src/lib/programming.ts).
-- JSONB is schemaless by design; a per-element CHECK using
-- jsonb_array_elements would risk a prod write-lock if it's wrong,
-- and the upside is small.
--
-- Legacy rows whose sections lack the new keys gain
-- section_category='miscellaneous' and section_format='other'. The
-- existing title and body are preserved. Idempotent — re-running
-- this migration leaves already-tagged sections untouched
-- (`s ? 'section_category'` guard).

begin;

update public.class_programming
   set sections = coalesce((
     select jsonb_agg(
       case when (s ? 'section_category') and (s ? 'section_format') then s
            else s || jsonb_build_object(
              'section_category', 'miscellaneous',
              'section_format',   'other'
            )
       end
     )
     from jsonb_array_elements(sections) s
   ), '[]'::jsonb)
 where sections is not null
   and jsonb_array_length(sections) > 0;

commit;
