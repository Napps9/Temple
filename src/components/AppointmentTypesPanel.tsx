// One-to-one time: the kinds of it a gym offers, and when each coach is
// around for it (0276).
//
// Its own panel rather than more fields on ClassTypesPanel. An appointment
// type has no recurrence, no capacity and no cancel-cutoff ladder — it has
// a length and a standing weekly pattern per coach — so folding it in
// would mean half that editor greyed out for half its rows.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from './Button';
import { ChipButton } from './ChipButton';
import { Input } from './Input';
import { Text } from './Text';

import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

// 0 = Sunday, matching gym_hours and class_recurrences. A third
// convention in one product is how a Monday becomes a Sunday.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ApptType = { id: string; name: string; appointment_minutes: number | null };
type Slot = {
  id: string;
  coach_id: string;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  profiles: { full_name: string | null } | null;
};
type Staff = { profile_id: string; profiles: { full_name: string | null } | null };

export function AppointmentTypesPanel() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const canEdit = useCan('can_edit_classes') ?? false;
  const gymId = membership?.gymId;

  const [newName, setNewName] = useState('');
  const [newMinutes, setNewMinutes] = useState('30');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [day, setDay] = useState(1);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('12:00');
  const [error, setError] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ['appointment-types-staff', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ApptType[]> => {
      const { data, error: e } = await supabase
        .from('class_types')
        .select('id, name, appointment_minutes')
        .eq('gym_id', gymId!)
        .eq('is_appointment', true)
        .is('archived_at', null)
        .order('name');
      if (e) throw e;
      return (data ?? []) as ApptType[];
    },
  });

  const staff = useQuery({
    queryKey: ['gym-staff', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<Staff[]> => {
      const { data, error: e } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', gymId!)
        .is('left_at', null)
        .in('role', ['owner', 'admin', 'coach']);
      if (e) throw e;
      return (data ?? []) as unknown as Staff[];
    },
  });

  const availability = useQuery({
    queryKey: ['coach-availability', gymId, openFor],
    enabled: !!gymId && !!openFor,
    queryFn: async (): Promise<Slot[]> => {
      const { data, error: e } = await supabase
        .from('coach_availability')
        .select('id, coach_id, day_of_week, starts_at, ends_at, profiles!coach_id(full_name)')
        .eq('gym_id', gymId!)
        .eq('class_type_id', openFor!)
        .eq('active', true)
        .order('day_of_week');
      if (e) throw e;
      return (data ?? []) as unknown as Slot[];
    },
  });

  const addType = useMutation({
    mutationFn: async () => {
      const name = newName.trim();
      if (!name) throw new Error('Give it a name');
      const minutes = Number(newMinutes.trim());
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
        throw new Error('Length must be between 5 and 480 minutes');
      }
      const { error: e } = await supabase.from('class_types').insert({
        gym_id: gymId!,
        name,
        color: '#7C3AED',
        is_appointment: true,
        appointment_minutes: minutes,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setNewName('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['appointment-types-staff'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not add that')),
  });

  const addSlot = useMutation({
    mutationFn: async () => {
      if (!coachId) throw new Error('Pick a coach');
      if (to <= from) throw new Error('The end has to be after the start');
      const { error: e } = await supabase.from('coach_availability').insert({
        gym_id: gymId!,
        coach_id: coachId,
        class_type_id: openFor!,
        day_of_week: day,
        starts_at: from,
        ends_at: to,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['coach-availability'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not add that')),
  });

  const removeSlot = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase
        .from('coach_availability')
        .delete()
        .eq('id', id);
      if (e) throw e;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['coach-availability'] }),
  });

  if (!canEdit) {
    return (
      <Text className="text-ink-2 dark:text-ink-2-dk">
        Only people who can edit classes can set up one-to-one time.
      </Text>
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs leading-5">
        Intros, consults and PT. A member picks a time from what a coach has
        open; it books as a session for one, through every gate a class
        booking passes. Nothing is written to the timetable until somebody
        takes it.
      </Text>

      {(types.data ?? []).map((t) => (
        <View
          key={t.id}
          className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 gap-3">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
              {t.name}
            </Text>
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              {t.appointment_minutes ?? 30} min
            </Text>
            <ChipButton
              tone="neutral"
              label={openFor === t.id ? 'Done' : 'When'}
              icon="time-outline"
              onPress={() => setOpenFor(openFor === t.id ? null : t.id)}
            />
          </View>

          {openFor === t.id ? (
            <View className="gap-3">
              {(availability.data ?? []).length === 0 ? (
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                  Nobody is open for this yet, so members see no times.
                </Text>
              ) : (
                (availability.data ?? []).map((s) => (
                  <View key={s.id} className="flex-row items-center gap-2">
                    <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm">
                      {s.profiles?.full_name ?? 'A coach'} · {DAYS[s.day_of_week]}{' '}
                      {s.starts_at.slice(0, 5)}–{s.ends_at.slice(0, 5)}
                    </Text>
                    <ChipButton
                      tone="red"
                      label="Remove"
                      icon="close-circle-outline"
                      onPress={() => removeSlot.mutate(s.id)}
                    />
                  </View>
                ))
              )}

              <View className="flex-row gap-2 flex-wrap">
                {(staff.data ?? []).map((m) => (
                  <Pressable
                    key={m.profile_id}
                    onPress={() => setCoachId(m.profile_id)}
                    className={`rounded-full px-3 py-1.5 ${
                      coachId === m.profile_id
                        ? 'bg-ink dark:bg-ink-dk'
                        : 'bg-raised dark:bg-raised-dk'
                    }`}>
                    <Text
                      className={`text-xs font-semibold ${
                        coachId === m.profile_id
                          ? 'text-ground dark:text-ground-dk'
                          : 'text-ink-2 dark:text-ink-2-dk'
                      }`}>
                      {m.profiles?.full_name ?? 'Coach'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View className="flex-row gap-1.5 flex-wrap">
                {DAYS.map((d, i) => (
                  <Pressable
                    key={d}
                    onPress={() => setDay(i)}
                    className={`rounded-ctl px-2.5 py-1.5 ${
                      day === i ? 'bg-ink dark:bg-ink-dk' : 'bg-raised dark:bg-raised-dk'
                    }`}>
                    <Text
                      className={`text-xs font-semibold ${
                        day === i
                          ? 'text-ground dark:text-ground-dk'
                          : 'text-ink-2 dark:text-ink-2-dk'
                      }`}>
                      {d}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input label="From" value={from} onChangeText={setFrom} placeholder="09:00" />
                </View>
                <View className="flex-1">
                  <Input label="To" value={to} onChangeText={setTo} placeholder="12:00" />
                </View>
              </View>

              <Button
                variant="secondary"
                loading={addSlot.isPending}
                onPress={() => addSlot.mutate()}>
                Add these hours
              </Button>
            </View>
          ) : null}
        </View>
      ))}

      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-3 gap-2">
        <Text className="text-ink dark:text-ink-dk font-semibold text-sm">
          Add a kind of appointment
        </Text>
        <View className="flex-row gap-2">
          <View className="flex-[2]">
            <Input
              label="Name"
              value={newName}
              onChangeText={setNewName}
              placeholder="Intro consult"
            />
          </View>
          <View className="flex-1">
            <Input
              label="Minutes"
              value={newMinutes}
              onChangeText={setNewMinutes}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <Button
          variant="secondary"
          loading={addType.isPending}
          onPress={() => addType.mutate()}>
          Add
        </Button>
      </View>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}
    </View>
  );
}
