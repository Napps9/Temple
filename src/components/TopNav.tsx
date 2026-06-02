import {
  router,
  useLocalSearchParams,
  usePathname,
} from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NavModal, type NavSection } from './NavModal';
import { useGymMembership } from '@/lib/auth';

export type { NavSection };

const CLASSES_VIEWS = ['day', 'week', 'month'] as const;

function LogoMark({ initial }: { initial: string }) {
  return (
    <View className="w-9 h-9 rounded-lg bg-primary items-center justify-center">
      <Text className="text-white font-bold text-base">{initial}</Text>
    </View>
  );
}

export function TopNav({
  sections,
  variant,
}: {
  sections: NavSection[];
  variant: 'staff' | 'member';
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ view?: string }>();
  const { data: membership } = useGymMembership();
  const [navOpen, setNavOpen] = useState(false);

  const gymName = membership?.gymName ?? 'Temple';
  const initial = (gymName.charAt(0) || 'T').toUpperCase();

  const isOnClasses = pathname === '/classes';
  const currentView = params.view ?? 'day';

  return (
    <View
      style={{ paddingTop: insets.top + 10 }}
      className="bg-gray-50 px-4 md:px-6 pb-3 flex-col md:flex-row md:items-center gap-3 md:gap-0">
      <Pressable
        onPress={() => setNavOpen(true)}
        hitSlop={6}
        className="flex-row items-center gap-3 md:flex-1 active:opacity-70">
        <LogoMark initial={initial} />
        <Text
          className="text-gray-900 font-semibold text-base flex-1 md:flex-none"
          numberOfLines={1}>
          {gymName}
        </Text>
        <Text className="text-gray-400 text-sm">▾</Text>
      </Pressable>

      <View className="self-center md:self-auto">
        {isOnClasses ? (
          <View className="flex-row bg-gray-100 rounded-full p-1">
            {CLASSES_VIEWS.map((v) => (
              <Pressable
                key={v}
                onPress={() => router.setParams({ view: v })}
                className={`px-5 md:px-6 py-1.5 rounded-full ${
                  currentView === v ? 'bg-white' : ''
                }`}>
                <Text
                  className={`capitalize text-sm font-medium ${
                    currentView === v ? 'text-gray-900' : 'text-gray-500'
                  }`}>
                  {v}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View className="hidden md:flex md:flex-1" />

      <NavModal
        visible={navOpen}
        onClose={() => setNavOpen(false)}
        sections={sections}
        variant={variant}
      />
    </View>
  );
}
