import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { renderIconSlot, type IconSlot } from './icon-slot';

import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';

// 'inverse' renders as the opposite of the current scheme — a dark
// pill on a light surface, a light pill on a dark one. Useful for
// emphasis chips (e.g. "Auto-generate from light") that need to
// stand out against ordinary tonal chrome without competing with
// the brand primary.
type Tone = 'neutral' | 'primary' | 'amber' | 'red' | 'filled' | 'inverse';

// Small inline action chips (Edit, View, Copy, Cancel, ...) that live
// inside cards and rows. The old treatment — bare uppercase text links —
// read as labels, not actions.
//
// `neutral` is the default, and that is the accent rule rather than a
// preference: a chip is by nature a repeated action — three on a card,
// five down a list — and the gym's colour belongs to the one action a
// page exists for. `primary` and `filled` are still there for the chip
// that genuinely is that action.
const TONE_STYLES: Record<Tone, { container: string; text: string }> = {
  neutral: {
    container:
      'bg-surface dark:bg-surface-dk border border-line-strong dark:border-line-strong-dk hover:bg-raised dark:hover:bg-raised-dk active:bg-raised dark:active:bg-raised-dk',
    text: 'text-ink-2 dark:text-ink-2-dk',
  },
  primary: {
    container:
      'bg-secondary/10 border border-secondary/30 hover:bg-secondary/15 active:bg-secondary/20',
    text: 'text-secondary',
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
    text: 'font-semibold',
  },
  inverse: {
    container:
      'bg-ink dark:bg-ink-dk border border-ink dark:border-ink-dk hover:opacity-90 active:opacity-80',
    text: 'text-surface dark:text-surface-dk',
  },
};

export function ChipButton({
  label,
  icon,
  iconSide = 'left',
  tone = 'neutral',
  onPress,
  disabled,
  className,
}: {
  label: string;
  icon: IconSlot;
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
  // The label on the accent fill, same token the primary Button uses.
  const filledLabel = colors.onPrimary;
  const iconColor: Record<Tone, string> = {
    neutral: colors.ink2,
    primary: colors.secondary,
    amber: '#F59E0B',
    red: '#EF4444',
    filled: filledLabel,
    inverse: colors.surface,
  };
  const iconEl = renderIconSlot(icon, 13, iconColor[tone]);
  const containerClass = `flex-row items-center gap-1.5 px-3 py-1.5 rounded-full ${
    s.container
  } ${disabled ? 'opacity-50' : ''} ${className ?? ''}`;
  const content = (
    <>
      {iconSide === 'left' ? iconEl : null}
      <Text
        className={`text-xs font-semibold ${s.text}`}
        style={tone === 'filled' ? { color: filledLabel } : undefined}>
        {label}
      </Text>
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
