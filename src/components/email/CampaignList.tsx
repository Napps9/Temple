import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

import { EmptyState } from '@/components/EmptyState';
import { useThemeColors } from '@/lib/theme';
import {
  campaignStatusMeta,
  formatDateTime,
  useCampaigns,
  type CampaignListRow,
  type StatusTone,
} from '@/lib/comms';

const TONE_BADGE: Record<StatusTone, { bg: string; text: string }> = {
  gray: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
  green: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400' },
  red: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
};

export function StatusBadge({ status }: { status: CampaignListRow['status'] }) {
  const meta = campaignStatusMeta(status);
  const tone = TONE_BADGE[meta.tone];
  return (
    <View className={`px-2 py-0.5 rounded-full ${tone.bg}`}>
      <Text className={`text-[11px] font-semibold ${tone.text}`}>{meta.label}</Text>
    </View>
  );
}

function CampaignRow({ campaign }: { campaign: CampaignListRow }) {
  const colors = useThemeColors();
  const subtitle =
    campaign.status === 'sent'
      ? `${campaign.recipient_count} sent · ${formatDateTime(campaign.sent_at)}`
      : campaign.subject?.trim()
        ? campaign.subject
        : 'No subject yet';
  return (
    <Link href={`/management/communications/${campaign.id}`} asChild>
      <Pressable className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card active:opacity-70">
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text
                className="text-gray-900 dark:text-gray-50 font-semibold flex-shrink"
                numberOfLines={1}>
                {campaign.title || 'Untitled campaign'}
              </Text>
              <StatusBadge status={campaign.status} />
            </View>
            <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.iconTertiary} />
        </View>
      </Pressable>
    </Link>
  );
}

export function CampaignList() {
  const campaigns = useCampaigns();

  return (
    <View className="gap-3">
      <Link href="/management/communications/new" asChild>
        <Pressable className="flex-row items-center justify-center gap-2 bg-primary rounded-xl py-3 active:bg-primary-dark">
          <Ionicons name="add" size={18} color="#FFFFFF" />
          <Text className="text-white font-semibold">New campaign</Text>
        </Pressable>
      </Link>

      {campaigns.isLoading ? (
        <Text className="text-gray-500 dark:text-gray-400">Loading campaigns…</Text>
      ) : (campaigns.data ?? []).length === 0 ? (
        <EmptyState
          icon="mail-outline"
          title="No campaigns yet"
          description="Create your first email campaign to reach your members."
        />
      ) : (
        <View className="gap-2">
          {(campaigns.data ?? []).map((c) => (
            <CampaignRow key={c.id} campaign={c} />
          ))}
        </View>
      )}
    </View>
  );
}
