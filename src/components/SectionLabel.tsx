import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

// A small caps rule above a group of rows. It replaces the card heading:
// where the old pattern gave every group a white box with a bold title
// inside it, this labels the group and lets the rows be the only surface
// on the page.
//
// `right` is for the one piece of context or link that belongs to the
// group rather than to any row in it — "5 classes", "See all".
//
// Like PageHead it draws no padding. A label belongs to the group under
// it, so the call site wraps the two in a tighter stack than the page's
// own — `<View className="gap-2">` — rather than the label reaching down
// with a margin it cannot know the size of.
export function SectionLabel({
  children,
  right,
}: {
  children: string;
  right?: ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text
        accessibilityRole="header"
        className="text-ink-3 dark:text-ink-3-dk text-[11px] font-semibold uppercase tracking-[1px]">
        {children}
      </Text>
      {right}
    </View>
  );
}
