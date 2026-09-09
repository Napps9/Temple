import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Sheet } from '@/components/Sheet';

// Shared shell for the Members-tab action modals (Invite, Import, Tag
// rules). It used to hand-roll a backdrop, a titled header and a
// height-capped scroll body; all three now come from <Sheet>, which means
// these three modals became bottom sheets on a phone without their call
// sites changing.
//
// Kept as its own name rather than collapsing into Sheet because its
// callers share a width and a body rhythm. Both are genuinely footless:
// ImportDataModal is a list of routes, and TagRulesPanel renders at
// /management/tags as well, where there is no foot to put an action in.
// A caller that grows a single primary should use Sheet directly rather
// than teaching this one a foot it has no use for.
export function ManageModal({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Sheet
      visible={visible}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      size="standard">
      <View className="gap-4">{children}</View>
    </Sheet>
  );
}
