import { forwardRef, useRef, type ReactNode } from 'react';
import {
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';

import { DOCK_CLEARANCE } from './BottomDock';
import { MD } from '@/lib/breakpoint';
import { reportDockScroll } from '@/lib/dock';

// A page's scroller below md, where the dock floats over the bottom of
// the page and the page scrolls under it. The scroller runs to the
// bottom edge; the spacer keeps the last row clear of the dock at rest.
// It is short of the dock's true clearance because the content
// container's own padding and gap add to it. Scrolling also drives the
// dock's size (lib/dock). Above md there is no dock, so this is a plain
// ScrollView.
export const PageScroll = forwardRef<
  ScrollView,
  ScrollViewProps & { children?: ReactNode }
>(function PageScroll({ children, onScroll, ...rest }, ref) {
  const { width } = useWindowDimensions();
  const phone = width < MD;
  const lastY = useRef(0);
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll?.(e);
    if (!phone) return;
    const y = e.nativeEvent.contentOffset.y;
    reportDockScroll(y, y - lastY.current);
    lastY.current = y;
  };
  return (
    <ScrollView ref={ref} scrollEventThrottle={16} {...rest} onScroll={handleScroll}>
      {children}
      {phone ? <View style={{ height: DOCK_CLEARANCE - 24 }} /> : null}
    </ScrollView>
  );
});
