import { forwardRef, type ReactNode } from 'react';
import {
  ScrollView,
  useWindowDimensions,
  View,
  type ScrollViewProps,
} from 'react-native';

import { DOCK_CLEARANCE } from './BottomDock';
import { MD } from '@/lib/breakpoint';

// A page's scroller below md, where the dock floats over the bottom of
// the page and the page scrolls under it. The scroller runs to the
// bottom edge; the spacer keeps the last row clear of the dock at rest.
// It is short of the dock's true clearance because the content
// container's own padding and gap add to it. Above md there is no dock,
// so this is a plain ScrollView.
export const PageScroll = forwardRef<
  ScrollView,
  ScrollViewProps & { children?: ReactNode }
>(function PageScroll({ children, ...rest }, ref) {
  const { width } = useWindowDimensions();
  return (
    <ScrollView ref={ref} {...rest}>
      {children}
      {width < MD ? <View style={{ height: DOCK_CLEARANCE - 24 }} /> : null}
    </ScrollView>
  );
});
