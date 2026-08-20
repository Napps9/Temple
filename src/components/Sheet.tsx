import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';

import { modalShape } from '@/lib/modal-shape';
import { useThemeColors } from '@/lib/theme';

// One modal for the whole product: a sheet on a phone, a dialog on a
// desktop. Same title, same body, same actions, same order — only the
// container changes with the viewport.
//
// The thing this fixes is not cosmetic. Every modal in the app was a
// centred box with a dimmed backdrop at every screen size, which on a
// 390px phone is a floating card with the keyboard underneath it and
// nothing anchoring it to the bottom of the screen. Twenty-six components
// inherited that shape.
//
// Anatomy, in order, and none of it optional:
//   - a grabber, on the sheet only, because that is the affordance that
//     says "swipe me"
//   - the title on the left and a close on the right; the title names the
//     thing, not the verb
//   - a body that scrolls while the head and the foot do not
//   - a foot whose primary sits right on desktop and which is a
//     full-width pair on a phone, where both thumbs can reach it
//
// The breakpoint itself lives in lib/modal-shape.ts.
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  actions,
  dialogWidth = 460,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  // The foot. Order them cancel-first: on desktop that puts the primary
  // on the right, on a phone it puts it under the dominant thumb.
  actions?: ReactNode;
  dialogWidth?: number;
}) {
  const { width, height } = useWindowDimensions();
  const colors = useThemeColors();
  const asDialog = modalShape(width) === 'dialog';

  const head = (
    <View className="flex-row items-start gap-3 px-4 pb-3 pt-2">
      <View className="flex-1 gap-0.5">
        <Text
          accessibilityRole="header"
          className="text-ink dark:text-ink-dk text-[19px] font-bold tracking-[-0.5px]">
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="w-[30px] h-[30px] rounded-full items-center justify-center border border-line-strong dark:border-line-strong-dk active:opacity-70">
        <Ionicons name="close" size={14} color={colors.ink2} />
      </Pressable>
    </View>
  );

  const foot = actions ? (
    <View
      className={`flex-row gap-2 px-4 pt-3 pb-4 border-t border-line dark:border-line-dk ${
        asDialog ? 'justify-end' : ''
      }`}>
      {actions}
    </View>
  ) : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={asDialog ? 'fade' : 'slide'}
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          className={`flex-1 bg-black/45 ${
            asDialog ? 'items-center justify-center px-6' : 'justify-end'
          }`}>
          {/* Swallows the press so a tap inside never dismisses. */}
          <Pressable
            onPress={() => {}}
            accessibilityViewIsModal
            role="dialog"
            aria-modal
            accessibilityLabel={title}
            style={
              asDialog
                ? { width: Math.min(dialogWidth, width - 48), maxHeight: height * 0.86 }
                : { width: '100%', maxHeight: height * 0.88 }
            }
            className={`bg-surface dark:bg-surface-dk border border-line dark:border-line-dk shadow-float ${
              asDialog ? 'rounded-[18px]' : 'rounded-t-[22px] border-b-0'
            }`}>
            {asDialog ? null : (
              <View className="items-center pt-2 pb-0.5">
                <View className="w-9 h-1 rounded-full bg-sunken dark:bg-sunken-dk" />
              </View>
            )}
            {head}
            <ScrollView
              className="px-4"
              contentContainerClassName="pb-1"
              keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {foot}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// A foot button that fills its half of a phone sheet and sizes to its
// label on a desktop dialog, so callers do not have to branch.
export function SheetAction({
  children,
  grow,
}: {
  children: ReactNode;
  grow?: boolean;
}) {
  const { width } = useWindowDimensions();
  const asDialog = modalShape(width) === 'dialog';
  return (
    <View className={asDialog ? '' : grow ? 'flex-[1.4]' : 'flex-1'}>
      {children}
    </View>
  );
}
