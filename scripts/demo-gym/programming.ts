// Programmed WODs for the demo-gym seeder — the "Programming" tab
// (the first nav tab on both member and staff sides) was previously
// left completely empty. A small rotation of hand-authored day plans
// per class type, cycled deterministically across every date that
// class type actually ran, is enough to make the tab (and the
// recorder's "pre-fill from today's programming" flow) feel real
// without hand-authoring one entry per date.
//
// "Open Gym" is deliberately absent from both template maps — it's
// unstructured free-training time, not a programmed class, in both
// disciplines.

import type { Section } from '../../src/lib/programming';
import type { Database, Json } from '../../src/types/database';

type T<Name extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][Name]['Insert'];

const section = (
  category: Section['section_category'],
  format: Section['section_format'],
  title: string,
  body: string,
  leaderboardEnabled = false,
): Section => ({
  section_category: category,
  section_format: format,
  title,
  body,
  leaderboard_enabled: leaderboardEnabled,
});

export const CROSSFIT_WOD_TEMPLATES: Record<string, Section[][]> = {
  CrossFit: [
    [
      section('strength_and_skill', 'strength_sets', 'Back Squat', '5x5 building to a heavy set of 5.'),
      section('wod', 'for_time', '21-15-9', 'Thrusters (42.5/30kg)\nPull-ups', true),
    ],
    [
      section('strength_and_skill', 'strength_sets', 'Deadlift', '5-3-1 across, then max reps at 70% of today\'s 1.'),
      section('wod', 'amrap', 'AMRAP 15', '10 Wall Balls (9/6kg)\n10 Box Jumps (24/20")\n10 Calorie Row', true),
    ],
    [
      section('strength_and_skill', 'strength_sets', 'Push Press', '3x5 building each set.'),
      section('wod', 'for_time', 'The Ladder', '50-40-30-20-10 Double Unders\n10-8-6-4-2 Power Cleans (60/40kg)', true),
    ],
    [
      section('strength_and_skill', 'strength_sets', 'Front Squat', '5x3, heaviest set for the day.'),
      section('wod', 'emom', 'EMOM 20', 'Min 1: 12 Cal Bike\nMin 2: 10 Burpees\nMin 3: 8 Toes-to-Bar\nMin 4: Rest', true),
    ],
    [
      section('strength_and_skill', 'strength_sets', 'Snatch', 'EMOM 10, technique focus — build if it looks clean.'),
      section('wod', 'for_time', '3 Rounds', '400m Run\n21 Kettlebell Swings (24/16kg)\n12 Pull-ups', true),
    ],
  ],
  'Olympic Lifting': [
    [section('strength_and_skill', 'strength_sets', 'Snatch', 'Build to a heavy single, then 3x2 @ 80% of today\'s top.')],
    [section('strength_and_skill', 'strength_sets', 'Clean & Jerk', '5x3 @ 70%, then EMOM 10 touch-and-go doubles @ 60%.')],
    [section('strength_and_skill', 'strength_sets', 'Snatch Balance + Overhead Squat', '5x2 snatch balance, then 3x3 overhead squat.')],
    [section('strength_and_skill', 'strength_sets', 'Clean Pull + Clean', '4x3 clean pull @ 90% of clean, then 5x1 clean @ 80%.')],
  ],
  Gymnastics: [
    [
      section('strength_and_skill', 'no_score', 'Skill', 'Handstand walk practice, 20 minutes.'),
      section('wod', 'intervals', '4 Rounds', '30s max Handstand Push-ups\n30s max Toes-to-Bar\nRest 90s', true),
    ],
    [
      section('strength_and_skill', 'no_score', 'Skill', 'Strict pull-up + ring dip progressions, 20 minutes.'),
      section('wod', 'for_time', 'Gymnastics Chipper', '30 Pull-ups\n30 Ring Dips\n30 GHD Sit-ups\n30 Pistols', true),
    ],
    [
      section('strength_and_skill', 'no_score', 'Skill', 'Muscle-up transitions on rings and bar, 20 minutes.'),
      section('wod', 'amrap', 'AMRAP 12', '3 Muscle-ups\n6 Handstand Push-ups\n9 Pistols', true),
    ],
  ],
  Engine: [
    [section('wod', 'no_score', 'Zone 2', '30 minutes easy row or bike, conversational pace.')],
    [section('wod', 'max_calories', 'Death By Calories', 'Add 1 calorie every minute (bike or row) until you can\'t keep up.', true)],
    [section('wod', 'intervals', '8 x 2:00', '2:00 hard row / 1:00 easy row, repeat.', true)],
  ],
};

export const HYROX_WOD_TEMPLATES: Record<string, Section[][]> = {
  'Hyrox Simulation': [
    [
      section(
        'wod',
        'for_time',
        'Half Hyrox Simulation',
        '4 rounds:\n500m Row\nStation (rotate: SkiErg / Sled Push / Sled Pull / Burpee Broad Jumps)\n250m Run between rounds',
        true,
      ),
    ],
    [
      section(
        'wod',
        'for_time',
        'Station Ladder',
        '1km Run\n1000m SkiErg\n1km Run\n50m Sled Push\n1km Run\n50m Sled Pull\n1km Run\n80m Burpee Broad Jumps',
        true,
      ),
    ],
    [
      section(
        'wod',
        'for_time',
        'Full Hyrox Simulation',
        'The full 8x(1km run + station) course, race pacing — see the Race Simulation tile in Track to log your split-by-split result.',
        true,
      ),
    ],
  ],
  'Compromised Running': [
    [section('wod', 'intervals', '6 x 800m', '90s rest between reps. Add 20 burpees between reps 3 and 4.', true)],
    [section('wod', 'intervals', '10 x 400m', '60s rest. Hold the same split every rep.', true)],
    [section('wod', 'for_time', 'Run + Wall Balls', '5 rounds: 400m Run, 20 Wall Balls (9/6kg)', true)],
  ],
  'Strength for Hyrox': [
    [section('strength_and_skill', 'strength_sets', 'Sled Work', 'Sled push/pull technique ladder, building load each set.')],
    [section('strength_and_skill', 'strength_sets', 'Farmers Carry', '6 rounds: 50m farmers carry, heavy, plus 3x8 deadlift @ 75%.')],
    [section('strength_and_skill', 'strength_sets', 'Lunge Strength', '4x12 walking lunges (loaded) + 4x10 back squat.')],
  ],
  'Engine Builder': [
    [section('wod', 'emom', 'EMOM 24', 'Rotate every 3 min: SkiErg calories, Row calories, Bike calories, rest.', true)],
    [section('wod', 'max_calories', '4 x 4:00 Max Cal', 'Alternate SkiErg and Row. 2:00 rest between efforts.', true)],
  ],
};

// One row per (class type, date) that class type actually ran,
// cycling through that class type's template rotation in date order.
// Class types with no template (Open Gym) are skipped entirely.
export function buildProgrammingRows(
  sessions: { class_type_id?: string | null; starts_at: string }[],
  classTypeIdByName: Map<string, string>,
  gymId: string,
  authorId: string,
  templatesByClassTypeName: Record<string, Section[][]>,
): T<'class_programming'>[] {
  const datesByClassTypeId = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (!s.class_type_id) continue;
    const date = s.starts_at.slice(0, 10);
    if (!datesByClassTypeId.has(s.class_type_id)) datesByClassTypeId.set(s.class_type_id, new Set());
    datesByClassTypeId.get(s.class_type_id)!.add(date);
  }
  const rows: T<'class_programming'>[] = [];
  for (const [className, templates] of Object.entries(templatesByClassTypeName)) {
    const classTypeId = classTypeIdByName.get(className);
    if (!classTypeId || templates.length === 0) continue;
    const dates = Array.from(datesByClassTypeId.get(classTypeId) ?? []).sort();
    dates.forEach((date, i) => {
      rows.push({
        gym_id: gymId,
        class_type_id: classTypeId,
        date,
        sections: templates[i % templates.length] as unknown as Json,
        author_id: authorId,
      });
    });
  }
  return rows;
}
