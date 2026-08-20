import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { haptic } from '@/lib/haptic';
import { useThemeColors } from '@/lib/theme';

type LinkHref = ComponentProps<typeof Link>['href'];

// The one row shape behind every list in the product — members, leads,
// plans, products, movements, bookings, team, tasks. Before this there
// were about a dozen hand-rolled variants of the same thing, each with
// its own padding and its own idea of where the chevron goes.
//
// Two arrangements, chosen by what the list IS:
//
//   `ruled` — rows inside one bordered card, divided by hairlines. Use
//     when the list is a table: many rows, scanned by column.
//   default — a standalone bordered card per row, with a gap. Use when
//     each row is an object you tap into.
//
// A row is tappable if it is given `href` or `onPress`; the chevron
// appears for exactly those and never as decoration.
export function ListRow({
  lead,
  title,
  subtitle,
  chip,
  trailing,
  href,
  onPress,
  ruled,
  first,
}: {
  // Avatar, icon, class-type dot, date block — whatever identifies the row.
  lead?: ReactNode;
  title: string;
  subtitle?: string;
  // Status, at the end of the content and before the chevron.
  chip?: ReactNode;
  // Replaces the chevron entirely when the row's action is not "open me".
  trailing?: ReactNode;
  href?: LinkHref;
  onPress?: () => void;
  ruled?: boolean;
  // Ruled rows draw their own top hairline; the first in a group does not.
  first?: boolean;
}) {
  const colors = useThemeColors();
  const tappable = !!href || !!onPress;

  const shell = ruled
    ? `flex-row items-center gap-3 px-3.5 py-3 ${
        first ? '' : 'border-t border-line dark:border-line-dk'
      }`
    : 'flex-row items-center gap-3 px-3.5 py-3 rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk';

  const body = (
    <>
      {lead}
      <View className="flex-1 gap-0.5 min-w-0">
        <Text
          numberOfLines={1}
          className="text-ink dark:text-ink-dk text-[15.5px] font-semibold tracking-[-0.2px]">
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {chip}
      {trailing ??
        (tappable ? (
          <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
        ) : null)}
    </>
  );

  if (!tappable) return <View className={shell}>{body}</View>;

  const pressable = (
    <Pressable
      onPress={
        onPress
          ? () => {
              haptic.tap();
              onPress();
            }
          : undefined
      }
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      className={`${shell} active:bg-raised dark:active:bg-raised-dk`}>
      {body}
    </Pressable>
  );

  return href ? (
    <Link href={href} asChild>
      {pressable}
    </Link>
  ) : (
    pressable
  );
}

// Wraps a run of `ruled` rows in the single bordered card they share.
export function RuledList({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk overflow-hidden">
      {children}
    </View>
  );
}
