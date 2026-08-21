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
  wrap,
  foot,
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
  // Let the subtitle run to two lines instead of being clipped to one,
  // and top-align the row so the chevron stays on the title's line. For
  // the six places that are a *door* — a destination with a sentence
  // explaining where it goes, rather than a record with a field under
  // it. Those were six hand-rolled cards before this.
  wrap?: boolean;
  // A third, quieter line under the subtitle. Only doors have one — it is
  // where the Manage hub tells you the thing you just searched for is
  // something you could have said instead.
  foot?: ReactNode;
}) {
  const colors = useThemeColors();
  const tappable = !!href || !!onPress;

  const align = wrap ? 'items-start' : 'items-center';
  const shell = ruled
    ? `flex-row ${align} gap-3 px-3.5 py-3 ${
        first ? '' : 'border-t border-line dark:border-line-dk'
      }`
    : `flex-row ${align} gap-3 px-3.5 py-3 rounded-card border border-line dark:border-line-dk bg-surface dark:bg-surface-dk`;

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
            numberOfLines={wrap ? 2 : 1}
            className={
              wrap
                ? 'text-ink-2 dark:text-ink-2-dk text-[12.5px] leading-[17px]'
                : 'text-ink-3 dark:text-ink-3-dk text-[12.5px]'
            }>
            {subtitle}
          </Text>
        ) : null}
        {foot}
      </View>
      {chip}
      {trailing ??
        (tappable ? (
          <View className={wrap ? 'pt-1' : undefined}>
            <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
          </View>
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

// The lead five of the six doors draw by hand: a tinted square holding a
// monoline glyph. It lives here rather than in its own file because it is
// the lead slot's commonest filler, not a part in its own right.
export function IconTile({
  name,
  size = 34,
}: {
  name: ComponentProps<typeof Ionicons>['name'];
  size?: number;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={{ width: size, height: size }}
      className="rounded-ctl bg-raised dark:bg-raised-dk items-center justify-center">
      <Ionicons name={name} size={Math.round(size * 0.52)} color={colors.ink2} />
    </View>
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
