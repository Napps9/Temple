import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { isPinnedNow } from '@/lib/inbox-feed';
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
  pinned_from: string | null;
  pinned_until: string | null;
  closure_id: string | null;
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
function formatPinEnd(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

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
          'id, gym_id, title, body, pinned, pinned_from, pinned_until, closure_id, created_at, author:profiles!posted_by(full_name)',
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

  // The closure this notice is about (0257): the reader's own cancelled
  // classes, not a generic list — "what changed for YOU".
  const closureId = announcement.data?.closure_id ?? null;
  const closure = useQuery({
    queryKey: ['announcement-closure', closureId],
    enabled: !!closureId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_closures')
        .select('id, starts_on, ends_on, lifted_at')
        .eq('id', closureId!)
        .limit(1);
      if (error) throw error;
      return (
        ((data ?? [])[0] as
          | { starts_on: string; ends_on: string; lifted_at: string | null }
          | undefined) ?? null
      );
    },
  });
  const impact = useQuery({
    queryKey: ['announcement-impact', closureId, session?.user.id],
    enabled: !!closureId && !!session?.user.id,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('class_change_notifications')
        .select('body')
        .eq('closure_id', closureId!)
        .eq('recipient_profile_id', session!.user.id)
        .eq('channel', 'in_app')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => r.body as string);
    },
  });

  // Pinning is the one property of a posted announcement that can
  // change, and 0195 left no client UPDATE on this table — so it moves
  // through set_announcement_pin or not at all.
  const setPin = useMutation({
    mutationFn: async (until: string | null | 'off') => {
      const { error } = await supabase.rpc('set_announcement_pin', {
        p_announcement_id: id!,
        p_pinned: until !== 'off',
        p_pinned_from: until === 'off' ? null : new Date().toISOString(),
        p_pinned_until: until === 'off' ? null : until,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcement', id] });
      queryClient.invalidateQueries({ queryKey: ['gym-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['pinned-announcement'] });
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
                isPinnedNow(a) ? (
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

            {a.closure_id && !impact.isLoading ? (
              <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2.5">
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  What changed for you
                </Text>
                {(impact.data ?? []).length === 0 ? (
                  <View className="flex-row items-center gap-2">
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={16}
                      color={colors.ink3}
                    />
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm flex-1">
                      None of your bookings were affected.
                    </Text>
                  </View>
                ) : (
                  (impact.data ?? []).map((line, i) => (
                    <View key={i} className="flex-row items-start gap-2">
                      <Ionicons
                        name="calendar-outline"
                        size={15}
                        color={colors.ink3}
                        style={{ marginTop: 2 }}
                      />
                      <Text className="text-ink-2 dark:text-ink-2-dk text-sm flex-1">
                        {line}
                      </Text>
                    </View>
                  ))
                )}
                {closure.data?.lifted_at ? (
                  <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                    The gym has since reopened — cancelled classes are back on
                    the timetable, but your bookings were not restored.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {canSeeReach ? (
              <View className="flex-row items-center flex-wrap gap-1.5">
                {isPinnedNow(a) ? (
                  <>
                    <ChipButton
                      label="Unpin"
                      icon="close"
                      onPress={() => setPin.mutate('off')}
                    />
                    <ChipButton
                      label="Another week"
                      icon="pin"
                      onPress={() =>
                        setPin.mutate(
                          new Date(Date.now() + 7 * 86_400_000).toISOString(),
                        )
                      }
                    />
                  </>
                ) : (
                  <ChipButton
                    label="Pin for a week"
                    icon="pin"
                    onPress={() =>
                      setPin.mutate(
                        new Date(Date.now() + 7 * 86_400_000).toISOString(),
                      )
                    }
                  />
                )}
                {a.pinned && a.pinned_until ? (
                  <Text className="text-ink-3 dark:text-ink-3-dk text-xs pl-1">
                    Comes down {formatPinEnd(a.pinned_until)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {setPin.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {errorMessage(setPin.error, 'Could not change the pin')}
              </Text>
            ) : null}

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
