import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

// 'inverse' renders as the opposite of the current scheme — a dark
// pill on a light surface, a light pill on a dark one. Useful for
// emphasis chips (e.g. "Auto-generate from light") that need to
// stand out against ordinary tonal chrome without competing with
// the brand primary.
type Tone = 'primary' | 'neutral' | 'amber' | 'red' | 'filled' | 'inverse';

// Small inline action chips (Edit, View, Copy, Cancel, ...) that live
// inside cards and rows. The old treatment — bare uppercase text links —
// read as labels, not actions. These share ActionButton's tonal
// language: a tinted pill, an icon, and a pressed state.
const TONE_STYLES: Record<Tone, { container: string; text: string }> = {
  primary: {
    container:
      'bg-secondary/10 border border-secondary/30 hover:bg-secondary/15 active:bg-secondary/20',
    text: 'text-secondary',
  },
  neutral: {
    container:
      'bg-white dark:bg-gray-800 border border-line-strong dark:border-line-strong-dk hover:bg-gray-50 dark:hover:bg-gray-700/60 active:bg-gray-100 dark:active:bg-gray-700',
    text: 'text-ink-2 dark:text-ink-2-dk',
  },
  amber: {
    container:
      'bg-amber-500/10 border border-amber-500/40 hover:bg-amber-500/15 active:bg-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  red: {
    container:
      'bg-red-500/10 border border-red-500/40 hover:bg-red-500/15 active:bg-red-500/20',
    text: 'text-red-600 dark:text-red-400',
  },
  filled: {
    container: 'bg-primary border border-primary hover:opacity-90 active:bg-primary-dark',
    text: 'text-white',
  },
  inverse: {
    container:
      'bg-gray-900 dark:bg-gray-50 border border-gray-900 dark:border-gray-50 hover:opacity-90 active:bg-gray-700 dark:active:bg-gray-200',
    text: 'text-white dark:text-gray-900',
  },
};

export function ChipButton({
  label,
  icon,
  iconSide = 'left',
  tone = 'primary',
  onPress,
  disabled,
  className,
}: {
  label: string;
  icon: IconName;
  iconSide?: 'left' | 'right';
  tone?: Tone;
  // Omit onPress when the chip is a visual affordance inside a larger
  // Pressable (e.g. the Edit chip on a programming card) — it renders
  // as a plain View so the parent keeps the whole tap target.
  onPress?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const colors = useThemeColors();
  const s = TONE_STYLES[tone];
  const iconColor =
    tone === 'primary'
      ? colors.secondary
      : tone === 'amber'
        ? '#F59E0B'
        : tone === 'red'
          ? '#EF4444'
          : tone === 'filled'
            ? '#FFFFFF'
            : tone === 'inverse'
              ? colors.iconInverse
              : colors.iconPrimary;
  const iconEl = <Ionicons name={icon} size={13} color={iconColor} />;
  const containerClass = `flex-row items-center gap-1.5 px-3 py-1.5 rounded-full ${
    s.container
  } ${disabled ? 'opacity-50' : ''} ${className ?? ''}`;
  const content = (
    <>
      {iconSide === 'left' ? iconEl : null}
      <Text className={`text-xs font-semibold ${s.text}`}>{label}</Text>
      {iconSide === 'right' ? iconEl : null}
    </>
  );

  if (!onPress) {
    return <View className={containerClass}>{content}</View>;
  }
  return (
    <Pressable
      onPress={() => {
        if (tone === 'red') haptic.warning();
        else haptic.tap();
        onPress();
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      className={containerClass}>
      {content}
    </Pressable>
  );
}
