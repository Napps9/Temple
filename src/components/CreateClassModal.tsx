import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

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
  const [name, setName] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [capacity, setCapacity] = useState('12');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const d = defaultDate ?? new Date();
    setName('');
    setDateStr(fmtDate(d));
    setTimeStr(defaultTimeFor(defaultHour));
    setDurationMinutes('60');
    setCapacity('12');
    setNotes('');
    setError(null);
  }, [visible, defaultDate, defaultHour]);

  const create = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      if (!name.trim()) throw new Error('Name is required');
      if (!DATE_RE.test(dateStr)) throw new Error('Date must be YYYY-MM-DD');
      if (!TIME_RE.test(timeStr)) throw new Error('Time must be HH:MM (24-hour)');

      const dur = parseInt(durationMinutes, 10);
      const cap = parseInt(capacity, 10);
      if (!Number.isFinite(dur) || dur <= 0) {
        throw new Error('Duration must be a positive number of minutes');
      }
      if (!Number.isFinite(cap) || cap <= 0) {
        throw new Error('Capacity must be a positive number');
      }

      const [y, mo, day] = dateStr.split('-').map(Number);
      const [h, mi] = timeStr.split(':').map(Number);
      const startsAt = new Date(y, mo - 1, day, h, mi, 0, 0);
      if (Number.isNaN(startsAt.getTime())) {
        throw new Error('Invalid date or time');
      }

      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');

      const { error } = await supabase.from('class_sessions').insert({
        gym_id: membership.gymId,
        name: name.trim(),
        starts_at: startsAt.toISOString(),
        duration_minutes: dur,
        capacity: cap,
        notes: notes.trim() || null,
        coach_id: userResp.user.id,
        created_by: userResp.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      onCreated();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create class'),
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

          <ScrollView className="max-h-[28rem]">
            <View className="gap-4">
              <Input
                label="Name"
                value={name}
                onChangeText={setName}
                placeholder="CrossFit"
                autoCapitalize="words"
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label="Date"
                    value={dateStr}
                    onChangeText={setDateStr}
                    placeholder="2026-06-02"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Start time"
                    value={timeStr}
                    onChangeText={setTimeStr}
                    placeholder="06:30"
                  />
                </View>
              </View>
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
