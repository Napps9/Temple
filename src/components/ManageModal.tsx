import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Sheet } from '@/components/Sheet';

// Shared shell for the Members-tab action modals (Invite, Import, Tag
// rules). It used to hand-roll a backdrop, a titled header and a
// height-capped scroll body; all three now come from <Sheet>, which means
// these three modals became bottom sheets on a phone without their call
// sites changing.
//
// Kept as its own name rather than collapsing into Sheet because the
// three callers put their own actions inside the body, so there is no
// foot — and a Sheet with no `actions` is exactly this.
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
      dialogWidth={560}>
      <View className="gap-4 pb-4">{children}</View>
    </Sheet>
  );
}
