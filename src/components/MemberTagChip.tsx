import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

// Small coloured pill: label + colour from the tag, optional close button
// for manual tags. Auto tags are read-only (the rule materialises them);
// the parent should not pass onRemove for auto tags.

type Props = {
  label: string;
  color: string;
  source: 'manual' | 'auto';
  onRemove?: () => void;
};

export function MemberTagChip({ label, color, source, onRemove }: Props) {
  return (
    <View
      style={{ backgroundColor: color }}
      className="flex-row items-center gap-1 rounded-full px-2.5 py-1">
      {source === 'auto' ? (
        <Ionicons name="sparkles" size={11} color="#FFFFFF" />
      ) : null}
      <Text className="text-white text-xs font-medium">{label}</Text>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityLabel={`Remove tag ${label}`}>
          <Ionicons name="close" size={13} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}
