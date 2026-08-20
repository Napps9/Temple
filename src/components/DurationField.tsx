import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
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

  // Switching the unit re-expresses the same duration (48 hrs -> 2 days)
  // rather than reinterpreting the number, so it reads as "show me this
  // in another unit".
  function changeUnit(next: DurationUnit) {
    const a = parseInt(amount, 10);
    if (Number.isFinite(a)) {
      const reconverted = String(Math.round((a * MIN_PER[unit]) / MIN_PER[next]));
      setAmount(reconverted);
      setUnit(next);
      emit(reconverted, next);
      return;
    }
    setUnit(next);
  }

  return (
    <View className="gap-1.5">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
        {label}
      </Text>
      {blurb ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">{blurb}</Text>
      ) : null}
      {/* Number on the left, unit dropdown on the right. The compact
          trigger (current unit + chevron) sidesteps the mobile clipping
          the old inline segmented control had with 'weeks'. */}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={amount}
          onChangeText={changeAmount}
          keyboardType="number-pad"
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          className="flex-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk text-base"
        />
        <UnitDropdown units={units} unit={unit} onChange={changeUnit} />
      </View>
    </View>
  );
}

function UnitDropdown({
  units,
  unit,
  onChange,
}: {
  units: DurationUnit[];
  unit: DurationUnit;
  onChange: (u: DurationUnit) => void;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  function openMenu() {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setPos({ top: y + height + 4, left: x, width });
      setOpen(true);
    });
  }

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={openMenu}
        className="w-24 flex-row items-center justify-between gap-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 active:opacity-70">
        <Text className="text-ink dark:text-ink-dk text-base">
          {UNIT_LABEL[unit]}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable
          className="flex-1"
          onPress={() => setOpen(false)}
          accessibilityLabel="Close unit menu"
        />
        {pos ? (
          <View
            style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width }}
            className="bg-surface dark:bg-surface-dk rounded-lg border border-line dark:border-line-dk shadow-float p-1">
            {units.map((u) => {
              const on = u === unit;
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    onChange(u);
                    setOpen(false);
                  }}
                  className={`flex-row items-center justify-between rounded-md px-3 py-2 active:opacity-70 ${
                    on ? 'bg-primary/10' : ''
                  }`}>
                  <Text
                    className={`text-sm ${
                      on
                        ? 'text-ink dark:text-ink-dk font-medium'
                        : 'text-ink-2 dark:text-ink-2-dk'
                    }`}>
                    {UNIT_LABEL[u]}
                  </Text>
                  {on ? (
                    <Ionicons name="checkmark" size={16} color={colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </>
  );
}
