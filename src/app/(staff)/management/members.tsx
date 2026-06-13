import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { MembersList } from '@/components/MembersList';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { useGymMembership } from '@/lib/auth';
import { useExportMembersCsv, exportErrorMessage } from '@/lib/csv-exports';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

export default function MembersScreen() {
  const { data: membership } = useGymMembership();
  const canManageTags = useCan('can_manage_tags');
  const canExport = useCan('can_export_members') ?? false;
  const exportMembers = useExportMembersCsv();

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
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-3xl md:mx-auto md:w-full">
        <BackLink label="Manage" />
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

        <MembersList />
      </ScrollView>
    </Screen>
  );
}
