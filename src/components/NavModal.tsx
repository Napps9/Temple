import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Modal, Pressable, Text, View } from 'react-native';

import { Avatar } from './Avatar';
import { GymLogo } from './GymLogo';
import { useMyProfile, useSession } from '@/lib/auth';
import { useGymBrand } from '@/lib/useGymBrand';
import { useThemeColors, useThemePreference } from '@/lib/theme';
import { useCan } from '@/lib/useCan';

type IoniconName = keyof typeof Ionicons.glyphMap;

export type NavSection = {
  name: string;
  href: string;
  label: string;
  icon: IoniconName;
};

export function NavModal({
  visible,
  onClose,
  sections,
  variant,
}: {
  visible: boolean;
  onClose: () => void;
  sections: NavSection[];
  variant: 'staff' | 'member';
}) {
  const brand = useGymBrand();
  const { data: profile } = useMyProfile();
  const session = useSession();
  const canAccessStaff = useCan('can_access_staff_area') ?? false;
  const { scheme, set } = useThemePreference();
  const colors = useThemeColors();
  const gymName = brand.gymName;
  const displayName = profile?.full_name?.trim() || session?.user.email || '';
  const showCrossLink = variant === 'staff' || canAccessStaff;
  const crossHref = variant === 'staff' ? '/book' : '/classes';
  const crossLabel = variant === 'staff' ? 'Member view' : 'Staff view';

  // Account routes per layout — staff to /management/account so it
  // renders inside the staff tabs; members to /account.
  const accountHref = variant === 'staff' ? '/management/account' : '/account';

  function go(href: string) {
    router.replace(href as never);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/40 items-center justify-start pt-20 px-6">
        <Pressable
          onPress={() => {}}
          className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <View className="p-5 border-b border-gray-100 dark:border-gray-800">
            <View className="flex-row items-center gap-3">
              <GymLogo
                size={40}
                logoUrl={brand.logoUrl}
                name={gymName}
                primaryColor={brand.primaryColor}
              />
              <Text
                className="flex-1 text-gray-900 dark:text-gray-50 font-semibold text-base"
                numberOfLines={1}>
                {gymName}
              </Text>
            </View>
          </View>

          <View className="p-4 gap-3">
            <View className="flex-row gap-2">
              {sections.map((s) => (
                <Pressable
                  key={s.name}
                  onPress={() => go(s.href)}
                  className="flex-1 aspect-square bg-gray-50 dark:bg-gray-800 rounded-2xl items-center justify-center gap-2 active:bg-gray-100 dark:active:bg-gray-700">
                  <Ionicons name={s.icon} size={26} color={colors.iconPrimary} />
                  <Text className="text-gray-900 dark:text-gray-50 text-xs font-medium text-center px-1">
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View className="flex-row items-center gap-3">
              <Pressable
                onPress={() => go(accountHref)}
                className="flex-1 flex-row items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-2xl p-3 active:bg-gray-100 dark:active:bg-gray-700">
                <Avatar
                  name={displayName}
                  avatarUrl={profile?.avatar_url}
                  size={36}
                />
                <Text
                  className="flex-1 text-gray-900 dark:text-gray-50 font-medium"
                  numberOfLines={1}>
                  {displayName || 'Account'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => set(scheme === 'dark' ? 'light' : 'dark')}
                hitSlop={6}
                className="w-12 h-12 rounded-2xl bg-gray-50 dark:bg-gray-800 items-center justify-center active:bg-gray-100 dark:active:bg-gray-700">
                <Ionicons
                  name={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
                  size={22}
                  color={colors.iconPrimary}
                />
              </Pressable>
            </View>

            {showCrossLink ? (
              <Pressable
                onPress={() => go(crossHref)}
                style={{ backgroundColor: brand.primaryColor }}
                className="rounded-full px-4 py-3 flex-row items-center justify-center gap-2 active:opacity-80">
                <Text className="text-white font-semibold text-sm">{crossLabel}</Text>
                <Text className="text-white font-semibold text-sm">→</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
