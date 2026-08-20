import { View } from 'react-native';
import { ListRow } from '@/components/ListRow';
import { SectionLabel } from '@/components/SectionLabel';
import { Text } from '@/components/Text';

import { EmptyState } from '@/components/EmptyState';
import {
  campaignStatusMeta,
  formatDateTime,
  useCampaigns,
  type CampaignListRow,
  type StatusTone,
} from '@/lib/comms';

const TONE_BADGE: Record<StatusTone, { bg: string; text: string }> = {
  gray: { bg: 'bg-raised dark:bg-raised-dk', text: 'text-ink-2 dark:text-ink-2-dk' },
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
  const subtitle =
    campaign.status === 'sent'
      ? `${campaign.recipient_count} sent · ${formatDateTime(campaign.sent_at)}`
      : campaign.subject?.trim()
        ? campaign.subject
        : 'No subject yet';
  return (
    <ListRow
      href={`/management/communications/${campaign.id}`}
      title={campaign.title || 'Untitled campaign'}
      subtitle={subtitle}
      chip={<StatusBadge status={campaign.status} />}
    />
  );
}

export function CampaignList({ onNew }: { onNew?: () => void }) {
  const campaigns = useCampaigns();

  return (
    <View className="gap-2">
      <SectionLabel>Campaigns</SectionLabel>

      {campaigns.isLoading ? (
        <EmptyState kind="loading" rows={3} />
      ) : (campaigns.data ?? []).length === 0 ? (
        <EmptyState
          icon="mail-outline"
          title="No campaigns yet"
          description="Write one and it goes to whichever of your members you choose."
          actionLabel={onNew ? 'New campaign' : undefined}
          onAction={onNew}
        />
      ) : (
        (campaigns.data ?? []).map((c) => <CampaignRow key={c.id} campaign={c} />)
      )}
    </View>
  );
}
