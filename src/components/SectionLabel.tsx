import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

// The one small-caps label token in the product, written once here.
//
// Before this it was written by hand in 30 files at four sizes (9, 10, 11
// and 12px), three weights and two greys, so the same idiom — a caps rule
// naming what is under it — looked different on adjacent screens and
// sometimes within one card.
//
// `uppercase` is a style, not a transform of the string, so a screen
// reader still hears "Email address" rather than the shouted version.
// Split from its colour so the always-dark auth surfaces, which cannot
// use a `dark:` variant, can name the dark end of the ramp directly and
// still be the same label.
export const LABEL_TYPE = 'text-[11px] font-semibold uppercase tracking-[1px]';
export const LABEL_CLASS = `${LABEL_TYPE} text-ink-3 dark:text-ink-3-dk`;

// Above a group of rows. It replaces the card heading: where the old
// pattern gave every group a white box with a bold title inside it, this
// labels the group and lets the rows be the only surface on the page.
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
      <Text accessibilityRole="header" className={LABEL_CLASS}>
        {children}
      </Text>
      {right}
    </View>
  );
}

// Above a control that is not an Input — a chip row, a picker, a switch
// list, a read-only fact. Same token, no heading role: it names a field,
// and a form of fifteen fields is not fifteen headings.
export function FieldLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Text className={className ? `${LABEL_CLASS} ${className}` : LABEL_CLASS}>
      {children}
    </Text>
  );
}
