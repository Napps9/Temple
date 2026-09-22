import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';

import { useThemeColors } from '@/lib/theme';

// Undo/redo controls for the builder headers. Icon-only to sit quietly
// next to Save; disabled (dimmed) when there's nothing to step to.
export function HistoryButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`w-8 h-8 rounded-ctl items-center justify-center active:opacity-70 ${
        disabled ? 'opacity-30' : 'hover:bg-raised dark:hover:bg-raised-dk'
      }`}>
      <Ionicons name={icon} size={18} color={colors.ink2} />
    </Pressable>
  );
}
