import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, Text } from 'react-native';

type IconName = ComponentProps<typeof Ionicons>['name'];

type Kind = 'delete' | 'remove' | 'archive' | 'restore';

// Destructive / lifecycle row actions (Archive, Restore, Delete,
// Remove) used by the plans, class-types and members editors. The old
// plain bordered-text buttons read as labels, not actions — these get
// a tone, an icon, and a real disabled treatment.
const KIND_STYLES: Record<
  Kind,
  { container: string; text: string; icon: IconName; iconColor: string }
> = {
  delete: {
    container: 'bg-red-600 active:bg-red-700',
    text: 'text-white',
    icon: 'trash-outline',
    iconColor: '#FFFFFF',
  },
  remove: {
    container:
      'bg-red-500/10 border border-red-500/40 active:bg-red-500/20',
    text: 'text-red-600 dark:text-red-400',
    icon: 'person-remove-outline',
    iconColor: '#EF4444',
  },
  archive: {
    container:
      'bg-amber-500/10 border border-amber-500/40 active:bg-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
    icon: 'archive-outline',
    iconColor: '#F59E0B',
  },
  restore: {
    container:
      'bg-emerald-500/10 border border-emerald-500/40 active:bg-emerald-500/20',
    text: 'text-emerald-600 dark:text-emerald-400',
    icon: 'arrow-undo-outline',
    iconColor: '#10B981',
  },
};

export function ActionButton({
  kind,
  label,
  onPress,
  disabled,
  disabledLabel,
}: {
  kind: Kind;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  if (disabled) {
    return (
      <Pressable
        disabled
        className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800">
        <Ionicons name="lock-closed-outline" size={14} color="#9CA3AF" />
        <Text className="text-gray-400 dark:text-gray-500 text-xs font-semibold">
          {disabledLabel ?? label}
        </Text>
      </Pressable>
    );
  }
  const s = KIND_STYLES[kind];
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      className={`flex-row items-center gap-1.5 px-3 py-2 rounded-lg ${s.container}`}>
      <Ionicons name={s.icon} size={14} color={s.iconColor} />
      <Text className={`text-xs font-semibold ${s.text}`}>{label}</Text>
    </Pressable>
  );
}
