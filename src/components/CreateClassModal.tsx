import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export function CreateClassModal({
  visible,
  date,
  hour,
  onClose,
  onCreated,
}: {
  visible: boolean;
  date: Date;
  hour: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: membership } = useGymMembership();
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [capacity, setCapacity] = useState('12');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userResp.user) throw userErr ?? new Error('Not signed in');

      const dur = parseInt(durationMinutes, 10);
      const cap = parseInt(capacity, 10);
      if (!name.trim()) throw new Error('Name is required');
      if (!Number.isFinite(dur) || dur <= 0) throw new Error('Duration must be a positive number');
      if (!Number.isFinite(cap) || cap <= 0) throw new Error('Capacity must be a positive number');

      const startsAt = new Date(date);
      startsAt.setHours(hour, 0, 0, 0);

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
      setName('');
      setDurationMinutes('60');
      setCapacity('12');
      setNotes('');
      setError(null);
      onCreated();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create class'),
  });

  const timeLabel = `${hour.toString().padStart(2, '0')}:00`;
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View className="bg-white rounded-2xl border border-gray-200 p-6 w-full max-w-md gap-5">
          <View className="gap-1">
            <Text className="text-gray-900 text-xl font-semibold">New class</Text>
            <Text className="text-gray-500">
              Starting at {timeLabel} on {dateLabel}
            </Text>
          </View>

          <ScrollView className="max-h-96">
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
