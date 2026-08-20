import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from './Text';
import { useThemeColors } from '@/lib/theme';

// Temple's mark: a portico. An architrave, three columns, a stylobate.
//
// It replaces the three offset cards — gold, steel blue and ink, each
// holding a column, the offset doing the work of a drop shadow. That was
// a considered identity, but it was built on the two things the design
// system removed: colour in the furniture, and depth from shadow rather
// than from a hairline and a tone step.
//
// Straight lines only, and no enclosing shape. It is the one direction of
// the four drawn that still reads as a building at 15px and cannot be
// mistaken for a letter — which matters more than usual here, because it
// sits beside a lowercase wordmark, and anything with a counter starts
// reading as the word's first character.
//
// Drawn rather than loaded, so it takes the ink of whatever it sits on at
// any size in either scheme from one source instead of a PNG per pairing.
export const PORTICO =
  'M3 6h42v7H3zM8.5 17h6.4v16H8.5zM20.8 17h6.4v16h-6.4zM33.1 17h6.4v16h-6.4zM3 36h42v7H3z';

export function TempleMark({ size = 44, color }: { size?: number; color?: string }) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityLabel="Temple">
      <Path d={PORTICO} fill={color ?? colors.ink} />
    </Svg>
  );
}

// The wordmark. Lowercase and serif: Temple is the thing a gym runs on,
// not a monument, and the old letterspaced caps with a TECHNOLOGY tagline
// said the opposite.
//
// The family is set inline rather than through a class because Text
// prepends `font-normal`, which names Geist — and two font-family
// utilities of equal specificity resolve by stylesheet order, not by the
// order they appear in the class string. An inline style is the one that
// reliably wins, and this is the only place in the product that needs it.
export function TempleWordmark({
  size = 26,
  color,
}: {
  size?: number;
  color?: string;
}) {
  const colors = useThemeColors();
  return (
    <Text
      style={{
        fontFamily: 'Fraunces_700Bold',
        fontSize: size,
        lineHeight: size * 1.1,
        color: color ?? colors.ink,
      }}>
      temple
    </Text>
  );
}

// Mark and wordmark together. The portico is drawn across about three
// quarters of its box, so the box runs a little taller than the type to
// land the architrave and the stylobate near the word's own extremes.
export function TempleLockup({ size = 26, color }: { size?: number; color?: string }) {
  return (
    <View
      className="flex-row items-center"
      style={{ gap: Math.round(size * 0.3) }}
      accessibilityLabel="Temple">
      <TempleMark size={Math.round(size * 1.18)} color={color} />
      <TempleWordmark size={size} color={color} />
    </View>
  );
}
