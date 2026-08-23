import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Text } from './Text';
import { useThemeColors } from '@/lib/theme';

// Temple's mark, drawn rather than loaded.
//
// The three offset cards, back by the owner's call — the silhouette the
// product carried before the portico, in the one-ink form it took when
// the mark first lost its colour: the front card holds the column as a
// knockout, and the gold and steel-blue cards behind became hairlines.
// One colour, because the system this sits in gets its depth from a
// hairline and a tone step and has no gradients or drop shadows
// anywhere else.
//
// Drawn as SVG rather than a PNG pair so it takes the ink of whatever it
// is placed on, at any size, in either scheme, without a second file.

// The front card with the column cut out of it, as one even-odd path: the
// column has to be a hole rather than a filled shape, because the mark is
// placed on surface and on ground, and a hole is the only version that is
// right on both.
export const CARD =
  'M5 0H67A5 5 0 0 1 72 5V67A5 5 0 0 1 67 72H5A5 5 0 0 1 0 67V5A5 5 0 0 1 5 0Z' +
  'M27 31.5A9 6 0 0 1 45 31.5V63H27Z';

// Below this the two cards behind stop being depth and start being noise:
// their stroke lands under half a pixel, the doorway loses the room it
// needs, and what is left is two grey smudges. A favicon-sized mark is the
// front card alone. The lockup sits above this deliberately — dropping the
// cards there would throw away the silhouette in the one place the mark is
// most often seen.
export const GHOSTS_ABOVE = 20;

export function TempleMark({ size = 44, color }: { size?: number; color?: string }) {
  const colors = useThemeColors();
  const ink = color ?? colors.ink;
  const ghosts = size >= GHOSTS_ABOVE;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={ghosts ? '-2 -2 96 96' : '-2 -2 76 76'}
      accessibilityLabel="Temple">
      {ghosts ? (
        <>
          <Rect
            x={20.8}
            y={20.8}
            width={70.4}
            height={70.4}
            rx={5}
            fill="none"
            stroke={ink}
            strokeWidth={2}
            strokeOpacity={0.3}
          />
          <Rect
            x={10.8}
            y={10.8}
            width={70.4}
            height={70.4}
            rx={5}
            fill="none"
            stroke={ink}
            strokeWidth={2}
            strokeOpacity={0.55}
          />
        </>
      ) : null}
      <Path d={CARD} fill={ink} fillRule="evenodd" />
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

// Mark and wordmark together. The mark runs a little taller than the type
// because it is a square with two cards trailing off its bottom-right —
// the front card, which is the part that reads, is only three quarters of
// the box, so matching the box to the cap height leaves the mark looking
// undersized next to the word.
export function TempleLockup({ size = 26, color }: { size?: number; color?: string }) {
  return (
    <View
      className="flex-row items-center"
      style={{ gap: Math.round(size * 0.34) }}
      accessibilityLabel="Temple">
      <TempleMark size={Math.round(size * 1.08)} color={color} />
      <TempleWordmark size={size} color={color} />
    </View>
  );
}
