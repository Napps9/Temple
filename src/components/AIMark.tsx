import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/lib/theme';

// The one glyph that means "a machine did this" — the agent's face on the
// Timeline, on a lead conversation it is handling, on the composer's send
// button, in the sidebar.
//
// It is a four-point star, which is what every product shipping an
// assistant uses, so the glyph itself carries no ownership. Three rules do
// that job instead, and they are the reason this is a component rather
// than an <Ionicons name="sparkles" />:
//
//   1. It is SOLID. Every other icon in the app is a 1.6px monoline
//      stroke, so "a machine" lands from the fill before the silhouette
//      has been read.
//   2. In an avatar slot it takes a rounded SQUARE. Every person in the
//      product is a circle; the shape says "an entity, not a human"
//      before the glyph inside it does, and it survives greyscale.
//   3. It is never the gym's colour. The accent means the gym; this means
//      Temple. Two signals, two treatments.
//
// Sizes under 22 render bare, standing in for a line icon. 22 and up take
// the tile.
const STAR =
  'M12 2.1c.85 4.6 2.3 6.9 5.6 7.95l3.3.95-3.3.95c-3.3 1.05-4.75 3.35-5.6 7.95-.85-4.6-2.3-6.9-5.6-7.95L3.1 11l3.3-.95C9.7 9 11.15 6.7 12 2.1z';

const TILE_AT = 22;

export function AIMark({
  size = 20,
  color,
}: {
  size?: number;
  // Override for the two places the mark sits on something that is
  // already ink: inside a dark pill, or on a media scrim.
  color?: string;
}) {
  const colors = useThemeColors();
  const tiled = size >= TILE_AT;
  const glyph = tiled ? Math.round(size * 0.56) : size;
  const fill = color ?? (tiled ? colors.surface : colors.ink);

  const star = (
    <Svg width={glyph} height={glyph} viewBox="0 0 24 24">
      <Path d={STAR} fill={fill} />
    </Svg>
  );

  if (!tiled) return star;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundColor: colors.ink,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {star}
    </View>
  );
}
