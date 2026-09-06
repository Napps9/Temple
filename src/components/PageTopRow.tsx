import { type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { MD } from '@/lib/breakpoint';

// A main screen's top row: the date header on Book, Classes, Programming
// and Timeline. Below md there is no bar above it (the sections and the
// avatar live in the dock), so this is the first thing under the clock,
// with the bar's old insets. The centre is centred on the screen rather
// than between the sides — a date that sat midway between a 36px button
// and an empty zone read as off-centre against the week strip below it.
// The sides stay in flow so they never overlap each other; the centre
// floats over the row and only wins touches on its own content. At md+
// it is an ordinary three-zone row with whatever padding the caller's
// className gives it.
export function PageTopRow({
  left,
  center,
  right,
  className,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  const { width } = useWindowDimensions();
  const phone = width < MD;

  if (!phone) {
    return (
      <View className={`flex-row items-center ${className ?? ''}`}>
        <View className="flex-1 flex-row items-center justify-start">{left}</View>
        {center}
        <View className="flex-1 flex-row items-center justify-end">{right}</View>
      </View>
    );
  }

  return (
    <View
      className={`flex-row items-center ${className ?? ''}`}
      style={{ paddingTop: 10, paddingHorizontal: 16 }}>
      <View className="flex-1 flex-row items-center justify-start gap-2">{left}</View>
      <View className="flex-1 flex-row items-center justify-end gap-2">{right}</View>
      {center ? (
        <View
          pointerEvents="box-none"
          className="absolute left-0 right-0 top-0 bottom-0 items-center justify-center">
          {center}
        </View>
      ) : null}
    </View>
  );
}
