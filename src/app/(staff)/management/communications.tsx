import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { CampaignList } from '@/components/email/CampaignList';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { StatTile } from '@/components/StatTile';
import { useCampaigns } from '@/lib/comms';
import { useCan } from '@/lib/useCan';

// Reusable overview + list, also embedded in the Manage → Comms tab.
export function CommunicationsHome() {
  const campaigns = useCampaigns();

  const stats = useMemo(() => {
    const rows = campaigns.data ?? [];
    const sent = rows.filter((r) => r.status === 'sent');
    const reached = sent.reduce((acc, r) => acc + r.recipient_count, 0);
    return { total: rows.length, sent: sent.length, reached };
  }, [campaigns.data]);

  return (
    <View className="gap-4">
      <View className="flex-row gap-3 flex-wrap">
        <StatTile title="Campaigns" value={stats.total} minWidth={100} />
        <StatTile title="Sent" value={stats.sent} minWidth={100} />
        <StatTile title="Emails delivered" value={stats.reached} minWidth={100} />
      </View>

      <Link href="/management/communications/settings" asChild>
        <Pressable className="flex-row items-center gap-3 bg-white dark:bg-gray-900 rounded-xl p-4 active:opacity-70">
          <View className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
            <Ionicons name="settings-outline" size={18} color="#6B7280" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Sender & footer
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              From name, reply-to, and the required postal-address footer.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </Pressable>
      </Link>

      <Link href="/management/communications/topics" asChild>
        <Pressable className="flex-row items-center gap-3 bg-white dark:bg-gray-900 rounded-xl p-4 active:opacity-70">
          <View className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
            <Ionicons name="layers-outline" size={18} color="#6B7280" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Email topics
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Let members subscribe and unsubscribe per topic — newsletter, promos, billing.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </Pressable>
      </Link>

      <CampaignList />
    </View>
  );
}

export default function CommunicationsScreen() {
  const canManageComms = useCan('can_manage_comms');

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Email campaigns
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Design, send and analyse email campaigns to your members.
          </Text>
        </View>
        {canManageComms === false ? (
          <Text className="text-gray-500 dark:text-gray-400">
            You don't have permission to manage communications.
          </Text>
        ) : (
          <CommunicationsHome />
        )}
      </ScrollView>
    </Screen>
  );
}
