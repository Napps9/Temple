import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { Input } from './Input';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export type RecurrenceForm = {
  days: number[];
  times: string[];
  durationMinutes: string;
  capacity: string;
  indefinite: boolean;
  weeks: string;
};

export const EMPTY_RECURRENCE: RecurrenceForm = {
  days: [],
  times: ['06:00'],
  durationMinutes: '60',
  capacity: '12',
  indefinite: true,
  weeks: '4',
};

export function RecurrenceEditor({
  value,
  onChange,
}: {
  value: RecurrenceForm;
  onChange: (next: RecurrenceForm) => void;
}) {
  const daysSet = new Set(value.days);

  function toggleDay(i: number) {
    const next = new Set(daysSet);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onChange({ ...value, days: Array.from(next).sort((a, b) => a - b) });
  }

  function setTime(idx: number, v: string) {
    const next = [...value.times];
    next[idx] = v;
    onChange({ ...value, times: next });
  }

  function removeTime(idx: number) {
    if (value.times.length <= 1) return;
    onChange({ ...value, times: value.times.filter((_, i) => i !== idx) });
  }

  function addTime() {
    onChange({ ...value, times: [...value.times, '12:00'] });
  }

  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Days
        </Text>
        <View className="flex-row gap-1.5">
          {DAY_LETTERS.map((l, i) => {
            const sel = daysSet.has(i);
            return (
              <Pressable
                key={i}
                onPress={() => toggleDay(i)}
                className={`flex-1 aspect-square rounded-lg items-center justify-center ${
                  sel ? 'bg-primary' : 'bg-gray-100 dark:bg-gray-800'
                }`}>
                <Text
                  className={
                    sel
                      ? 'text-white font-semibold'
                      : 'text-gray-500 dark:text-gray-400 font-medium'
                  }>
                  {l}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Times
        </Text>
        <View className="gap-2">
          {value.times.map((t, idx) => (
            <View key={idx} className="flex-row gap-2 items-end">
              <View className="flex-1">
                <Input
                  label=""
                  value={t}
                  onChangeText={(v) => setTime(idx, v)}
                  placeholder="06:00"
                />
              </View>
              <Pressable
                onPress={() => removeTime(idx)}
                disabled={value.times.length === 1}
                className={`w-11 h-11 rounded-lg items-center justify-center ${
                  value.times.length === 1
                    ? 'opacity-40 bg-gray-100 dark:bg-gray-800'
                    : 'bg-gray-100 dark:bg-gray-800'
                }`}>
                <Ionicons name="close" size={18} color="#6B7280" />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={addTime}
            className="flex-row items-center gap-1 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Add time
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Input
            label="Duration (min)"
            value={value.durationMinutes}
            onChangeText={(v) => onChange({ ...value, durationMinutes: v })}
            keyboardType="numeric"
          />
        </View>
        <View className="flex-1">
          <Input
            label="Capacity"
            value={value.capacity}
            onChangeText={(v) => onChange({ ...value, capacity: v })}
            keyboardType="numeric"
          />
        </View>
      </View>

      {!value.indefinite ? (
        <Input
          label="Repeat for (weeks)"
          value={value.weeks}
          onChangeText={(v) => onChange({ ...value, weeks: v })}
          keyboardType="numeric"
          placeholder="4"
        />
      ) : null}

      <Pressable
        onPress={() => onChange({ ...value, indefinite: !value.indefinite })}
        className="flex-row items-center gap-2">
        <View
          className={`w-5 h-5 rounded border-2 items-center justify-center ${
            value.indefinite
              ? 'border-primary bg-primary'
              : 'border-gray-300 dark:border-gray-600'
          }`}>
          {value.indefinite ? (
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          ) : null}
        </View>
        <Text className="text-gray-900 dark:text-gray-50">Repeat indefinitely</Text>
      </Pressable>
    </View>
  );
}

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function validateRecurrence(r: RecurrenceForm): string | null {
  if (r.days.length === 0) return 'Pick at least one day';
  const validTimes = r.times.map((t) => t.trim()).filter(Boolean);
  if (validTimes.length === 0) return 'Add at least one time';
  for (const t of validTimes) {
    if (!TIME_RE.test(t)) return `Time "${t}" must be HH:MM (24-hour)`;
  }
  const dur = parseInt(r.durationMinutes, 10);
  if (!Number.isFinite(dur) || dur <= 0) {
    return 'Duration must be a positive number of minutes';
  }
  const cap = parseInt(r.capacity, 10);
  if (!Number.isFinite(cap) || cap <= 0) {
    return 'Capacity must be a positive number';
  }
  if (!r.indefinite) {
    const w = parseInt(r.weeks, 10);
    if (!Number.isFinite(w) || w < 1 || w > 260) {
      return 'Repeat must be 1–260 weeks, or pick "Repeat indefinitely"';
    }
  }
  return null;
}

export function summariseRecurrence(r: RecurrenceForm | null): string {
  if (!r || r.days.length === 0) return 'No schedule yet.';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = r.days.map((d) => dayNames[d]).join(', ');
  const validTimes = r.times.map((t) => t.trim()).filter((t) => TIME_RE.test(t));
  const times = validTimes.length > 0 ? validTimes.join(', ') : '—';
  const range = r.indefinite ? 'ongoing' : `for ${r.weeks} ${r.weeks === '1' ? 'week' : 'weeks'}`;
  return `${days} at ${times} · ${r.durationMinutes} min · ${r.capacity} spots · ${range}`;
}
