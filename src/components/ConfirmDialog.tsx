import { View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { Sheet, SheetAction } from '@/components/Sheet';

// Shared destructive/blocking-action confirmation, extracted from the
// pattern hand-rolled identically in AccountScreen.tsx (health-data
// erasure), RemoveMemberDialog.tsx and CancelClassDialog.tsx.
//
// It now renders through <Sheet>, so on a phone it is a bottom sheet and
// on a desktop it is the centred dialog it always was. The public shape
// is unchanged — seven call sites got the phone behaviour without being
// touched.
//
// The written rule for this shape, which the copy at each call site has
// to hold up its end of:
//
//   - The TITLE is the question, and names the exact thing: "Cancel
//     Thursday 17:30 Metcon?", not "Are you sure?".
//   - The BODY is the consequence — who is affected, what they get back,
//     what they are told. Not "this cannot be undone".
//   - RED APPEARS ONCE, on the confirm. The heading and the border stay
//     monochrome, so red still means something when it shows up.
//   - The SAFE OPTION IS NAMED. `cancelLabel` defaults to "Cancel", which
//     inside a cancel-a-class dialog means both things at once — pass
//     "Keep the class" instead.
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
    <Sheet
      visible={visible}
      title={title}
      onClose={onCancel}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onCancel}>
              {cancelLabel}
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button variant="destructive" onPress={onConfirm} loading={pending}>
              {confirmLabel}
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-3 pb-1">
        <Text className="text-ink-2 dark:text-ink-2-dk text-[14.5px] leading-[21px]">
          {body}
        </Text>
        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-red-600 dark:text-red-400 text-sm">
            {error}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}
