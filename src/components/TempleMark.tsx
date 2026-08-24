import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { STAR } from './AIMark';
import { Text } from './Text';
import { BRAND } from '@/lib/theme';
import { useThemeColors } from '@/lib/theme';

// Temple's mark is the star, in the brand magenta — the same four-point
// silhouette the AI wears, because the AI front desk is the thing Temple
// leads with, and the colour is what separates the two jobs: magenta
// means Temple, ink means "a machine wrote this" (AIMark). The
// three-offset-cards mark this replaces survives as a design motif (the
// get-started deck, the ghost cards), not as the logo.
//
// Drawn rather than loaded, same as ever: one path, any size, no files.
export function TempleMark({ size = 44, color }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="Temple">
      <Path d={STAR} fill={color ?? BRAND} />
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

// The lockup: the word with the star tucked against the final letter's
// shoulder, the way a signature dots its own i. The star keeps the brand
// magenta whatever ink the word takes; `color` overrides both for the
// rare surface that needs one.
export function TempleLockup({ size = 26, color }: { size?: number; color?: string }) {
  const starSize = Math.round(size * 0.42);
  return (
    <View accessibilityLabel="Temple">
      <TempleWordmark size={size} color={color} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: -Math.round(size * 0.18),
          top: -Math.round(size * 0.2),
        }}>
        <Svg width={starSize} height={starSize} viewBox="0 0 24 24">
          <Path d={STAR} fill={color ?? BRAND} />
        </Svg>
      </View>
    </View>
  );
}
