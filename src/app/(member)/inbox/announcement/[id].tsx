import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { timeAgo } from '@/lib/messaging';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';

type AnnouncementDetail = {
  id: string;
  gym_id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
  author: { full_name: string | null } | null;
};

// One announcement, in full. The feed shows a snippet; this is where a
// member reads the whole notice and says they have. "Got it" writes the
// same announcement_reads row the feed's Mark-all-read writes — reading
// IS the acknowledgement, there is no second concept.
//
// The "Read by X of Y members" line is staff-only by the owner's call:
// reach is a measure for the person who posts, not a score for the
// people who read. The RPC enforces the same gate server-side.
export default function AnnouncementDetail() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const queryClient = useQueryClient();
  const canSeeReach = useCan('can_post_announcements') === true;

  const announcement = useQuery({
    queryKey: ['announcement', id],
    enabled: !!id,
    queryFn: async (): Promise<AnnouncementDetail | null> => {
      const { data, error } = await supabase
        .from('gym_announcements')
        .select(
          'id, gym_id, title, body, pinned, created_at, author:profiles!posted_by(full_name)',
        )
        .eq('id', id!)
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] as unknown as AnnouncementDetail) ?? null;
    },
  });

  const readState = useQuery({
    queryKey: ['announcement-read', id, session?.user.id],
    enabled: !!id && !!session?.user.id,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('announcement_id', id!)
        .eq('profile_id', session!.user.id)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });

  const stats = useQuery({
    queryKey: ['announcement-read-stats', id],
    enabled: !!id && canSeeReach,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('announcement_read_stats', {
        p_announcement_id: id!,
      });
      if (error) throw error;
      return (data ?? [])[0] as
        | { read_count: number; member_count: number }
        | undefined;
    },
  });

  const gotIt = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('announcement_reads').upsert(
        [{ announcement_id: id!, profile_id: session!.user.id }],
        { onConflict: 'announcement_id,profile_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcement-read', id] });
      queryClient.invalidateQueries({ queryKey: ['my-announcement-reads'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-unread-summary'] });
      queryClient.invalidateQueries({ queryKey: ['announcement-read-stats', id] });
    },
  });

  const a = announcement.data;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/inbox" />

        {announcement.isLoading ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
        ) : !a ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">
            This announcement is gone — it may have been deleted.
          </Text>
        ) : (
          <>
            <PageHead
              title={a.title}
              subtitle={`Posted by ${a.author?.full_name ?? 'the gym'} · ${timeAgo(a.created_at)}`}
              action={
                a.pinned ? (
                  <View className="flex-row items-center gap-1 rounded-full bg-raised dark:bg-raised-dk px-2.5 py-1">
                    <Ionicons name="pin" size={12} color={colors.ink2} />
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-semibold">
                      Pinned
                    </Text>
                  </View>
                ) : undefined
              }
            />

            <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
              <Text className="text-ink dark:text-ink-dk text-[15px] leading-6">
                {a.body}
              </Text>
            </View>

            {canSeeReach && stats.data ? (
              <View className="flex-row items-center gap-2 border-t border-line dark:border-line-dk pt-3">
                <Ionicons name="eye-outline" size={15} color={colors.ink3} />
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  Read by {stats.data.read_count} of {stats.data.member_count}{' '}
                  members
                </Text>
              </View>
            ) : null}

            {readState.data ? (
              <View className="flex-row items-center gap-2">
                <Ionicons name="checkmark-circle" size={16} color={colors.ink3} />
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  You've read this.
                </Text>
              </View>
            ) : (
              <Button
                onPress={() => gotIt.mutate()}
                loading={gotIt.isPending}
                icon="checkmark">
                Got it
              </Button>
            )}
            {gotIt.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {errorMessage(gotIt.error, 'Could not mark as read')}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
