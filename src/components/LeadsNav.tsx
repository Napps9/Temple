import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { View } from 'react-native';
import { PillNav } from './PillNav';
import { Text } from './Text';

import { PageScroll } from '@/components/PageScroll';
import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { useThemeColors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type LeadsTab = 'leads' | 'conversations' | 'settings';

const TAB_LABELS: Record<LeadsTab, string> = {
  leads: 'Leads',
  conversations: 'Conversations',
  settings: 'Settings',
};

const TAB_ICONS: Record<LeadsTab, IconName> = {
  leads: 'funnel-outline',
  conversations: 'chatbubbles-outline',
  settings: 'settings-outline',
};

function goToTab(tab: LeadsTab) {
  if (tab === 'leads') router.push('/management/leads' as never);
  else if (tab === 'conversations') router.push('/management/leads/conversations' as never);
  else router.push('/management/leads/settings' as never);
}

// Same pill idiom as the Manage screen's section nav (ManageNav), so the
// Leads section reads as part of the same system rather than a one-off
// screen with its own nav language. One layout, at every width: this used
// to become a full-height sidebar at 1024, which is where the staff rail
// arrives, and two bordered nav columns is not a layout.
function LeadsPills({ tabs, active }: { tabs: LeadsTab[]; active: LeadsTab }) {
  return (
    <PillNav
      items={tabs.map((t) => ({ key: t, label: TAB_LABELS[t], icon: TAB_ICONS[t] }))}
      active={active}
      onSelect={goToTab}
    />
  );
}

// Shell for the Leads section's screens (pipeline, conversations,
// settings): back, the section's pill row, then the page.
export function LeadsShell({
  active,
  tabs,
  children,
}: {
  active: LeadsTab;
  tabs: LeadsTab[];
  children: ReactNode;
}) {
  return (
    <Screen edges={['bottom', 'left', 'right']} className="px-0">
      <PageScroll
        className="flex-1"
        contentContainerClassName="gap-5 py-6 px-4 lg:px-8 lg:max-w-5xl lg:w-full">
        <View className="gap-3">
          <BackLink fallbackHref="/management" coveredByNav />
          <LeadsPills tabs={tabs} active={active} />
        </View>
        {children}
      </PageScroll>
    </Screen>
  );
}
