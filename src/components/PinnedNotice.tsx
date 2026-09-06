import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Text } from './Text';
import { useGymMembership, useSession } from '@/lib/auth';
import { haptic } from '@/lib/haptic';
import { isPinnedNow } from '@/lib/inbox-feed';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

type PinnedRow = {
  id: string;
  title: string;
  pinned: boolean;
  pinned_from: string | null;
  pinned_until: string | null;
  created_at: string;
};

// The gym's one live notice, above every member screen. An announcement
// has always landed in the Inbox and stopped there, which is fine for
// the ones you read eventually and useless for "we're closed Monday" —
// the owner's ask was somewhere it cannot be missed.
//
// One notice, never a stack: the newest live pin wins. A column of
// banners is a second inbox, and the thing that makes this work is that
// it is rare.
//
// Ink, not the accent. The accent is the page's single action, and a
// notice that outranked the button under it would be the loudest thing
// on every screen for a week.
//
// Dismissing writes the same announcement_reads row the Inbox writes.
// Having seen it IS having read it — there is no second concept, and it
// clears the bell at the same time.
export function PinnedNotice() {
  const colors = useThemeColors();
  const session = useSession();
  const membership = useGymMembership();
  const queryClient = useQueryClient();
  const gymId = membership.data?.gymId ?? null;
  const uid = session?.user.id ?? null;

  const pinned = useQuery({
    queryKey: ['pinned-announcement', gymId, uid],
    enabled: !!gymId && !!uid,
    queryFn: async (): Promise<PinnedRow | null> => {
      const { data, error } = await supabase
        .from('gym_announcements')
        .select('id, title, pinned, pinned_from, pinned_until, created_at')
        .eq('gym_id', gymId!)
        .eq('pinned', true)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      const live = ((data ?? []) as PinnedRow[]).filter((a) => isPinnedNow(a));
      if (live.length === 0) return null;

      const { data: reads, error: readErr } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('profile_id', uid!)
        .in(
          'announcement_id',
          live.map((a) => a.id),
        );
      if (readErr) throw readErr;
      const seen = new Set(
        (reads ?? []).map((r) => (r as { announcement_id: string }).announcement_id),
      );
      return live.find((a) => !seen.has(a.id)) ?? null;
    },
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('announcement_reads')
        .upsert([{ announcement_id: id, profile_id: uid! }], {
          onConflict: 'announcement_id,profile_id',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pinned-announcement'] });
      queryClient.invalidateQueries({ queryKey: ['my-announcement-reads'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
    },
  });

  const notice = pinned.data;
  if (!notice) return null;

  return (
    <View className="px-4 md:px-6 pt-2 pb-2">
      <View
        accessibilityRole="alert"
        className="flex-row items-center gap-2 rounded-card border border-line-strong dark:border-line-strong-dk bg-raised dark:bg-raised-dk px-3 py-2">
        <Ionicons name="pin" size={14} color={colors.ink2} />
        <Pressable
          onPress={() => {
            haptic.selection();
            router.push(`/inbox/announcement/${notice.id}` as never);
          }}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={`Notice: ${notice.title}`}
          className="flex-1 active:opacity-70">
          <Text
            className="text-ink dark:text-ink-dk text-sm font-medium"
            numberOfLines={1}>
            {notice.title}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic.selection();
            dismiss.mutate(notice.id);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
          className="active:opacity-70">
          <Ionicons name="close" size={16} color={colors.ink3} />
        </Pressable>
      </View>
    </View>
  );
}
