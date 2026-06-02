import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
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

type SessionInsert = {
  gym_id: string;
  name: string;
  class_type_id: string;
  starts_at: string;
  duration_minutes: number;
  capacity: number;
  notes: string | null;
  coach_id: string;
  created_by: string;
};

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
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [capacity, setCapacity] = useState('12');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    setDurationMinutes('60');
    setCapacity('12');
    setNotes('');
    setError(null);
  }, [visible, defaultDate, defaultHour]);

  function toggleDay(i: number) {
    const next = new Set(days);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDays(next);
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

      const { data: typeRow, error: typeErr } = await supabase
        .from('class_types')
        .select('name')
        .eq('id', classTypeId)
        .single();
      if (typeErr || !typeRow) throw typeErr ?? new Error('Class type not found');
      const typeName = typeRow.name;

      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');
      const userId = userResp.user.id;

      const [y, mo, day] = dateStr.split('-').map(Number);

      const rows: SessionInsert[] = [];
      const baseRow = {
        gym_id: membership.gymId,
        name: typeName,
        class_type_id: classTypeId,
        duration_minutes: dur,
        capacity: cap,
        notes: notes.trim() || null,
        coach_id: userId,
        created_by: userId,
      };

      if (recurring) {
        if (days.size === 0) throw new Error('Pick at least one day');
        const validTimes = times.map((t) => t.trim()).filter(Boolean);
        if (validTimes.length === 0) throw new Error('Add at least one time');
        for (const t of validTimes) {
          if (!TIME_RE.test(t)) throw new Error(`Time "${t}" must be HH:MM (24-hour)`);
        }
        if (validTimes.length > 6) throw new Error('At most 6 times per pattern');
        const w = parseInt(weeks, 10);
        if (!Number.isFinite(w) || w < 1 || w > 26) {
          throw new Error('Repeat must be between 1 and 26 weeks');
        }

        const start = new Date(y, mo - 1, day);
        start.setHours(0, 0, 0, 0);
        for (let dayOffset = 0; dayOffset < w * 7; dayOffset++) {
          const d = new Date(start);
          d.setDate(d.getDate() + dayOffset);
          if (!days.has(d.getDay())) continue;
          for (const t of validTimes) {
            const [h, mi] = t.split(':').map(Number);
            const startsAt = new Date(
              d.getFullYear(),
              d.getMonth(),
              d.getDate(),
              h,
              mi,
              0,
              0,
            );
            rows.push({ ...baseRow, starts_at: startsAt.toISOString() });
          }
        }
        if (rows.length === 0) {
          throw new Error('Pattern produces no sessions — check days and weeks');
        }
      } else {
        if (!TIME_RE.test(timeStr)) throw new Error('Time must be HH:MM (24-hour)');
        const [h, mi] = timeStr.split(':').map(Number);
        const startsAt = new Date(y, mo - 1, day, h, mi, 0, 0);
        rows.push({ ...baseRow, starts_at: startsAt.toISOString() });
      }

      const { error } = await supabase.from('class_sessions').insert(rows);
      if (error) throw error;
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
            <Text className="text-gray-900 text-xl font-semibold">New class</Text>
            <Text className="text-gray-500">
              Schedule a class at any date and time.
            </Text>
          </View>

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

                  <Input
                    label="Repeat for (weeks)"
                    value={weeks}
                    onChangeText={setWeeks}
                    keyboardType="numeric"
                    placeholder="4"
                  />
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

          {error ? <Text className="text-red-500">{error}</Text> : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" onPress={onClose}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button onPress={() => create.mutate()} loading={create.isPending}>
                Create
              </Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
