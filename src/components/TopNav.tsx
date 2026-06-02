import {
  Link,
  router,
  useGlobalSearchParams,
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
  const params = useGlobalSearchParams<{ view?: string }>();
  const { data: membership } = useGymMembership();
  const [navOpen, setNavOpen] = useState(false);

  const gymName = membership?.gymName ?? 'Temple';
  const initial = (gymName.charAt(0) || 'T').toUpperCase();

  const isOnClasses = pathname === '/classes' || pathname === '/book';
  const currentView = params.view ?? 'day';
  const isManagementSubPage = pathname.startsWith('/management/');

  return (
    <View
      style={{ paddingTop: insets.top + 10 }}
      className="bg-gray-50 px-4 md:px-6 pb-3 flex-row items-center">
      <View className="flex-1 flex-row items-center">
        <Pressable
          onPress={() => setNavOpen(true)}
          hitSlop={6}
          className="active:opacity-70">
          <LogoMark initial={initial} />
        </Pressable>
      </View>

      <View className="items-center">
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

      <View className="flex-1 items-end">
        {isManagementSubPage ? (
          <Link href="/management" asChild>
            <Pressable hitSlop={8} className="active:opacity-70">
              <Text className="text-primary font-medium text-base">← Manage</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>

      <NavModal
        visible={navOpen}
        onClose={() => setNavOpen(false)}
        sections={sections}
        variant={variant}
      />
    </View>
  );
}
