// Booking one-to-one time: an intro, a consult, an hour with a coach.
//
// The slots are computed, never materialised (0276) — an appointment does
// not exist until somebody takes it — so this asks the server what is free
// each time rather than reading a table of empty sessions.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { SectionLabel } from './SectionLabel';
import { Text } from './Text';

import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { invalidateBookingCaches } from '@/lib/bookings';
import { supabase } from '@/lib/supabase';

type ApptType = {
  id: string;
  name: string;
  color: string;
  appointment_minutes: number | null;
};

type Slot = { starts_at: string; coach_id: string; coach_name: string };

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AppointmentBooking() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const gymId = membership?.gymId;
  const [typeId, setTypeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ['appointment-types', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ApptType[]> => {
      const { data, error: e } = await supabase
        .from('class_types')
        .select('id, name, color, appointment_minutes')
        .eq('gym_id', gymId!)
        .eq('is_appointment', true)
        .is('archived_at', null)
        .order('name');
      if (e) throw e;
      return (data ?? []) as ApptType[];
    },
  });

  const active = typeId ?? types.data?.[0]?.id ?? null;

  const slots = useQuery({
    queryKey: ['appointment-slots', gymId, active],
    enabled: !!gymId && !!active,
    queryFn: async (): Promise<Slot[]> => {
      const from = new Date();
      const to = new Date(from.getTime() + 27 * 86400000);
      const { data, error: e } = await supabase.rpc('appointment_slots', {
        p_gym_id: gymId!,
        p_class_type_id: active!,
        p_from: isoDate(from),
        p_to: isoDate(to),
      });
      if (e) throw e;
      return (data ?? []) as Slot[];
    },
  });

  const book = useMutation({
    mutationFn: async (slot: Slot) => {
      if (!gymId || !active) throw new Error('Missing context');
      const { error: e } = await supabase.rpc('book_appointment', {
        p_gym_id: gymId,
        p_class_type_id: active,
        p_coach_id: slot.coach_id,
        p_starts_at: slot.starts_at,
      });
      if (e) throw e;
      return slot;
    },
    onSuccess: (slot) => {
      setError(null);
      setBooked(slot.starts_at);
      invalidateBookingCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: ['appointment-slots'] });
    },
    // The refusals worth reading are the server's own — "That time is not
    // available" when somebody took it first, and the waiver and PAR-Q
    // gates, which an appointment does not get around.
    onError: (e) => setError(errorMessage(e, 'Could not book that time')),
  });

  if (types.isLoading) return null;
  if ((types.data ?? []).length === 0) return null;

  const byDay = new Map<string, Slot[]>();
  for (const s of slots.data ?? []) {
    const key = isoDate(new Date(s.starts_at));
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }

  return (
    <View className="gap-3">
      <SectionLabel>Book time with a coach</SectionLabel>

      {(types.data ?? []).length > 1 ? (
        <View className="flex-row gap-2 flex-wrap">
          {(types.data ?? []).map((t) => (
            <Pressable
              key={t.id}
              onPress={() => {
                setTypeId(t.id);
                setBooked(null);
              }}
              className={`flex-row items-center gap-2 rounded-full px-3 py-2 ${
                active === t.id
                  ? 'bg-ink dark:bg-ink-dk'
                  : 'bg-raised dark:bg-raised-dk'
              }`}>
              <View
                style={{ backgroundColor: t.color }}
                className="w-2 h-2 rounded-full"
              />
              <Text
                className={`text-xs font-semibold ${
                  active === t.id
                    ? 'text-ground dark:text-ground-dk'
                    : 'text-ink-2 dark:text-ink-2-dk'
                }`}>
                {t.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {slots.isLoading ? (
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
          Finding free times…
        </Text>
      ) : byDay.size === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No times free"
          description="Nobody has published availability for this yet. Ask at the desk and they can open some up."
        />
      ) : (
        [...byDay.entries()].slice(0, 10).map(([day, daySlots]) => (
          <View key={day} className="gap-2">
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs font-semibold uppercase tracking-wider">
              {dayLabel(day)}
            </Text>
            <View className="flex-row gap-2 flex-wrap">
              {daySlots.map((s) => (
                <View key={`${s.starts_at}-${s.coach_id}`}>
                  <Button
                    variant={booked === s.starts_at ? 'primary' : 'secondary'}
                    loading={book.isPending && book.variables?.starts_at === s.starts_at}
                    success={booked === s.starts_at}
                    onPress={() => book.mutate(s)}>
                    {`${timeLabel(s.starts_at)} · ${s.coach_name.split(' ')[0]}`}
                  </Button>
                </View>
              ))}
            </View>
          </View>
        ))
      )}

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}
    </View>
  );
}
