export type WeightUnit = 'kg' | 'lb';

// Kilograms are canonical in storage (0181). These convert at the edges:
// on the way to a display, and on the way back from an input.
const LB_PER_KG = 2.2046226218;

export function kgToDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kg * LB_PER_KG : kg;
}

export function displayToKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value / LB_PER_KG : value;
}

// One decimal is what a gym scale gives you and what a barbell can
// actually be loaded to; more just makes a converted number look
// spuriously precise.
export function formatWeight(
  kg: number | null | undefined,
  unit: WeightUnit,
): string {
  if (kg == null || Number.isNaN(kg)) return '';
  const v = kgToDisplay(kg, unit);
  const rounded = Math.round(v * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

export const WEIGHT_UNIT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'lb', label: 'Pounds (lb)' },
];
