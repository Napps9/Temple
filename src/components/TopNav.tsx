import {
  Link,
  router,
  useGlobalSearchParams,
  usePathname,
} from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GymLogo } from './GymLogo';
import { NavModal, type NavSection } from './NavModal';
import { useGymBrand } from '@/lib/useGymBrand';

export type { NavSection };

const CLASSES_VIEWS = ['day', 'week', 'month'] as const;

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
  const brand = useGymBrand();
  const [navOpen, setNavOpen] = useState(false);

  const gymName = brand.gymName;

  const isOnClasses = pathname === '/classes' || pathname === '/book';
  const currentView = params.view ?? 'day';
  const isManagementSubPage = pathname.startsWith('/management/');

  return (
    <View
      style={{ paddingTop: insets.top + 10 }}
      className="bg-gray-50 dark:bg-gray-950 px-4 md:px-6 pb-3 flex-row items-center">
      <View className="flex-1 flex-row items-center">
        <Pressable
          onPress={() => setNavOpen(true)}
          hitSlop={6}
          className="flex-row items-center gap-3 active:opacity-70">
          <GymLogo
            size={36}
            logoUrl={brand.logoUrl}
            name={gymName}
            primaryColor={brand.primaryColor}
          />
          <Text
            className="text-gray-900 dark:text-gray-50 font-semibold text-base hidden md:flex"
            numberOfLines={1}>
            {gymName}
          </Text>
        </Pressable>
      </View>

      <View className="items-center">
        {isOnClasses ? (
          <View className="flex-row bg-gray-100 dark:bg-gray-800 rounded-full p-1">
            {CLASSES_VIEWS.map((v) => (
              <Pressable
                key={v}
                onPress={() => router.setParams({ view: v })}
                className={`px-5 md:px-6 py-1.5 rounded-full ${
                  currentView === v ? 'bg-white dark:bg-gray-700' : ''
                }`}>
                <Text
                  className={`capitalize text-sm font-medium ${
                    currentView === v
                      ? 'text-gray-900 dark:text-gray-50'
                      : 'text-gray-500 dark:text-gray-400'
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
              <Text
                style={{ color: brand.primaryColor }}
                className="font-medium text-base">
                ← Manage
              </Text>
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
