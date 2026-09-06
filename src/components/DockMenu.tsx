import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { renderIconSlot, type IconSlot } from './icon-slot';
import { Text } from './Text';

// The one popover the navs share: a card hung from a corner of the
// screen over a scrim, holding MenuRows. The account menu and the
// phone's Manage menu are the same shape on purpose — a menu that grew
// a treatment in one and not the other would read as two products.
//
// `anchor` is where it hangs from: the top bar's corner, the rail's
// bottom, or the phone dock's right end, above the dock.
export type DockMenuAnchor = 'top-right' | 'bottom-left' | 'bottom-right';

export function DockMenu({
  visible,
  onClose,
  anchor,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  anchor: DockMenuAnchor;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();

  const panel =
    anchor === 'top-right'
      ? {
          top: insets.top + 52,
          right: 12,
          width: Math.min(320, windowWidth - 24),
          maxHeight: windowHeight - insets.top - 80,
        }
      : anchor === 'bottom-right'
        ? {
            // Clear of the dock: its bottom offset plus its height.
            bottom: Math.max(insets.bottom, 10) + 6 + 56 + 8,
            right: 12,
            width: Math.min(320, windowWidth - 24),
            maxHeight: windowHeight - insets.top - 160,
          }
        : {
            bottom: insets.bottom + 64,
            left: 12,
            width: Math.min(300, windowWidth - 24),
            maxHeight: windowHeight - 140,
          };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      />
      <View
        style={{ position: 'absolute', ...panel }}
        className="bg-surface dark:bg-surface-dk rounded-card border border-line dark:border-line-dk shadow-float p-2">
        <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function MenuDivider() {
  return <View className="h-px bg-line dark:bg-line-dk my-1.5" />;
}

export function MenuRow({
  icon,
  label,
  subtitle,
  iconColor,
  badge,
  onPress,
}: {
  icon: IconSlot;
  label: string;
  subtitle?: string;
  iconColor: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 px-3 py-2.5 rounded-ctl hover:bg-raised dark:hover:bg-raised-dk active:bg-raised dark:active:bg-raised-dk">
      {renderIconSlot(icon, 20, iconColor)}
      <View className="flex-1">
        <Text className="text-ink dark:text-ink-dk text-[15px] font-medium">{label}</Text>
        {subtitle ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge && badge > 0 ? (
        <View className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 items-center justify-center">
          <Text className="text-white text-[11px] font-bold">{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
