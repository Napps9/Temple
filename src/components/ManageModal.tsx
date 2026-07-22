import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { useThemeColors } from '@/lib/theme';

// Shared shell for the Members-tab action modals (Invite, Import, Tag
// rules). A dimmed backdrop, a titled header with a close affordance and
// a height-capped scroll body — the same shape the QR / date-range
// modals already use, factored out so the three launchers stay thin.
export function ManageModal({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-4 py-8">
        <Pressable
          onPress={() => {}}
          className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <View className="flex-row items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold text-lg">
                {title}
              </Text>
              {subtitle ? (
                <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="w-8 h-8 rounded-full items-center justify-center bg-gray-100 dark:bg-gray-800 active:opacity-70">
              <Ionicons name="close" size={18} color={colors.iconSecondary} />
            </Pressable>
          </View>
          <ScrollView
            className="max-h-[32rem]"
            contentContainerClassName="p-5 gap-4"
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
