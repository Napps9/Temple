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
//   - The SAFE OPTION IS NAMED. `cancelLabel` is required, with no
//     fallback, because the fallback was "Cancel" — which inside a
//     cancel-a-class dialog means both things at once, and which three of
//     five call sites were quietly taking.
type ConfirmShape = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
};

// The same question as a STEP of a sheet that is already open, for the
// callers that used to render this whole component inside their own
// Sheet — a modal on top of a modal, which is the one rule the shell's
// header states and the only one that had actually been broken.
//
// Both hosts come through here so the shape above is defined once: the
// standalone component below is this, in a Sheet of its own.
export function confirmStep(c: ConfirmShape) {
  return {
    title: c.title,
    body: (
      <View className="gap-3">
        <Text className="text-ink-2 dark:text-ink-2-dk text-[14.5px] leading-[21px]">
          {c.body}
        </Text>
        {c.error ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-red-600 dark:text-red-400 text-sm">
            {c.error}
          </Text>
        ) : null}
      </View>
    ),
    actions: (
      <>
        <SheetAction>
          <Button variant="secondary" onPress={c.onCancel}>
            {c.cancelLabel}
          </Button>
        </SheetAction>
        <SheetAction grow>
          <Button variant="destructive" onPress={c.onConfirm} loading={c.pending}>
            {c.confirmLabel}
          </Button>
        </SheetAction>
      </>
    ),
  };
}

export function ConfirmDialog({
  visible,
  ...rest
}: ConfirmShape & { visible: boolean }) {
  const step = confirmStep(rest);
  return (
    <Sheet
      visible={visible}
      title={step.title}
      onClose={rest.onCancel}
      busy={rest.pending}
      actions={step.actions}>
      {step.body}
    </Sheet>
  );
}
