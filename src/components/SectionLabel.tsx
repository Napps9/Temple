import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

// A small caps rule above a group of rows. It replaces the card heading:
// where the old pattern gave every group a white box with a bold title
// inside it, this labels the group and lets the rows be the only surface
// on the page.
//
// `right` is for the one piece of context or link that belongs to the
// group rather than to any row in it — "5 classes", "See all".
export function SectionLabel({
  children,
  right,
}: {
  children: string;
  right?: ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3 px-4 pb-2.5">
      <Text
        accessibilityRole="header"
        className="text-ink-3 dark:text-ink-3-dk text-[11px] font-semibold uppercase tracking-[1px]">
        {children}
      </Text>
      {right}
    </View>
  );
}
