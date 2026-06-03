import { Ionicons } from '@expo/vector-icons';
import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View as RNView, type View } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  loading?: boolean;
  success?: boolean;
  disabled?: boolean;
  variant?: Variant;
};

const containerStyles: Record<Variant, string> = {
  primary: 'bg-primary active:bg-primary-dark',
  secondary:
    'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 active:bg-gray-50 dark:active:bg-gray-800',
  ghost: 'bg-transparent',
};

const textStyles: Record<Variant, string> = {
  primary: 'text-white font-semibold',
  secondary: 'text-gray-900 dark:text-gray-50',
  ghost: 'text-primary',
};

const successIconColor: Record<Variant, string> = {
  primary: '#FFFFFF',
  secondary: '#16A34A',
  ghost: '#16A34A',
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
