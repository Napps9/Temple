
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { IconTile, ListRow } from '@/components/ListRow';
import { ManageModal } from '@/components/ManageModal';
import { useThemeColors } from '@/lib/theme';

type ImportTab = 'members' | 'workouts';

type ImportOption = {
  title: string;
  description: string;
  href: Href;
  icon: ComponentProps<typeof Ionicons>['name'];
};

const OPTIONS: Record<ImportTab, ImportOption[]> = {
  members: [
    {
      title: 'Import from Stripe',
      description:
        'Already charging members on Stripe? Start here — each live subscription is adopted (no re-entering cards, no double-billing).',
      href: '/management/members/import-stripe',
      icon: 'card-outline',
    },
    {
      title: 'Import members (CSV)',
      description:
        'Drop in a CSV from Mindbody, PushPress, Glofox, Wodify or a spreadsheet — members link to their data when they sign up.',
      href: '/management/members/import',
      icon: 'people-outline',
    },
  ],
  workouts: [
    {
      title: 'Import workout history',
      description:
        'Seed past sets per member — one row per movement result. Lands in /track so PR pages and trends light up immediately.',
      href: '/management/members/import-workouts',
      icon: 'barbell-outline',
    },
  ],
};

// The Members-tab "Import data" CTA opens this. The three importers are
// grouped into Members / Workouts tabs; picking one closes the modal and
// routes to that importer's full-screen flow.
export function ImportDataModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [tab, setTab] = useState<ImportTab>('members');

  function go(href: Href) {
    onClose();
    router.push(href);
  }

  return (
    <ManageModal
      visible={visible}
      onClose={onClose}
      title="Import data"
      subtitle="Bring members and their training history across from your old tools.">
      <View className="flex-row gap-2">
        {(['members', 'workouts'] as const).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              className={`flex-1 px-3 py-2 rounded-lg border items-center ${
                active
                  ? 'bg-raised dark:bg-raised-dk border-transparent'
                  : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
              }`}>
              <Text
                className={`text-sm font-medium ${
                  active ? 'text-ink dark:text-ink-dk' : 'text-ink-2 dark:text-ink-2-dk'
                }`}>
                {t === 'members' ? 'Members' : 'Workouts'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="gap-2">
        {OPTIONS[tab].map((o) => (
          <ListRow
            key={o.title}
            wrap
            lead={<IconTile name={o.icon} />}
            title={o.title}
            subtitle={o.description}
            onPress={() => go(o.href)}
          />
        ))}
      </View>
    </ManageModal>
  );
}
