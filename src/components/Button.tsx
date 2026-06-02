import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, type View } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
};

const containerStyles: Record<Variant, string> = {
  primary: 'bg-primary active:bg-primary-dark',
  secondary: 'bg-white border border-gray-200 active:bg-gray-50',
  ghost: 'bg-transparent',
};

const textStyles: Record<Variant, string> = {
  primary: 'text-white font-semibold',
  secondary: 'text-gray-900',
  ghost: 'text-primary',
};

export const Button = forwardRef<View, Props>(function Button(
  { children, onPress, loading, disabled, variant = 'primary' },
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
        <Text className={textStyles[variant]}>{children}</Text>
      )}
    </Pressable>
  );
});
