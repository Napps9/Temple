import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

// Small coloured pill: label + colour from the tag, optional close button
// for manual tags. Auto tags are read-only (the rule materialises them);
// the parent should not pass onRemove for auto tags.
//
// visible/onToggleVisible surface the member_visible flag on the manage
// screen: an eye marks a tag the member can see, and (for manual tags)
// tapping it flips the flag. Auto tags' visibility follows their rule, so
// the parent should pass visible without onToggleVisible for those.

type Props = {
  label: string;
  color: string;
  source: 'manual' | 'auto';
  onRemove?: () => void;
  visible?: boolean;
  onToggleVisible?: () => void;
};

export function MemberTagChip({
  label,
  color,
  source,
  onRemove,
  visible,
  onToggleVisible,
}: Props) {
  const eye = (
    <Ionicons
      name={visible ? 'eye' : 'eye-off'}
      size={12}
      color="#FFFFFF"
      style={visible ? undefined : { opacity: 0.6 }}
    />
  );
  return (
    <View
      style={{ backgroundColor: color }}
      className="flex-row items-center gap-1 rounded-full px-2.5 py-1">
      {source === 'auto' ? (
        <Ionicons name="sparkles" size={11} color="#FFFFFF" />
      ) : null}
      <Text className="text-white text-xs font-medium">{label}</Text>
      {onToggleVisible ? (
        <Pressable
          onPress={onToggleVisible}
          hitSlop={8}
          accessibilityLabel={
            visible ? `Hide tag ${label} from the member` : `Show tag ${label} to the member`
          }>
          {eye}
        </Pressable>
      ) : visible !== undefined ? (
        eye
      ) : null}
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
