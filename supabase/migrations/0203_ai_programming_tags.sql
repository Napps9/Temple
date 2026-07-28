-- An AI-tag cache for programmed sections — movements, duration, load.
--
-- The Programming Balance block classifies sections with a hand-built
-- alias lexicon; anything the lexicon can't read lands on the Untagged
-- card, and two dimensions coaches actually plan around — how long a
-- piece runs and how heavy it is — aren't captured at all. Boxmate
-- solves this by making coaches tag every workout by hand. We read the
-- same tags with AI instead: the classify-programming edge function
-- sends each distinct section body to Claude once and stores the
-- result here, keyed by a SHA-256 of the section's canonical content
-- (format + normalised title + body), so a section is only ever paid
-- for once no matter how many times the Analysis page loads it.
--
-- Keyed per gym on purpose, not shared across tenants like
-- import_inference_corrections: the movement vocabulary arrives from
-- the client request, so a cross-gym cache would let one gym's staff
-- seed tags that another gym's identical programming then reads.
-- Workout text is generic coach-authored content (no PII), but tag
-- integrity is per-tenant.
--
-- Service-role only — RLS enabled with no policies. Clients get tags
-- through the edge function, which re-authorises the caller with
-- effective_can(gym, 'can_see_workout_logs'), the same capability
-- that gates the Programming Balance block itself. Like the other
-- service-role-only tables, this one gets no src/types/database.ts
-- entry.

begin;

create table public.programming_ai_tags (
  gym_id uuid not null references public.gyms(id) on delete cascade,
  content_hash text not null,
  movement_keys text[] not null default '{}',
  duration_minutes integer check (duration_minutes between 1 and 600),
  load_level text check (load_level in ('heavy', 'moderate', 'light', 'bodyweight')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  model text not null,
  created_at timestamptz not null default now(),
  primary key (gym_id, content_hash)
);

alter table public.programming_ai_tags enable row level security;

-- No client policies — RLS denies by default. The edge function reads
-- and writes with the service role.

commit;
