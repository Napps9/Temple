import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { ClassDetailModal } from '@/components/ClassDetailModal';
import { ClassesCalendar } from '@/components/ClassesCalendar';
import { PostClassLogPrompt } from '@/components/PostClassLogPrompt';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage, isParqRequiredError, isWaiverRequiredError } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import {
  EIGHT_WEEKS_MS,
  buildTasteProfile,
  scoreSession,
  type AttendedRow,
} from '@/lib/recommend';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  class_type_id: string | null;
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

// Shared by RecommendedClassCard (renders the standalone card) and Book
// (which needs the session id to highlight the matching agenda row) —
// react-query dedupes the underlying fetches since both call sites share
// the same query keys.
function useRecommendedClass() {
  const session = useSession();
  const { data: membership } = useGymMembership();

  // The member's attendance over the last eight weeks: each attended
  // class contributes its type and the hour it ran at. Feeds the taste
  // profile below. Empty for a member with no attendance history — we
  // hide the card in that case to avoid a cold-start recommendation.
  const history = useQuery({
    queryKey: ['my-attendance-history', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async (): Promise<AttendedRow[]> => {
      const sinceIso = new Date(Date.now() - EIGHT_WEEKS_MS).toISOString();
      const { data, error: err } = await supabase
        .from('class_bookings')
        .select('attended_at, class_sessions!inner(class_type_id, starts_at)')
        .eq('profile_id', session!.user.id)
        .not('attended_at', 'is', null)
        .gte('attended_at', sinceIso);
      if (err) throw err;
      return (data ?? []).map((r) => {
        const row = r as unknown as {
          attended_at: string;
          class_sessions: {
            class_type_id: string | null;
            starts_at: string;
          } | null;
        };
        return {
          typeId: row.class_sessions?.class_type_id ?? null,
          startedAt: row.class_sessions?.starts_at ?? null,
          attendedAt: row.attended_at,
        };
      });
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

  const historyRows = history.data;
  // Stable identity for the attendance set, independent of wall-clock, so
  // re-renders don't thrash the query key. The day bucket below lets the
  // recency weighting re-settle once a day.
  const historyKey = useMemo(
    () =>
      (historyRows ?? [])
        .map((r) => `${r.typeId}@${r.startedAt}`)
        .sort()
        .join('|'),
    [historyRows],
  );

  // Rank every upcoming session across the member's attended class types
  // by the blended taste score (type affinity + time-of-day + soonness),
  // then return the best one they haven't booked AND are entitled to
  // book — is_booking_eligible applies their membership (plan class-type
  // allowlists, credit balance, paid period, comp grants), so we never
  // recommend a class their plan doesn't cover.
  const recommendation = useQuery({
    queryKey: [
      'recommended-class',
      membership?.gymId,
      historyKey,
      Math.floor(Date.now() / DAY_MS),
      // The set's identity changes with each refetch; serialise so
      // React Query treats logically-equal sets as the same key.
      futureBooked.data ? Array.from(futureBooked.data).sort().join(',') : '',
    ],
    enabled:
      !!membership?.gymId &&
      !!historyRows &&
      historyRows.length > 0 &&
      !!futureBooked.data,
    queryFn: async (): Promise<RecommendedSession | null> => {
      const nowMs = Date.now();
      const profile = buildTasteProfile(historyRows!, nowMs);
      if (profile.affinity.size === 0) return null;
      const typeIds = [...profile.affinity.keys()];
      const maxAffinity = Math.max(...profile.affinity.values());

      const { data, error: err } = await supabase
        .from('class_sessions')
        .select('id, starts_at, class_type_id, class_types(name, color)')
        .eq('gym_id', membership!.gymId)
        .in('class_type_id', typeIds)
        .gt('starts_at', new Date(nowMs).toISOString())
        .order('starts_at', { ascending: true })
        .limit(40);
      if (err) throw err;

      const ranked = (data ?? [])
        .map((r) => r as unknown as RecommendedSession)
        .filter((s) => !futureBooked.data!.has(s.id))
        .map((s) => ({ s, score: scoreSession(profile, maxAffinity, s, nowMs) }))
        .sort((a, b) => b.score - a.score);

      // Check eligibility best-first; cap the RPC round trips.
      for (const { s } of ranked.slice(0, 6)) {
        const { data: ok, error: eligErr } = await supabase.rpc(
          'is_booking_eligible',
          {
            p_profile_id: session!.user.id,
            p_gym_id: membership!.gymId,
            p_class_session_id: s.id,
          },
        );
        if (eligErr) throw eligErr;
        if (ok) return s;
      }
      return null;
    },
  });

  return recommendation;
}

function RecommendedClassCard() {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const recommendation = useRecommendedClass();

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
        onPress={() => {
          haptic.tap();
          setDetailOpen(true);
        }}
        className="bg-white dark:bg-gray-900 rounded-xl p-3 flex-row items-center gap-3 active:opacity-70">
        <View
          style={{ backgroundColor: typeColor }}
          className="rounded-full px-2 py-0.5">
          <Text className="text-white text-[10px] font-semibold">{typeName}</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-1">
            <Ionicons name="sparkles" size={11} color="#A855F7" />
            <Text className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-widest">
              Recommended
            </Text>
          </View>
          <Text className="text-gray-900 dark:text-gray-50 font-medium">
            {fmtNext(start)}
          </Text>
        </View>
        {/* Its own onPress — a nested Pressable inside the row, same
            pattern as the programming card's "View leaderboard" chip —
            so quick-booking stays a one-tap shortcut without the row
            tap (which opens full class details) firing at the same time. */}
        <ChipButton
          label={book.isPending ? 'Booking…' : 'Quick book'}
          icon="flash"
          disabled={book.isPending}
          onPress={() => book.mutate()}
        />
      </Pressable>
      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs px-3">{error}</Text>
      ) : null}
      <ClassDetailModal
        visible={detailOpen}
        sessionId={rec.id}
        mode="book"
        recommended
        onClose={() => setDetailOpen(false)}
      />
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
  const recommendation = useRecommendedClass();
  return (
    <ClassesCalendar
      mode="book"
      recommendedSessionId={recommendation.data?.id ?? null}
      headerSlot={
        <View className="gap-2">
          <PostClassLogPrompt />
          <RecommendedClassCard />
          <NextClassCard />
        </View>
      }
    />
  );
}
