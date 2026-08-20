import { Ionicons } from '@expo/vector-icons';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View as RNView, type View } from 'react-native';
import { Text } from './Text';

import { contrastRatio } from '@/lib/brand-derivation';
import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  children: ReactNode;
  onPress?: () => void;
  loading?: boolean;
  success?: boolean;
  disabled?: boolean;
  variant?: Variant;
  // Leading icon. Pairs with the label so a primary action reads as an
  // action, not just text — the success checkmark takes precedence.
  icon?: IconName;
};

// Tonal primary on secondary so the button reads as an action — the
// previous near-invisible white-on-white version disappeared inside
// modal footers and on light-mode pages.
const containerStyles: Record<Variant, string> = {
  primary: 'bg-primary hover:opacity-90 active:bg-primary-dark shadow-card',
  secondary:
    'bg-secondary/10 border border-secondary/30 hover:bg-secondary/15 active:bg-secondary/20',
  ghost: 'bg-transparent hover:opacity-70',
  destructive:
    'bg-white dark:bg-gray-900 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 active:bg-red-50 dark:active:bg-red-900/20 shadow-card',
};

// Primary label colour comes from the contrast check below, not a class
// — the fill is the gym's own brand colour, so white isn't guaranteed
// readable on it.
const textStyles: Record<Variant, string> = {
  primary: 'font-semibold',
  secondary: 'text-secondary font-semibold',
  ghost: 'text-link',
  destructive: 'text-red-600 dark:text-red-400 font-semibold',
};

const successIconColor: Record<Variant, string> = {
  primary: '#FFFFFF',
  secondary: '#16A34A',
  ghost: '#16A34A',
  destructive: '#DC2626',
};

export const Button = forwardRef<View, Props>(function Button(
  { children, onPress, loading, success, disabled, variant = 'primary', icon },
  ref,
) {
  const colors = useThemeColors();
  const isDisabled = disabled || loading;
  // The primary fill is the gym's chosen brand colour — pick whichever
  // of white / near-black ink reads better on it, so a light brand
  // (yellow, cyan) doesn't produce white-on-white labels.
  const primaryLabel =
    contrastRatio(colors.primary, '#FFFFFF') >=
    contrastRatio(colors.primary, '#111827')
      ? '#FFFFFF'
      : '#111827';
  // Icon + spinner tint tracks the variant's text colour: the
  // contrast-picked label on the solid fill, brand Text on ghost links,
  // brand Secondary on the tonal secondary, red on destructive, brand
  // Primary otherwise.
  const accent =
    variant === 'primary'
      ? primaryLabel
      : variant === 'destructive'
        ? '#DC2626'
        : variant === 'ghost'
          ? colors.text
          : variant === 'secondary'
            ? colors.secondary
            : colors.primary;
  return (
    <Pressable
      ref={ref}
      onPress={() => {
        if (!onPress) return;
        // Destructive presses feel more decisive with a heavier
        // thunk; everything else gets the lighter "press" so the
        // primary button doesn't feel like a notification.
        if (variant === 'destructive') haptic.heavy();
        else haptic.press();
        onPress();
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      // Keep the accessible name while the spinner replaces the label.
      accessibilityLabel={typeof children === 'string' ? children : undefined}
      className={`rounded-lg px-5 py-3 items-center justify-center ${containerStyles[variant]} ${
        isDisabled ? 'opacity-50' : ''
      }`}>
      {loading ? (
        <ActivityIndicator color={accent} />
      ) : (
        <RNView className="flex-row items-center gap-2">
          {success ? (
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={variant === 'primary' ? primaryLabel : successIconColor[variant]}
            />
          ) : icon ? (
            <Ionicons name={icon} size={18} color={accent} />
          ) : null}
          <Text
            className={textStyles[variant]}
            style={variant === 'primary' ? { color: primaryLabel } : undefined}>
            {children}
          </Text>
        </RNView>
      )}
    </Pressable>
  );
});
