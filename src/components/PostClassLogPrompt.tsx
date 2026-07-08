import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { RecordWorkoutModal } from '@/components/RecordWorkoutModal';
import { useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

// After a member attends a class, nudge them to log how it went — the
// habit loop that makes /track worth opening. Shows the most recent class
// they booked in the last ~2 days, and self-dismisses the moment they log
// any workout dated at/after that class (so it never nags someone who's
// already logging). Plus a manual dismiss for this session.

const WINDOW_MS = 48 * 60 * 60 * 1000;

type PastBooking = {
  id: string;
  class_session_id: string;
  class_sessions: {
    starts_at: string;
    class_type_id: string | null;
    class_types: { name: string; color: string } | null;
  } | null;
};

function relativeDay(start: Date): string {
  const now = new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - startDay.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return start.toLocaleDateString(undefined, { weekday: 'long' });
}

function fmtDateLocal(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

export function PostClassLogPrompt() {
  const colors = useThemeColors();
  const session = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [recording, setRecording] = useState(false);

  const recent = useQuery({
    queryKey: ['my-recent-past-booking', userId],
    enabled: !!userId,
    queryFn: async (): Promise<PastBooking | null> => {
      const now = new Date();
      const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from('class_bookings')
        .select(
          'id, class_session_id, class_sessions!inner(starts_at, class_type_id, class_types(name, color))',
        )
        .eq('profile_id', userId!)
        .lt('class_sessions.starts_at', now.toISOString())
        .gt('class_sessions.starts_at', cutoff)
        .order('class_sessions(starts_at)', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PastBooking | null;
    },
  });

  const classStart = recent.data?.class_sessions?.starts_at ?? null;

  // Have they already logged anything since the class? If so, drop the nudge.
  const loggedSince = useQuery({
    queryKey: ['logged-since-class', userId, classStart],
    enabled: !!userId && !!classStart,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('tracked_workouts')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId!)
        .gte('created_at', classStart!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (dismissed || !userId) return null;
  if (recent.isLoading || !recent.data || !classStart) return null;
  if (loggedSince.isLoading || (loggedSince.data ?? 0) > 0) return null;

  const typeName = recent.data.class_sessions?.class_types?.name ?? 'your class';
  const accent = recent.data.class_sessions?.class_types?.color ?? colors.primary;
  const when = relativeDay(new Date(classStart));

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-primary/30">
      <View className="flex-row items-center gap-3">
        <View
          style={{ backgroundColor: accent + '26' }}
          className="w-11 h-11 rounded-full items-center justify-center">
          <Ionicons name="barbell-outline" size={22} color={accent} />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            How was {typeName}?
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            You trained {when} — log your result while it's fresh.
          </Text>
        </View>
        <Pressable
          onPress={() => setDismissed(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          className="active:opacity-70">
          <Ionicons name="close" size={18} color="#9CA3AF" />
        </Pressable>
      </View>
      <Pressable
        onPress={() => setRecording(true)}
        className="bg-primary rounded-lg py-3 items-center justify-center active:bg-primary-dark">
        <Text className="text-white font-semibold">Log your workout</Text>
      </Pressable>
      {/* Same flow the Programming page's "Record results" prompt opens —
          pre-filled with this class's date and tied to its session id,
          rather than dropping the member into a blank /track screen. */}
      <RecordWorkoutModal
        visible={recording}
        onClose={() => {
          setRecording(false);
          queryClient.invalidateQueries({ queryKey: ['logged-since-class'] });
        }}
        initialDate={fmtDateLocal(new Date(classStart))}
        initialClassSessionId={recent.data.class_session_id}
        initialClassTypeId={recent.data.class_sessions?.class_type_id ?? null}
      />
    </View>
  );
}
