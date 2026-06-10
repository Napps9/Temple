import { Ionicons } from '@expo/vector-icons';
import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View as RNView, type View } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  loading?: boolean;
  success?: boolean;
  disabled?: boolean;
  variant?: Variant;
};

// Tonal primary on secondary so the button reads as an action — the
// previous near-invisible white-on-white version disappeared inside
// modal footers and on light-mode pages.
const containerStyles: Record<Variant, string> = {
  primary: 'bg-primary active:bg-primary-dark',
  secondary:
    'bg-primary/10 border border-primary/30 active:bg-primary/20',
  ghost: 'bg-transparent',
  destructive:
    'bg-white dark:bg-gray-900 border border-red-300 dark:border-red-700 active:bg-red-50 dark:active:bg-red-900/20',
};

const textStyles: Record<Variant, string> = {
  primary: 'text-white font-semibold',
  secondary: 'text-primary font-semibold',
  ghost: 'text-primary',
  destructive: 'text-red-600 dark:text-red-400 font-semibold',
};

const successIconColor: Record<Variant, string> = {
  primary: '#FFFFFF',
  secondary: '#16A34A',
  ghost: '#16A34A',
  destructive: '#DC2626',
};

export const Button = forwardRef<View, Props>(function Button(
  { children, onPress, loading, success, disabled, variant = 'primary' },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      disabled={isDisabled}
      className={`rounded-lg px-5 py-3 items-center justify-center ${containerStyles[variant]} ${
        isDisabled ? 'opacity-50' : ''
      }`}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#FFFFFF' : '#2563EB'} />
      ) : (
        <RNView className="flex-row items-center gap-2">
          {success ? (
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={successIconColor[variant]}
            />
          ) : null}
          <Text className={textStyles[variant]}>{children}</Text>
        </RNView>
      )}
    </Pressable>
  );
});
