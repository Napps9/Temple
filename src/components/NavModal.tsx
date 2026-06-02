import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Modal, Pressable, Text, View } from 'react-native';

import { isStaffRole, useGymMembership, useRole } from '@/lib/auth';

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
  const gymName = membership?.gymName ?? 'Temple';
  const initial = (gymName.charAt(0) || 'T').toUpperCase();
  const showCrossLink = variant === 'staff' || isStaffRole(role);
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
          className="w-full max-w-md bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <View className="p-5 border-b border-gray-100">
            <View className="flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-lg bg-primary items-center justify-center">
                <Text className="text-white font-bold text-base">{initial}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-semibold text-base">{gymName}</Text>
                {role ? (
                  <Text className="text-gray-500 text-xs capitalize">{role}</Text>
                ) : null}
              </View>
            </View>
          </View>

          <View className="p-4">
            <View className="flex-row gap-2">
              {sections.map((s) => (
                <Pressable
                  key={s.name}
                  onPress={() => go(s.href)}
                  className="flex-1 aspect-square bg-gray-50 rounded-2xl items-center justify-center gap-2 active:bg-gray-100">
                  <Ionicons name={s.icon} size={26} color="#1F2937" />
                  <Text className="text-gray-900 text-xs font-medium text-center px-1">
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
