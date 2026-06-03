-- Phase 1 / Track E: movement catalog.
--
-- The first of three workout layers (catalog → programmed → logged).
-- Global movements are seeded by Temple and read-only to operators;
-- gyms layer overrides (renames, extra aliases) via gym_movement_overrides
-- without forking the global row.
--
-- parent_movement_id wires the variation tree: "barbell back squat"
-- → "back squat" → "squat". aggregate_pr_across_variations (added
-- later this track) walks the chain so a PR for "barbell back squat"
-- counts as a "back squat" PR too. Training-max lookups (§5.1/5.2)
-- deliberately do NOT walk this chain — back squat and front squat
-- have independent training maxes even though both sit under squat.

-- ============================================================================
-- 1. Enums
-- ============================================================================

create type public.movement_category as enum (
  'lift',         -- back squat, deadlift, clean, snatch, etc.
  'gymnastic',    -- pull-up, muscle-up, handstand push-up, etc.
  'metcon',       -- thruster, wall ball, box jump, etc.
  'mono'          -- run, row, bike, jump rope, etc.
);

create type public.tracked_metric as enum (
  'weight',
  'reps',
  'time',
  'distance',
  'calories',
  'rounds'
);

-- ============================================================================
-- 2. movements (global library)
-- ============================================================================

create table public.movements (
  movement_id        uuid primary key default gen_random_uuid(),
  name               text not null unique,
  category           public.movement_category not null,
  parent_movement_id uuid references public.movements(movement_id),
  equipment          text[] not null default '{}',
  aliases            text[] not null default '{}',
  tracked_metrics    public.tracked_metric[] not null,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  check (cardinality(tracked_metrics) > 0)
);

create index movements_name_idx on public.movements(lower(name));
create index movements_aliases_idx on public.movements using gin(aliases);
create index movements_parent_idx on public.movements(parent_movement_id)
  where parent_movement_id is not null;
create index movements_category_idx on public.movements(category);

alter table public.movements enable row level security;

-- Global catalog is readable by all authenticated users.
create policy movements_all_select on public.movements
  for select using (auth.role() = 'authenticated');

-- Writes are service-role only (seeding + future admin tooling).

-- ============================================================================
-- 3. gym_movement_overrides (per-gym renames / extra aliases)
-- ============================================================================

create table public.gym_movement_overrides (
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  movement_id  uuid not null references public.movements(movement_id) on delete cascade,
  display_name text,
  aliases      text[] not null default '{}',
  hidden       boolean not null default false,
  primary key (gym_id, movement_id)
);

alter table public.gym_movement_overrides enable row level security;

create policy gym_movement_overrides_tenant_select on public.gym_movement_overrides
  for select using (public.user_belongs_to(gym_id));
create policy gym_movement_overrides_owner_insert on public.gym_movement_overrides
  for insert with check (public.user_is_owner_of(gym_id));
create policy gym_movement_overrides_owner_update on public.gym_movement_overrides
  for update using (public.user_is_owner_of(gym_id))
  with check (public.user_is_owner_of(gym_id));
create policy gym_movement_overrides_owner_delete on public.gym_movement_overrides
  for delete using (public.user_is_owner_of(gym_id));

-- ============================================================================
-- 4. Seed minimum viable global catalog with variation tree.
--    Coaches extend per-gym via overrides; further seeding happens
--    in later migrations as the catalog grows.
-- ============================================================================

-- Parents (roots of variation trees)
insert into public.movements (name, category, tracked_metrics, equipment, aliases) values
  ('Squat',         'lift', array['weight','reps']::public.tracked_metric[], '{}', array['squat']),
  ('Press',         'lift', array['weight','reps']::public.tracked_metric[], '{}', array['press']),
  ('Deadlift',      'lift', array['weight','reps']::public.tracked_metric[], '{}', array['deadlift','dl']),
  ('Clean',         'lift', array['weight','reps']::public.tracked_metric[], '{}', array['clean']),
  ('Snatch',        'lift', array['weight','reps']::public.tracked_metric[], '{}', array['snatch']),
  ('Pull-up',       'gymnastic', array['reps']::public.tracked_metric[], '{}', array['pullup','pull up']),
  ('Muscle-up',     'gymnastic', array['reps']::public.tracked_metric[], '{}', array['muscleup']),
  ('Handstand push-up', 'gymnastic', array['reps']::public.tracked_metric[], '{}', array['hspu']),
  ('Thruster',      'metcon', array['weight','reps']::public.tracked_metric[], array['barbell'], '{}'),
  ('Wall ball',     'metcon', array['reps']::public.tracked_metric[], array['wall ball'], array['wb']),
  ('Box jump',      'metcon', array['reps']::public.tracked_metric[], array['box'], '{}'),
  ('Burpee',        'metcon', array['reps']::public.tracked_metric[], '{}', '{}'),
  ('Double under',  'metcon', array['reps']::public.tracked_metric[], array['jump rope'], array['du']),
  ('Run',           'mono', array['distance','time']::public.tracked_metric[], '{}', '{}'),
  ('Row',           'mono', array['distance','time','calories']::public.tracked_metric[], array['rower'], '{}'),
  ('Bike',          'mono', array['distance','time','calories']::public.tracked_metric[], array['bike'], array['airbike','assault bike']);

-- Variations (children)
insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Back squat', 'lift', movement_id, array['barbell'], array['back squat','bs'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Squat';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Front squat', 'lift', movement_id, array['barbell'], array['front squat','fs'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Squat';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Overhead squat', 'lift', movement_id, array['barbell'], array['ohs','overhead squat'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Squat';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Strict press', 'lift', movement_id, array['barbell'], array['shoulder press','strict press'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Press';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Push press', 'lift', movement_id, array['barbell'], array['push press'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Press';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Push jerk', 'lift', movement_id, array['barbell'], array['push jerk'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Press';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Split jerk', 'lift', movement_id, array['barbell'], array['split jerk'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Press';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Conventional deadlift', 'lift', movement_id, array['barbell'], array['conventional dl'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Deadlift';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Sumo deadlift', 'lift', movement_id, array['barbell'], array['sumo dl'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Deadlift';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Power clean', 'lift', movement_id, array['barbell'], array['power clean'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Clean';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Squat clean', 'lift', movement_id, array['barbell'], array['squat clean','full clean'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Clean';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Power snatch', 'lift', movement_id, array['barbell'], array['power snatch'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Snatch';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Squat snatch', 'lift', movement_id, array['barbell'], array['squat snatch','full snatch'],
       array['weight','reps']::public.tracked_metric[]
from public.movements where name = 'Snatch';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Kipping pull-up', 'gymnastic', movement_id, '{}', array['kipping pullup'],
       array['reps']::public.tracked_metric[]
from public.movements where name = 'Pull-up';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Butterfly pull-up', 'gymnastic', movement_id, '{}', array['butterfly pullup'],
       array['reps']::public.tracked_metric[]
from public.movements where name = 'Pull-up';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Bar muscle-up', 'gymnastic', movement_id, '{}', array['bmu','bar muscle up'],
       array['reps']::public.tracked_metric[]
from public.movements where name = 'Muscle-up';

insert into public.movements (name, category, parent_movement_id, equipment, aliases, tracked_metrics)
select 'Ring muscle-up', 'gymnastic', movement_id, array['rings'], array['rmu','ring muscle up'],
       array['reps']::public.tracked_metric[]
from public.movements where name = 'Muscle-up';
