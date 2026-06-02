import { router } from 'expo-router';
import { Modal, Pressable, Text, View } from 'react-native';

import { isStaffRole, useGymMembership, useRole } from '@/lib/auth';

export type NavSection = { name: string; href: string; label: string };

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

          <View className="p-3">
            <Text className="text-gray-400 text-xs font-medium uppercase tracking-widest px-3 py-2">
              Navigate
            </Text>
            {sections.map((s) => (
              <Pressable
                key={s.name}
                onPress={() => go(s.href)}
                className="px-3 py-2.5 rounded-lg active:bg-gray-50">
                <Text className="text-gray-900 text-base">{s.label}</Text>
              </Pressable>
            ))}
          </View>

          {showCrossLink ? (
            <View className="p-3 border-t border-gray-100">
              <Text className="text-gray-400 text-xs font-medium uppercase tracking-widest px-3 py-2">
                View
              </Text>
              <Pressable
                onPress={() => go(crossHref)}
                className="px-3 py-2.5 rounded-lg active:bg-gray-50 flex-row items-center justify-between">
                <Text className="text-gray-900 text-base">{crossLabel}</Text>
                <Text className="text-gray-400">→</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
