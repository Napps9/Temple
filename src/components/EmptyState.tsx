import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { useThemeColors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

// The standard "this list is empty — here's the one thing to do next"
// block. A tinted icon, a heading, a one-line blurb, and a single
// prominent primary CTA so the key action is the most visible thing on
// an otherwise-empty screen. Omit the action for a purely informational
// empty state.
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionIcon = 'add',
  onAction,
}: {
  icon: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-6 items-center gap-3">
      <View className="w-12 h-12 rounded-full bg-primary/10 items-center justify-center">
        <Ionicons name={icon} size={24} color={colors.primary} />
      </View>
      <View className="gap-1 items-center">
        <Text className="text-ink dark:text-ink-dk font-semibold text-base">
          {title}
        </Text>
        {description ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
            {description}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <View className="w-full mt-1">
          <Button onPress={onAction} icon={actionIcon}>
            {actionLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
