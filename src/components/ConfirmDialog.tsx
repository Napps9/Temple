import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/Button';

// Shared destructive/blocking-action confirmation, extracted from the
// pattern hand-rolled identically in AccountScreen.tsx (health-data
// erasure), RemoveMemberDialog.tsx and CancelClassDialog.tsx.
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          role="dialog"
          aria-modal
          accessibilityLabel={title}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">{title}</Text>
          <Text className="text-gray-700 dark:text-gray-200">{body}</Text>
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}
          <View className="flex-row gap-2 justify-end">
            <Button variant="secondary" onPress={onCancel}>
              {cancelLabel}
            </Button>
            <Button variant="destructive" onPress={onConfirm} loading={pending}>
              {confirmLabel}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
