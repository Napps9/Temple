import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { useThemeColors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

// The four states every list owes you, and they are four different
// screens rather than one spinner.
//
//   empty    nothing yet. The one thing to do next, prominently.
//   filtered nothing matches. The list is fine; the filter is the
//            problem, so the action clears it rather than creating
//            something.
//   loading  a skeleton of the shape that is coming, not a spinner in
//            the middle of a blank page — the page should not move when
//            the data lands.
//   failed   it broke. Say what broke and offer to try again.
//
// The distinction that matters most is empty vs filtered: "No members
// yet — invite your first" shown to an owner with 214 members and a
// search box reading "zzz" is the system telling them something false.
type Kind = 'empty' | 'filtered' | 'loading' | 'failed';

export function EmptyState({
  kind = 'empty',
  icon,
  title,
  description,
  actionLabel,
  actionIcon = 'add',
  onAction,
  rows = 3,
}: {
  kind?: Kind;
  // Not needed by loading or failed — they carry their own.
  icon?: IconName;
  title?: string;
  description?: string;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  // loading only: how many skeleton rows to stand in for.
  rows?: number;
}) {
  const colors = useThemeColors();

  if (kind === 'loading') {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={title ?? 'Loading'}
        className="rounded-card border border-line dark:border-line-dk overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <View
            key={i}
            className={`flex-row items-center gap-3 px-3.5 py-3.5 ${
              i === 0 ? '' : 'border-t border-line dark:border-line-dk'
            }`}>
            <View className="w-8 h-8 rounded-full bg-raised dark:bg-raised-dk" />
            <View className="flex-1 gap-1.5">
              <View className="h-3 rounded-full bg-raised dark:bg-raised-dk w-1/3" />
              <View className="h-2.5 rounded-full bg-raised dark:bg-raised-dk w-3/5" />
            </View>
          </View>
        ))}
      </View>
    );
  }

  const shown: { icon: IconName; title: string; tint: string } =
    kind === 'failed'
      ? {
          icon: icon ?? 'alert-circle-outline',
          title: title ?? 'That did not load',
          tint: '#DC2626',
        }
      : kind === 'filtered'
        ? {
            icon: icon ?? 'search-outline',
            title: title ?? 'Nothing matches',
            tint: colors.ink3,
          }
        : { icon: icon ?? 'add', title: title ?? '', tint: colors.primary };

  return (
    <View className="bg-surface dark:bg-surface-dk rounded-card border border-line dark:border-line-dk p-6 items-center gap-3">
      <View
        className={`w-12 h-12 rounded-full items-center justify-center ${
          kind === 'empty'
            ? 'bg-primary/10'
            : kind === 'failed'
              ? 'bg-red-500/10'
              : 'bg-raised dark:bg-raised-dk'
        }`}>
        <Ionicons name={shown.icon} size={24} color={shown.tint} />
      </View>
      <View className="gap-1 items-center">
        <Text className="text-ink dark:text-ink-dk font-semibold text-base text-center">
          {shown.title}
        </Text>
        {description ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
            {description}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <View className="w-full mt-1">
          {/* Only the genuinely-empty state gets the accent: it is the one
              where the action is the point of the screen. Clearing a
              filter or retrying is recovery, not the page's purpose. */}
          <Button
            variant={kind === 'empty' ? 'primary' : 'plain'}
            onPress={onAction}
            icon={kind === 'failed' ? 'refresh' : actionIcon}>
            {actionLabel}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

// A spinner still has one job: a button or a card that is busy inside an
// otherwise-drawn page, where a skeleton would be the wrong shape.
export function Spinner({ label }: { label?: string }) {
  const colors = useThemeColors();
  return (
    <View className="items-center justify-center gap-2 py-6">
      <ActivityIndicator color={colors.ink3} />
      {label ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">{label}</Text>
      ) : null}
    </View>
  );
}
