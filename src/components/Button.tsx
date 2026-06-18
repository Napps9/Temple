import { Ionicons } from '@expo/vector-icons';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View as RNView, type View } from 'react-native';

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
  primary: 'bg-primary active:bg-primary-dark',
  secondary:
    'bg-secondary/10 border border-secondary/30 active:bg-secondary/20',
  ghost: 'bg-transparent',
  destructive:
    'bg-white dark:bg-gray-900 border border-red-300 dark:border-red-700 active:bg-red-50 dark:active:bg-red-900/20',
};

const textStyles: Record<Variant, string> = {
  primary: 'text-white font-semibold',
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
  // Icon + spinner tint tracks the variant's text colour: white on the
  // solid fill, brand Text on ghost links, brand Secondary on the tonal
  // secondary, red on destructive, brand Primary otherwise.
  const accent =
    variant === 'primary'
      ? '#FFFFFF'
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
              color={successIconColor[variant]}
            />
          ) : icon ? (
            <Ionicons name={icon} size={18} color={accent} />
          ) : null}
          <Text className={textStyles[variant]}>{children}</Text>
        </RNView>
      )}
    </Pressable>
  );
});
