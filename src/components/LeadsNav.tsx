import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Screen } from '@/components/Screen';
import { useThemeColors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type LeadsTab = 'leads' | 'agent' | 'conversations' | 'settings';

const TAB_LABELS: Record<LeadsTab, string> = {
  leads: 'Leads',
  agent: 'AI Agent',
  conversations: 'Conversations',
  settings: 'Settings',
};

const TAB_ICONS: Record<LeadsTab, IconName> = {
  leads: 'funnel-outline',
  agent: 'sparkles-outline',
  conversations: 'chatbubbles-outline',
  settings: 'settings-outline',
};

function goToTab(tab: LeadsTab) {
  if (tab === 'leads') router.push('/management/leads' as never);
  else if (tab === 'agent') router.push('/management/leads/agent' as never);
  else if (tab === 'conversations') router.push('/management/leads/conversations' as never);
  else router.push('/management/leads/settings' as never);
}

// Same pill idiom as the Manage screen's own sidebar (ManageNav) — a
// vertical list on desktop, a horizontal scroller on mobile — so the
// Leads section reads as part of the same system rather than a
// one-off screen with its own nav language.
function LeadsPills({
  tabs,
  active,
  vertical,
}: {
  tabs: LeadsTab[];
  active: LeadsTab;
  vertical: boolean;
}) {
  const colors = useThemeColors();
  const pills = tabs.map((t) => {
    const selected = t === active;
    return (
      <Pressable
        key={t}
        onPress={() => goToTab(t)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        className={`flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:opacity-80 ${
          vertical ? 'w-full' : ''
        } ${
          selected
            ? 'bg-primary shadow-card'
            : vertical
              ? 'hover:bg-slate-200/60 dark:hover:bg-gray-800'
              : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
        }`}>
        <Ionicons
          name={TAB_ICONS[t]}
          size={17}
          color={selected ? '#FFFFFF' : colors.iconSecondary}
        />
        <Text
          className={`text-sm font-medium ${
            selected ? 'text-white' : 'text-gray-700 dark:text-gray-200'
          }`}>
          {TAB_LABELS[t]}
        </Text>
      </Pressable>
    );
  });
  if (vertical) return <View className="gap-1">{pills}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerClassName="flex-row gap-2 px-4">
      {pills}
    </ScrollView>
  );
}

// Shell for the Leads section's screens (pipeline, agent, conversations,
// settings) — a persistent left sidebar on desktop matching the Manage
// screen's own sidebar, a pill row above the content on mobile.
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
      <View className="flex-1 lg:flex-row">
        <View className="hidden lg:flex lg:w-60 lg:shrink-0 border-r border-gray-200 dark:border-gray-800 px-4 py-6 gap-4">
          <BackLink label="Manage" fallbackHref="/management" />
          <LeadsPills tabs={tabs} active={active} vertical />
        </View>
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-5 py-6 px-4 lg:px-8 lg:max-w-5xl lg:w-full">
          <View className="lg:hidden gap-3">
            <BackLink label="Manage" fallbackHref="/management" />
            <LeadsPills tabs={tabs} active={active} vertical={false} />
          </View>
          {children}
        </ScrollView>
      </View>
    </Screen>
  );
}
