import { forwardRef, type ReactNode } from 'react';
import {
  ScrollView,
  useWindowDimensions,
  View,
  type ScrollViewProps,
} from 'react-native';

import { DOCK_CLEARANCE } from './BottomDock';
import { MD } from '@/lib/breakpoint';

// A page's scroller below md, where the chrome floats: the account
// cluster over the top of the page and the dock over the bottom, and the
// page scrolls under both. The scroller runs edge to edge; these two
// spacers keep the first and last rows clear of the chrome at rest. They
// are short of the chrome's true height because the content container's
// own padding and gap add to each. A page whose top row is the chrome
// itself (PageTopRow) passes top={false}. Above md the bar is in flow and
// there is no dock, so this is a plain ScrollView.
export const PageScroll = forwardRef<
  ScrollView,
  ScrollViewProps & { top?: boolean; children?: ReactNode }
>(function PageScroll({ top = true, children, ...rest }, ref) {
  const { width } = useWindowDimensions();
  const phone = width < MD;
  return (
    <ScrollView ref={ref} {...rest}>
      {phone && top ? <View style={{ height: 30 }} /> : null}
      {children}
      {phone ? <View style={{ height: DOCK_CLEARANCE - 24 }} /> : null}
    </ScrollView>
  );
});
