import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { FieldLabel } from './SectionLabel';
import { Text, TextInput } from './Text';

import { useThemeColors } from '@/lib/theme';

// A number + unit input for the duration / window settings on the gym
// settings page. The underlying columns store a single fixed unit
// (minutes, hours, days, or months) but a coach thinks in "2 weeks" or
// "48 hours", not 336 or 2880. This control keeps the stored base unit
// and lets the user pick the unit they reason in; conversion is purely
// presentational.
//
// Month / year conversions use 30 days / 365 days as approximations —
// fine for owner-facing rough estimates (PAR-Q expiry, retention,
// lead conversion window). 12 months ≠ 1 year exactly under this
// scheme; that's intentional, so each unit converts cleanly against
// the canonical day count rather than chaining inconsistencies.

export type DurationUnit =
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks'
  | 'months'
  | 'years';

// The base unit the backing column uses. Allowed unit sets omit any
// option smaller than the base — booking_window_hours_ahead is stored
// in hours and can't express sub-hour values, for instance.
export type DurationBase = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

const MIN_PER: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
  months: 43200, // 30 days
  years: 525600, // 365 days
};

const UNIT_LABEL: Record<DurationUnit, string> = {
  minutes: 'min',
  hours: 'hrs',
  days: 'days',
  weeks: 'wks',
  months: 'mths',
  years: 'yrs',
};

const BASE_MINUTES: Record<DurationBase, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
  months: 43200,
};

function baseMinutes(base: DurationBase): number {
  return BASE_MINUTES[base];
}

// Largest allowed unit that divides the value evenly, so a stored 2880
// minutes loads as "2 days" rather than "2880 min".
function pickUnit(
  baseValue: number,
  base: DurationBase,
  units: DurationUnit[],
): DurationUnit {
  const mins = baseValue * baseMinutes(base);
  const ordered = [...units].sort((a, b) => MIN_PER[b] - MIN_PER[a]);
  for (const u of ordered) {
    if (mins % MIN_PER[u] === 0) return u;
  }
  return units[0];
}

// Derive the editable amount + unit from a stored base value: pick the
// most natural unit and express the value in it (2880 min stored → "2
// days"). A blank/zero value keeps the smallest allowed unit.
function computeSeed(
  value: string,
  base: DurationBase,
  units: DurationUnit[],
): { amount: string; unit: DurationUnit } {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return { amount: value.trim() === '' ? '' : value, unit: units[0] };
  }
  const u = pickUnit(n, base, units);
  return { amount: String((n * baseMinutes(base)) / MIN_PER[u]), unit: u };
}

// Largest-to-smallest unit list each base can render in. Bases never
// render a smaller unit than themselves (a value stored in days has no
// sub-day precision available).
const FORMAT_UNITS: Record<DurationBase, DurationUnit[]> = {
  minutes: ['years', 'months', 'weeks', 'days', 'hours', 'minutes'],
  hours:   ['years', 'months', 'weeks', 'days', 'hours'],
  days:    ['years', 'months', 'weeks', 'days'],
  weeks:   ['years', 'months', 'weeks'],
  months:  ['years', 'months'],
};

// The same duration said in another unit, or null when it cannot be said
// there exactly.
//
// Null is the whole point. The field holds whole numbers, so 90 minutes is
// not a whole number of hours; the old code rounded, and switching the unit
// on a 90-minute class silently stored 120 while the field read "2 hrs" as
// though it always had. A conversion that cannot be exact is not offered.
export function convertExact(
  amount: number,
  from: DurationUnit,
  to: DurationUnit,
): number | null {
  const mins = amount * MIN_PER[from];
  return mins % MIN_PER[to] === 0 ? mins / MIN_PER[to] : null;
}

// Render a stored base value in its most natural unit — used for the
// collapsed summary lines.
export function formatBaseDuration(baseValue: number, base: DurationBase): string {
  if (baseValue <= 0) return '0';
  const mins = baseValue * baseMinutes(base);
  for (const u of FORMAT_UNITS[base]) {
    if (mins % MIN_PER[u] === 0) {
      const n = mins / MIN_PER[u];
      return `${n} ${n === 1 ? UNIT_LABEL[u].replace(/s$/, '') : UNIT_LABEL[u]}`;
    }
  }
  return `${baseValue}`;
}

export function DurationField({
  label,
  blurb,
  value,
  onChange,
  base,
  units,
  placeholder,
}: {
  label: string;
  blurb?: string;
  // Base-unit string. '' = blank (inherit / unset).
  value: string;
  // Emits a base-unit string, or '' when cleared.
  onChange: (next: string) => void;
  base: DurationBase;
  units: DurationUnit[];
  placeholder?: string;
}) {
  const colors = useThemeColors();
  const seed = computeSeed(value, base, units);
  const [amount, setAmount] = useState<string>(seed.amount);
  const [unit, setUnit] = useState<DurationUnit>(seed.unit);

  // Reseed from an externally-changing value — but only until the user
  // first touches the field. This lets an editor that seeds asynchronously
  // (e.g. a class-duration default arriving from the gym config a tick
  // after mount) land on the right unit, while a field the user is editing
  // is fully theirs: once they type or pick a unit, parent echoes are
  // ignored so the display is never reformatted mid-edit.
  const interacted = useRef(false);
  useEffect(() => {
    if (interacted.current) return;
    const next = computeSeed(value, base, units);
    setAmount(next.amount);
    setUnit(next.unit);
    // base/units are fixed per mounted field; only `value` drives a reseed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nextAmount: string, nextUnit: DurationUnit) {
    interacted.current = true;
    const trimmed = nextAmount.trim();
    if (trimmed === '') {
      onChange('');
      return;
    }
    const a = parseInt(trimmed, 10);
    if (!Number.isFinite(a) || a < 0) {
      onChange('');
      return;
    }
    onChange(String(Math.round((a * MIN_PER[nextUnit]) / baseMinutes(base))));
  }

  function changeAmount(v: string) {
    setAmount(v);
    emit(v, unit);
  }

  // A unit that cannot say the current value exactly is shown but not
  // selectable. Hiding it instead would make the menu jump as the number
  // is typed.
  function exactIn(u: DurationUnit): boolean {
    const a = parseInt(amount, 10);
    if (!Number.isFinite(a)) return true;
    return convertExact(a, unit, u) !== null;
  }

  // Switching the unit re-expresses the same duration (48 hrs -> 2 days)
  // rather than reinterpreting the number, so it reads as "show me this
  // in another unit". It never changes the duration itself.
  function changeUnit(next: DurationUnit) {
    const a = parseInt(amount, 10);
    if (Number.isFinite(a)) {
      const reconverted = convertExact(a, unit, next);
      if (reconverted === null) return;
      setAmount(String(reconverted));
      setUnit(next);
      emit(String(reconverted), next);
      return;
    }
    setUnit(next);
  }

  return (
    <View className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {blurb ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">{blurb}</Text>
      ) : null}
      {/* The unit sits under the number as a wrapping row rather than in a
          popover. The popover was a second react-native Modal, so a
          duration field inside a sheet opened a modal on top of a modal —
          and it positioned itself from a measureInWindow snapshot, so it
          drifted if the sheet scrolled after measuring and had no room to
          flip near the bottom of a phone. There are only ever two to six
          units, and they are three letters each. */}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={amount}
          onChangeText={changeAmount}
          keyboardType="number-pad"
          placeholder={placeholder}
          placeholderTextColor={colors.ink3}
          className="flex-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-ctl px-4 py-3 text-ink dark:text-ink-dk text-base"
        />
      </View>
      {units.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          {units.map((u) => {
            const on = u === unit;
            const usable = on || exactIn(u);
            return (
              <Pressable
                key={u}
                disabled={!usable}
                onPress={() => changeUnit(u)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !usable }}
                className={`h-9 px-3 justify-center rounded-full border ${
                  on
                    ? 'border-ink dark:border-ink-dk bg-raised dark:bg-raised-dk'
                    : 'border-line dark:border-line-dk'
                } ${usable ? 'active:opacity-70' : 'opacity-40'}`}>
                <Text
                  className={`text-[13px] ${
                    on
                      ? 'text-ink dark:text-ink-dk font-semibold'
                      : 'text-ink-2 dark:text-ink-2-dk'
                  }`}>
                  {UNIT_LABEL[u]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
