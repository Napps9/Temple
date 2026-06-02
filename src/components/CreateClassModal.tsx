import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ClassTypePicker } from '@/components/ClassTypePicker';
import { Input } from '@/components/Input';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HORIZON_WEEKS = 12;

function fmtDateLocal(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`;
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function fmtTime(h: number, m: number) {
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function defaultTimeFor(hour: number | undefined) {
  if (hour !== undefined) return fmtTime(hour, 0);
  const now = new Date();
  const next = now.getMinutes() > 0 ? now.getHours() + 1 : now.getHours();
  return fmtTime(next % 24, 0);
}

export function CreateClassModal({
  visible,
  defaultDate,
  defaultHour,
  onClose,
  onCreated,
}: {
  visible: boolean;
  defaultDate?: Date;
  defaultHour?: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: membership } = useGymMembership();
  const [classTypeId, setClassTypeId] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [days, setDays] = useState<Set<number>>(new Set());
  const [times, setTimes] = useState<string[]>(['06:00']);
  const [weeks, setWeeks] = useState('4');
  const [indefinite, setIndefinite] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [capacity, setCapacity] = useState('12');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'form' | 'confirm'>('form');

  const typesQuery = useQuery({
    queryKey: ['class-types', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name, color')
        .order('name');
      if (error) throw error;
      return data as { id: string; name: string; color: string }[];
    },
  });
  const selectedType = typesQuery.data?.find((t) => t.id === classTypeId);

  useEffect(() => {
    if (!visible) return;
    const d = defaultDate ?? new Date();
    setClassTypeId(null);
    setDateStr(fmtDate(d));
    setTimeStr(defaultTimeFor(defaultHour));
    setRecurring(false);
    setDays(new Set());
    setTimes(['06:00']);
    setWeeks('4');
    setIndefinite(false);
    setDurationMinutes('60');
    setCapacity('12');
    setNotes('');
    setError(null);
    setStage('form');
  }, [visible, defaultDate, defaultHour]);

  function toggleDay(i: number) {
    const next = new Set(days);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDays(next);
  }

  function validate(): string | null {
    if (!classTypeId) return 'Pick a class type';
    if (!DATE_RE.test(dateStr)) return 'Date must be YYYY-MM-DD';
    const dur = parseInt(durationMinutes, 10);
    const cap = parseInt(capacity, 10);
    if (!Number.isFinite(dur) || dur <= 0) {
      return 'Duration must be a positive number of minutes';
    }
    if (!Number.isFinite(cap) || cap <= 0) {
      return 'Capacity must be a positive number';
    }
    if (recurring) {
      if (days.size === 0) return 'Pick at least one day';
      const validTimes = times.map((t) => t.trim()).filter(Boolean);
      if (validTimes.length === 0) return 'Add at least one time';
      for (const t of validTimes) {
        if (!TIME_RE.test(t)) return `Time "${t}" must be HH:MM (24-hour)`;
      }
      if (validTimes.length > 6) return 'At most 6 times per pattern';
      if (!indefinite) {
        const w = parseInt(weeks, 10);
        if (!Number.isFinite(w) || w < 1 || w > 260) {
          return 'Repeat must be 1–260 weeks, or pick "Repeat indefinitely"';
        }
      }
    } else {
      if (!TIME_RE.test(timeStr)) return 'Time must be HH:MM (24-hour)';
    }
    return null;
  }

  function sessionsInHorizon(): number {
    if (!recurring) return 1;
    const validTimes = times.map((t) => t.trim()).filter((t) => TIME_RE.test(t));
    if (validTimes.length === 0 || days.size === 0) return 0;
    const [y, mo, day] = dateStr.split('-').map(Number);
    if (!y || !mo || !day) return 0;
    const start = new Date(y, mo - 1, day);
    start.setHours(0, 0, 0, 0);
    const horizon = new Date();
    horizon.setHours(0, 0, 0, 0);
    horizon.setDate(horizon.getDate() + HORIZON_WEEKS * 7);
    let end = horizon;
    if (!indefinite) {
      const w = parseInt(weeks, 10);
      const finiteEnd = new Date(start);
      finiteEnd.setDate(finiteEnd.getDate() + w * 7 - 1);
      if (finiteEnd < end) end = finiteEnd;
    }
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      if (days.has(cursor.getDay())) count += validTimes.length;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  function onReview() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStage('confirm');
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      if (!classTypeId) throw new Error('Pick a class type');
      if (!DATE_RE.test(dateStr)) throw new Error('Date must be YYYY-MM-DD');

      const dur = parseInt(durationMinutes, 10);
      const cap = parseInt(capacity, 10);
      if (!Number.isFinite(dur) || dur <= 0) {
        throw new Error('Duration must be a positive number of minutes');
      }
      if (!Number.isFinite(cap) || cap <= 0) {
        throw new Error('Capacity must be a positive number');
      }

      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');
      const userId = userResp.user.id;

      const [y, mo, day] = dateStr.split('-').map(Number);

      if (recurring) {
        if (days.size === 0) throw new Error('Pick at least one day');
        const validTimes = times.map((t) => t.trim()).filter(Boolean);
        if (validTimes.length === 0) throw new Error('Add at least one time');
        for (const t of validTimes) {
          if (!TIME_RE.test(t)) throw new Error(`Time "${t}" must be HH:MM (24-hour)`);
        }
        if (validTimes.length > 6) throw new Error('At most 6 times per pattern');

        let endsOn: string | null = null;
        if (!indefinite) {
          const w = parseInt(weeks, 10);
          if (!Number.isFinite(w) || w < 1 || w > 260) {
            throw new Error('Repeat must be between 1 and 260 weeks, or pick "Repeat indefinitely"');
          }
          const endDate = new Date(y, mo - 1, day);
          endDate.setDate(endDate.getDate() + w * 7 - 1);
          endsOn = fmtDateLocal(endDate);
        }

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        const { data: rec, error: recErr } = await supabase
          .from('class_recurrences')
          .insert({
            gym_id: membership.gymId,
            class_type_id: classTypeId,
            days_of_week: Array.from(days),
            times: validTimes,
            duration_minutes: dur,
            capacity: cap,
            notes: notes.trim() || null,
            starts_on: dateStr,
            ends_on: endsOn,
            tz,
            created_by: userId,
          })
          .select('id')
          .single();
        if (recErr || !rec) throw recErr ?? new Error('Could not save recurrence');

        // Materialise the first horizon (12 weeks ahead of today, capped by ends_on).
        const horizon = new Date();
        horizon.setDate(horizon.getDate() + HORIZON_WEEKS * 7);
        const targetEnd =
          endsOn && new Date(endsOn) < horizon ? endsOn : fmtDateLocal(horizon);

        const { error: extErr } = await supabase.rpc('extend_recurrence', {
          rec_id: rec.id,
          until_date: targetEnd,
        });
        if (extErr) throw extErr;
      } else {
        if (!TIME_RE.test(timeStr)) throw new Error('Time must be HH:MM (24-hour)');
        const [h, mi] = timeStr.split(':').map(Number);
        const startsAt = new Date(y, mo - 1, day, h, mi, 0, 0);

        const { data: typeRow, error: typeErr } = await supabase
          .from('class_types')
          .select('name')
          .eq('id', classTypeId)
          .single();
        if (typeErr || !typeRow) throw typeErr ?? new Error('Class type not found');

        const { error } = await supabase.from('class_sessions').insert({
          gym_id: membership.gymId,
          name: typeRow.name,
          class_type_id: classTypeId,
          starts_at: startsAt.toISOString(),
          duration_minutes: dur,
          capacity: cap,
          notes: notes.trim() || null,
          coach_id: userId,
          created_by: userId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setError(null);
      onCreated();
    },
    onError: (e) => setError(errorMessage(e, 'Could not create class')),
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View className="bg-white rounded-2xl border border-gray-200 p-6 w-full max-w-md gap-5">
          <View className="gap-1">
            <Text className="text-gray-900 text-xl font-semibold">
              {stage === 'form' ? 'New class' : 'Confirm class'}
            </Text>
            <Text className="text-gray-500">
              {stage === 'form'
                ? 'Schedule a class at any date and time.'
                : 'Review the details below before saving.'}
            </Text>
          </View>

          {stage === 'form' ? (
          <ScrollView className="max-h-[36rem]">
            <View className="gap-4">
              <ClassTypePicker value={classTypeId} onChange={setClassTypeId} />

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label={recurring ? 'Start date' : 'Date'}
                    value={dateStr}
                    onChangeText={setDateStr}
                    placeholder="2026-06-02"
                  />
                </View>
                {!recurring ? (
                  <View className="flex-1">
                    <Input
                      label="Start time"
                      value={timeStr}
                      onChangeText={setTimeStr}
                      placeholder="06:30"
                    />
                  </View>
                ) : null}
              </View>

              <Pressable
                onPress={() => setRecurring(!recurring)}
                className="flex-row items-center gap-2">
                <View
                  className={`w-5 h-5 rounded border-2 items-center justify-center ${
                    recurring ? 'border-primary bg-primary' : 'border-gray-300'
                  }`}>
                  {recurring ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                </View>
                <Text className="text-gray-900">Recurring</Text>
              </Pressable>

              {recurring ? (
                <>
                  <View className="gap-1.5">
                    <Text className="text-gray-700 text-sm font-medium">Days</Text>
                    <View className="flex-row gap-1.5">
                      {DAY_LETTERS.map((l, i) => {
                        const sel = days.has(i);
                        return (
                          <Pressable
                            key={i}
                            onPress={() => toggleDay(i)}
                            className={`flex-1 aspect-square rounded-lg items-center justify-center ${
                              sel ? 'bg-primary' : 'bg-gray-100'
                            }`}>
                            <Text
                              className={
                                sel
                                  ? 'text-white font-semibold'
                                  : 'text-gray-500 font-medium'
                              }>
                              {l}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View className="gap-1.5">
                    <Text className="text-gray-700 text-sm font-medium">Times</Text>
                    <View className="gap-2">
                      {times.map((t, idx) => (
                        <View key={idx} className="flex-row gap-2 items-end">
                          <View className="flex-1">
                            <Input
                              label=""
                              value={t}
                              onChangeText={(v) => {
                                const next = [...times];
                                next[idx] = v;
                                setTimes(next);
                              }}
                              placeholder="06:00"
                            />
                          </View>
                          <Pressable
                            onPress={() => {
                              if (times.length <= 1) return;
                              setTimes(times.filter((_, i) => i !== idx));
                            }}
                            disabled={times.length === 1}
                            className={`w-11 h-11 rounded-lg items-center justify-center ${
                              times.length === 1 ? 'opacity-40 bg-gray-100' : 'bg-gray-100'
                            }`}>
                            <Ionicons name="close" size={18} color="#6B7280" />
                          </Pressable>
                        </View>
                      ))}
                      {times.length < 6 ? (
                        <Pressable
                          onPress={() => setTimes([...times, '12:00'])}
                          className="flex-row items-center gap-1 self-start px-3 py-2 rounded-lg border border-dashed border-gray-300">
                          <Ionicons name="add" size={14} color="#6B7280" />
                          <Text className="text-gray-500 text-sm">Add time</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  {!indefinite ? (
                    <Input
                      label="Repeat for (weeks)"
                      value={weeks}
                      onChangeText={setWeeks}
                      keyboardType="numeric"
                      placeholder="4"
                    />
                  ) : null}

                  <Pressable
                    onPress={() => setIndefinite(!indefinite)}
                    className="flex-row items-center gap-2">
                    <View
                      className={`w-5 h-5 rounded border-2 items-center justify-center ${
                        indefinite ? 'border-primary bg-primary' : 'border-gray-300'
                      }`}>
                      {indefinite ? (
                        <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                      ) : null}
                    </View>
                    <Text className="text-gray-900">Repeat indefinitely</Text>
                  </Pressable>
                </>
              ) : null}

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label="Duration (min)"
                    value={durationMinutes}
                    onChangeText={setDurationMinutes}
                    keyboardType="numeric"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Capacity"
                    value={capacity}
                    onChangeText={setCapacity}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <Input
                label="Notes (optional)"
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>
          </ScrollView>
          ) : (
            <ConfirmView
              selectedType={selectedType}
              dateStr={dateStr}
              timeStr={timeStr}
              recurring={recurring}
              days={days}
              times={times}
              indefinite={indefinite}
              weeks={weeks}
              durationMinutes={durationMinutes}
              capacity={capacity}
              notes={notes}
              sessionCount={sessionsInHorizon()}
            />
          )}

          {error ? <Text className="text-red-500">{error}</Text> : null}

          {stage === 'form' ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={onClose}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button onPress={onReview}>Review</Button>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={() => setStage('form')}>
                  Edit
                </Button>
              </View>
              <View className="flex-1">
                <Button onPress={() => create.mutate()} loading={create.isPending}>
                  Confirm
                </Button>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ConfirmView({
  selectedType,
  dateStr,
  timeStr,
  recurring,
  days,
  times,
  indefinite,
  weeks,
  durationMinutes,
  capacity,
  notes,
  sessionCount,
}: {
  selectedType: { name: string; color: string } | undefined;
  dateStr: string;
  timeStr: string;
  recurring: boolean;
  days: Set<number>;
  times: string[];
  indefinite: boolean;
  weeks: string;
  durationMinutes: string;
  capacity: string;
  notes: string;
  sessionCount: number;
}) {
  const [y, mo, day] = dateStr.split('-').map(Number);
  const dateObj = y && mo && day ? new Date(y, mo - 1, day) : null;
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : dateStr;

  const daysList = [...days]
    .sort((a, b) => a - b)
    .map((i) => DAY_NAMES[i])
    .join(', ');

  const timesList = times
    .map((t) => t.trim())
    .filter((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t))
    .join(', ');

  return (
    <ScrollView className="max-h-[36rem]">
      <View className="gap-5">
        <ConfirmRow label="Type">
          <View className="flex-row items-center gap-2">
            {selectedType ? (
              <View
                style={{ backgroundColor: selectedType.color }}
                className="w-3 h-3 rounded-full"
              />
            ) : null}
            <Text className="text-gray-900 text-base font-medium">
              {selectedType?.name ?? 'Unknown'}
            </Text>
          </View>
        </ConfirmRow>

        {recurring ? (
          <ConfirmRow label="Repeats">
            <Text className="text-gray-900">
              {daysList || '—'} at {timesList || '—'}
            </Text>
            <Text className="text-gray-500 text-sm mt-1">
              Starting {dateLabel}
              {indefinite
                ? ' · indefinitely'
                : ` · for ${weeks} ${weeks === '1' ? 'week' : 'weeks'}`}
            </Text>
            <Text className="text-gray-500 text-sm mt-1">
              Materialising {sessionCount} session{sessionCount === 1 ? '' : 's'} in the first{' '}
              {indefinite ? '12 weeks' : 'batch'}
            </Text>
          </ConfirmRow>
        ) : (
          <ConfirmRow label="When">
            <Text className="text-gray-900">
              {dateLabel} at {timeStr}
            </Text>
          </ConfirmRow>
        )}

        <ConfirmRow label="Duration · Capacity">
          <Text className="text-gray-900">
            {durationMinutes} min · {capacity} spot{capacity === '1' ? '' : 's'}
          </Text>
        </ConfirmRow>

        {notes.trim() ? (
          <ConfirmRow label="Notes">
            <Text className="text-gray-900">{notes.trim()}</Text>
          </ConfirmRow>
        ) : null}
      </View>
    </ScrollView>
  );
}

function ConfirmRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1">
      <Text className="text-gray-500 text-xs uppercase tracking-widest">{label}</Text>
      {children}
    </View>
  );
}
