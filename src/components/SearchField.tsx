import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { TextInput } from './Text';

import { useThemeColors } from '@/lib/theme';

// The one search field. It existed as eight hand-rolled shapes — three
// bordered cards with an icon and a clear button that disagreed on
// radius and tint, three bare TextInputs, one with a submit button
// bolted on, and the labelled Input pressed into service three
// different ways. This is the Manage hub's shape, which was the most
// complete: leading search glyph, control radius, and a clear button
// that appears once there is something to clear.
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  autoFocus,
  returnKeyType,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  // Defaults to the placeholder — pass one when the placeholder is a
  // hint ("refunds, sending domain…") rather than a name for the field.
  accessibilityLabel?: string;
  autoFocus?: boolean;
  returnKeyType?: 'search' | 'done';
  onSubmitEditing?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-2 bg-surface dark:bg-surface-dk border border-line-strong dark:border-line-dk rounded-ctl px-3">
      <Ionicons name="search" size={18} color={colors.ink2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        className="flex-1 py-3 text-ink dark:text-ink-dk"
      />
      {value.trim().length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear the search">
          <Ionicons name="close-circle" size={18} color={colors.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
}
