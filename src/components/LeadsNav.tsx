import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';

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
  const colors = useThemeColors();
  const pills = tabs.map((t) => {
    const selected = t === active;
    return (
      <Pressable
        key={t}
        onPress={() => goToTab(t)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        // Selected is a soft tint, not the gym's colour. A nav is on
        // screen the whole time and is never the one action a page exists
        // for, so filling it with the brand made every gym's chrome a
        // different colour before any of their content had loaded.
        className={`flex-row items-center gap-2.5 rounded-ctl px-3 py-2.5 active:opacity-80 ${
          selected
            ? 'bg-raised dark:bg-raised-dk'
            : 'bg-surface dark:bg-surface-dk border border-line dark:border-line-dk hover:border-line-strong dark:hover:border-line-strong-dk'
        }`}>
        <Ionicons
          name={TAB_ICONS[t]}
          size={17}
          color={selected ? colors.ink : colors.ink3}
        />
        <Text
          className={`text-sm ${
            selected
              ? 'text-ink dark:text-ink-dk font-semibold'
              : 'text-ink-2 dark:text-ink-2-dk font-medium'
          }`}>
          {TAB_LABELS[t]}
        </Text>
      </Pressable>
    );
  });
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
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 py-6 px-4 lg:px-8 lg:max-w-5xl lg:w-full">
        <View className="gap-3">
          <BackLink fallbackHref="/management" />
          <LeadsPills tabs={tabs} active={active} />
        </View>
        {children}
      </ScrollView>
    </Screen>
  );
}
