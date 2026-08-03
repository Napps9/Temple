import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { InviteSection } from '@/components/InviteSection';
import { MembersList } from '@/components/MembersList';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership } from '@/lib/auth';
import { useExportMembersCsv, exportErrorMessage } from '@/lib/csv-exports';
import { getScrollPosition, setScrollPosition } from '@/lib/list-scroll-position';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

export default function MembersScreen() {
  const { data: membership } = useGymMembership();
  const canManageTags = useCan('can_manage_tags');
  const canInvite = useCan('can_invite') ?? false;
  const canExport = useCan('can_export_members') ?? false;
  const exportMembers = useExportMembersCsv();
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollKey = membership?.gymId ? `members-list:${membership.gymId}` : null;

  // Coming back from a member's detail page replaces this screen rather
  // than popping back to it (see BackLink's fallbackHref comment), so it
  // remounts from scratch — restore where the user was scrolled to.
  useEffect(() => {
    if (!scrollKey) return;
    const y = getScrollPosition(scrollKey);
    if (y > 0) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y, animated: false });
      });
    }
  }, [scrollKey]);

  const totalQuery = useQuery({
    queryKey: ['members-total-count', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('v_member_cohort')
        .select('profile_id', { count: 'exact', head: true })
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (canManageTags === false) {
    return <Redirect href="/management" />;
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView
        ref={scrollRef}
        contentContainerClassName="gap-4 py-6 px-4 md:max-w-3xl md:mx-auto md:w-full"
        onScroll={(e) => {
          if (scrollKey) setScrollPosition(scrollKey, e.nativeEvent.contentOffset.y);
        }}
        scrollEventThrottle={100}>
        <BackLink fallbackHref="/management" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Members
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            {totalQuery.data ?? 0} members. Filter by cohort or search by name.
            Tap a member to open their detail page.
          </Text>
        </View>

        {canExport ? (
          <View className="gap-2">
            <ChipButton
              className="self-start"
              label={exportMembers.isPending ? 'Exporting…' : 'Export members CSV'}
              icon="download-outline"
              tone="neutral"
              onPress={() => exportMembers.mutate()}
              disabled={exportMembers.isPending}
            />
            {exportMembers.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {exportErrorMessage(exportMembers.error, 'members')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {canInvite ? (
          <InviteSection
            title="Invite members"
            subtitle="Email a member an invite to join your gym."
            roles={['member']}
            initialRole="member"
          />
        ) : null}

        <MembersList />
      </ScrollView>
    </Screen>
  );
}
