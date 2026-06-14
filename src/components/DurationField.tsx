import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

// A number + unit input for the booking-window / cutoff settings. The
// underlying columns store a single fixed unit (hours for the
// booking-open window, minutes for the two cutoffs), but a coach
// thinks in "2 weeks" or "48 hours", not 336 or 2880. This control
// keeps the stored base unit and lets the user pick the unit they
// reason in; the conversion is purely presentational.

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';

// The base unit the backing column uses. booking_window_hours_ahead is
// in hours, so it can't express sub-hour values — its allowed unit set
// omits minutes.
export type DurationBase = 'minutes' | 'hours';

const MIN_PER: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
};

const UNIT_LABEL: Record<DurationUnit, string> = {
  minutes: 'min',
  hours: 'hrs',
  days: 'days',
  weeks: 'wks',
};

function baseMinutes(base: DurationBase): number {
  return base === 'hours' ? 60 : 1;
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

// Render a stored base value in its most natural unit — used for the
// collapsed summary lines.
export function formatBaseDuration(baseValue: number, base: DurationBase): string {
  if (baseValue <= 0) return '0';
  const units: DurationUnit[] =
    base === 'hours'
      ? ['weeks', 'days', 'hours']
      : ['weeks', 'days', 'hours', 'minutes'];
  const mins = baseValue * baseMinutes(base);
  for (const u of units) {
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
  // Seeded once. Both editors mount this only after their data has
  // loaded (Operating defaults gates on the draft; the class-type
  // override mounts on demand), so there's no late value to resync.
  const seed = (() => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return { amount: value.trim() === '' ? '' : value, unit: units[0] };
    }
    const u = pickUnit(n, base, units);
    return { amount: String((n * baseMinutes(base)) / MIN_PER[u]), unit: u };
  })();
  const [amount, setAmount] = useState<string>(seed.amount);
  const [unit, setUnit] = useState<DurationUnit>(seed.unit);

  function emit(nextAmount: string, nextUnit: DurationUnit) {
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
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      {blurb ? (
        <Text className="text-gray-500 dark:text-gray-400 text-xs">{blurb}</Text>
      ) : null}
      <View className="flex-row gap-2 items-center">
        <TextInput
          value={amount}
          onChangeText={changeAmount}
          keyboardType="number-pad"
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-base"
        />
        <View className="flex-row gap-1">
          {units.map((u) => {
            const on = u === unit;
            return (
              <Pressable
                key={u}
                onPress={() => changeUnit(u)}
                className={`px-2.5 py-2 rounded-lg border ${
                  on
                    ? 'border-primary bg-primary/10'
                    : 'border-gray-200 dark:border-gray-700'
                }`}>
                <Text
                  className={`text-xs ${
                    on
                      ? 'text-primary font-medium'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}>
                  {UNIT_LABEL[u]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
