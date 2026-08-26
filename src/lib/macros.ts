// A macro prescription, and the one number derived from it.
//
// Calories are never stored (0268): 4/4/9 is exact, and a kcal column
// would be a second number that can disagree with the first three. This
// is the only place the arithmetic lives.

export type MacroTargets = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export const MACRO_MAX_G = 1000;

export function kcalFromMacros(m: MacroTargets): number {
  return m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9;
}

// What share of the day's energy each macro carries. Percentages are what
// a coach actually reasons in ("40/30/30"), and they have to come from the
// same arithmetic as the calorie figure or the card argues with itself.
export function macroSplit(m: MacroTargets): {
  protein: number;
  carbs: number;
  fat: number;
} {
  const kcal = kcalFromMacros(m);
  if (kcal === 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: (m.protein_g * 4 * 100) / kcal,
    carbs: (m.carbs_g * 4 * 100) / kcal,
    fat: (m.fat_g * 9 * 100) / kcal,
  };
}

// Returns the reason it is not a usable prescription, or null.
export function macroError(
  raw: { protein: string; carbs: string; fat: string },
): string | null {
  for (const [label, value] of [
    ['Protein', raw.protein],
    ['Carbs', raw.carbs],
    ['Fat', raw.fat],
  ] as const) {
    const trimmed = value.trim();
    if (trimmed === '') return `${label} needs a number`;
    if (!/^\d+$/.test(trimmed)) return `${label} must be a whole number of grams`;
    if (Number(trimmed) > MACRO_MAX_G) return `${label} looks too high`;
  }
  return null;
}
