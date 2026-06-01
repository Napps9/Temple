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
  primary: 'bg-brand active:bg-brand-dark',
  secondary: 'bg-ink-soft border border-bone/20 active:bg-bone/10',
  ghost: 'bg-transparent',
};

const textStyles: Record<Variant, string> = {
  primary: 'text-ink font-semibold',
  secondary: 'text-bone',
  ghost: 'text-brand',
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
        <ActivityIndicator color={variant === 'primary' ? '#0B1220' : '#C5A572'} />
      ) : (
        <Text className={textStyles[variant]}>{children}</Text>
      )}
    </Pressable>
  );
});
