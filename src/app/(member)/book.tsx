import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { ClassesCalendar } from '@/components/ClassesCalendar';
import { MemberGetStartedChecklist } from '@/components/MemberGetStartedChecklist';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage, isParqRequiredError, isWaiverRequiredError } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

const EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1000;

type NextBooking = {
  id: string;
  class_session_id: string;
  class_sessions: {
    starts_at: string;
    class_types: { name: string; color: string } | null;
  } | null;
};

type RecommendedSession = {
  id: string;
  starts_at: string;
  class_types: { name: string; color: string } | null;
};

function fmtNext(start: Date) {
  const date = start.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  const time = `${start.getHours().toString().padStart(2, '0')}:${start
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  return `${date} at ${time}`;
}

function RecommendedClassCard() {
  const colors = useThemeColors();
  const session = useSession();
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Pick the class type the member attended most often over the last
  // eight weeks (attended_at present, not just booked). Returns null
  // when the member has no attendance history — we hide the card in
  // that case to avoid a cold-start recommendation.
  const favouriteType = useQuery({
    queryKey: ['my-favourite-class-type', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<string | null> => {
      const sinceIso = new Date(Date.now() - EIGHT_WEEKS_MS).toISOString();
      const { data, error: err } = await supabase
        .from('class_bookings')
        .select('class_sessions!inner(class_type_id)')
        .eq('profile_id', session!.user.id)
        .not('attended_at', 'is', null)
        .gte('attended_at', sinceIso);
      if (err) throw err;
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as unknown as {
        class_sessions: { class_type_id: string | null } | null;
      }[]) {
        const id = row.class_sessions?.class_type_id;
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      let topId: string | null = null;
      let topCount = 0;
      for (const [id, c] of counts) {
        if (c > topCount) {
          topCount = c;
          topId = id;
        }
      }
      return topId;
    },
  });

  // Future bookings the member already has — used to filter out the
  // class they'd otherwise be recommended to "quick book."
  const futureBooked = useQuery({
    queryKey: ['my-future-bookings-set', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<Set<string>> => {
      const nowIso = new Date().toISOString();
      const { data, error: err } = await supabase
        .from('class_bookings')
        .select('class_session_id, class_sessions!inner(starts_at)')
        .eq('profile_id', session!.user.id)
        .gt('class_sessions.starts_at', nowIso);
      if (err) throw err;
      return new Set<string>(
        (data ?? []).map((r) => (r as { class_session_id: string }).class_session_id),
      );
    },
  });

  // Next upcoming session of the favoured class type that the member
  // hasn't already booked AND is actually entitled to book — the
  // is_booking_eligible RPC applies their membership (plan class-type
  // allowlists, credit balance, paid period, comp grants), so we never
  // recommend a class their plan doesn't cover.
  const recommendation = useQuery({
    queryKey: [
      'recommended-class',
      membership?.gymId,
      favouriteType.data,
      // The set's identity changes with each refetch; serialise so
      // React Query treats logically-equal sets as the same key.
      futureBooked.data ? Array.from(futureBooked.data).sort().join(',') : '',
    ],
    enabled: !!membership?.gymId && !!favouriteType.data && !!futureBooked.data,
    queryFn: async (): Promise<RecommendedSession | null> => {
      const nowIso = new Date().toISOString();
      const { data, error: err } = await supabase
        .from('class_sessions')
        .select('id, starts_at, class_type_id, class_types(name, color)')
        .eq('gym_id', membership!.gymId)
        .eq('class_type_id', favouriteType.data!)
        .gt('starts_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(10);
      if (err) throw err;
      const candidates = (data ?? []).filter(
        (r) => !futureBooked.data!.has((r as { id: string }).id),
      ) as unknown as RecommendedSession[];
      // Check eligibility soonest-first; cap the RPC round trips.
      for (const cand of candidates.slice(0, 6)) {
        const { data: ok, error: eligErr } = await supabase.rpc(
          'is_booking_eligible',
          {
            p_profile_id: session!.user.id,
            p_gym_id: membership!.gymId,
            p_class_session_id: cand.id,
          },
        );
        if (eligErr) throw eligErr;
        if (ok) return cand;
      }
      return null;
    },
  });

  const book = useMutation({
    mutationFn: async () => {
      const rec = recommendation.data;
      if (!rec) throw new Error('No class to book');
      const { error: e } = await supabase.rpc('book_class', { session_id: rec.id });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.success();
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['my-next-booking'] });
      queryClient.invalidateQueries({ queryKey: ['my-future-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['my-future-bookings-set'] });
      queryClient.invalidateQueries({ queryKey: ['class-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['recommended-class'] });
    },
    onError: (e) => {
      if (isWaiverRequiredError(e)) {
        router.push('/waiver');
        return;
      }
      if (isParqRequiredError(e)) {
        // Send the booker straight to the screening form rather than
        // making them parse a raw error.
        router.push('/parq');
        return;
      }
      haptic.error();
      setError(errorMessage(e, 'Could not book this class'));
    },
  });

  const rec = recommendation.data;
  if (!rec || !rec.class_types) return null;

  const start = new Date(rec.starts_at);
  const typeColor = rec.class_types.color ?? colors.primary;
  const typeName = rec.class_types.name ?? 'Class';

  return (
    <View className="gap-1">
      <Pressable
        onPress={() => book.mutate()}
        disabled={book.isPending}
        className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
        <View
          style={{ backgroundColor: typeColor }}
          className="rounded-full px-2 py-0.5">
          <Text className="text-white text-[10px] font-semibold">{typeName}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
            Recommended
          </Text>
          <Text className="text-gray-900 dark:text-gray-50 font-medium">
            {fmtNext(start)}
          </Text>
        </View>
        <ChipButton
          label={book.isPending ? 'Booking…' : 'Quick book'}
          icon="flash"
        />
      </Pressable>
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs px-3">{error}</Text>
      ) : null}
    </View>
  );
}

// One card doing two jobs: headline the member's next booked class,
// and route into the full bookings list (both used to be separate
// tiles navigating to the same place). Renders even with nothing
// booked so "My bookings" always has a way in.
function NextClassCard() {
  const colors = useThemeColors();
  const session = useSession();
  const nowIso = new Date().toISOString();
  const next = useQuery({
    queryKey: ['my-next-booking', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, class_session_id, class_sessions!inner(starts_at, class_types(name, color))',
        )
        .eq('profile_id', session!.user.id)
        .gt('class_sessions.starts_at', nowIso)
        .order('class_sessions(starts_at)', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as NextBooking | null;
    },
  });

  if (next.isLoading) return null;

  const sessionRow = next.data?.class_sessions ?? null;
  const start = sessionRow ? new Date(sessionRow.starts_at) : null;
  const typeColor = sessionRow?.class_types?.color ?? colors.primary;
  const typeName = sessionRow?.class_types?.name ?? 'Class';

  return (
    <Pressable
      onPress={() => router.push('/bookings')}
      className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
      <View className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
        <Ionicons name="ticket-outline" size={16} color="#6B7280" />
      </View>
      <View className="flex-1">
        <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
          {start ? 'Your next class' : 'My bookings'}
        </Text>
        <Text className="text-gray-900 dark:text-gray-50 font-medium">
          {start ? fmtNext(start) : 'Nothing booked yet'}
        </Text>
      </View>
      {start ? (
        <View
          style={{ backgroundColor: typeColor }}
          className="rounded-full px-2 py-0.5">
          <Text className="text-white text-[10px] font-semibold">{typeName}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
    </Pressable>
  );
}

export default function Book() {
  return (
    <ClassesCalendar
      mode="book"
      topSlot={
        <View className="gap-2">
          <MemberGetStartedChecklist />
          <RecommendedClassCard />
          <NextClassCard />
        </View>
      }
    />
  );
}
