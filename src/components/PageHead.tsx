import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

// The top of a page: what it is, what it is showing, and at most one
// action. The action is the only place on the page allowed to carry the
// gym's colour — repeated row-level actions are ink, because five brand
// pills down a list is a wash rather than an accent.
export function PageHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View className="flex-row items-start gap-3 px-4 pt-3 pb-3.5">
      <View className="flex-1 gap-1">
        <Text
          accessibilityRole="header"
          className="text-ink dark:text-ink-dk text-[26px] font-bold leading-[29px] tracking-[-0.8px]">
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}
