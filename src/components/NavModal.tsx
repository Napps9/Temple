import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Modal, Pressable, Text, View } from 'react-native';

import { useGymMembership, useRole } from '@/lib/auth';
import { can } from '@/lib/can';
import { useThemeColors, useThemePreference } from '@/lib/theme';

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
  const { data: membership } = useGymMembership();
  const role = useRole();
  const { scheme, set } = useThemePreference();
  const colors = useThemeColors();
  const gymName = membership?.gymName ?? 'Temple';
  const initial = (gymName.charAt(0) || 'T').toUpperCase();
  const showCrossLink = variant === 'staff' || can(role, 'can_access_staff_area');
  const crossHref = variant === 'staff' ? '/book' : '/classes';
  const crossLabel = variant === 'staff' ? 'Member view' : 'Staff view';

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
              <View className="w-10 h-10 rounded-lg bg-primary items-center justify-center">
                <Text className="text-white font-bold text-base">{initial}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
                  {gymName}
                </Text>
                {role ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-xs capitalize">
                    {role}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => set(scheme === 'dark' ? 'light' : 'dark')}
                hitSlop={6}
                className="w-9 h-9 rounded-lg items-center justify-center active:bg-gray-100 dark:active:bg-gray-800">
                <Ionicons
                  name={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
                  size={20}
                  color={colors.iconPrimary}
                />
              </Pressable>
            </View>
          </View>

          <View className="p-4">
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

            {showCrossLink ? (
              <View className="pt-3">
                <Pressable
                  onPress={() => go(crossHref)}
                  className="bg-primary rounded-full px-4 py-3 flex-row items-center justify-center gap-2 active:bg-primary-dark">
                  <Text className="text-white font-semibold text-sm">{crossLabel}</Text>
                  <Text className="text-white font-semibold text-sm">→</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
