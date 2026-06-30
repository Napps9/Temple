import { Children, isValidElement, type ReactNode } from 'react';
import { View } from 'react-native';

// Responsive tile grid: 2 columns on mobile, 3 from md, 4 from xl. Uses
// fractional widths + padding gutters (no calc()) so it behaves the same
// on native and web; flex-wrap lines stretch to equal height, so children
// should be self-stretching tiles (flex-1 / min-h). The negative margin
// cancels the edge cells' padding so the grid lines up with siblings.
//
// This is the shared "card grid" used across the Track surfaces so the
// desktop layout reflows consistently instead of stranding whitespace.
export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row flex-wrap -m-1">
      {Children.map(children, (child, i) => {
        if (child == null || child === false) return null;
        const key = isValidElement(child) && child.key != null ? child.key : i;
        return (
          <View key={key} className="w-1/2 md:w-1/3 xl:w-1/4 p-1">
            {child}
          </View>
        );
      })}
    </View>
  );
}
