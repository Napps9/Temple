import { Platform, StyleSheet, type ViewStyle } from 'react-native';

// Floating chrome — the phone's dock and the Timeline's talk bar — sits
// over the page rather than walling it off, so the page has to stay
// visible through it. A translucent fill does most of that work; the blur
// is what keeps the chrome's own text legible when a busy card scrolls
// underneath it.
//
// Web only, and not an oversight: backdrop-filter is a browser feature,
// React Native ignores the style, and the only way to have it on the
// native binaries is a native blur module — a rebuild of both apps for a
// property that degrades honestly without it. Without the blur the
// translucency alone still shows movement under the chrome, which is the
// part that says "the page continues here".
//
// StyleSheet.create rather than a bare object, and it is the whole reason
// the blur worked anywhere at all: react-native-web only runs its vendor
// prefixer on registered styles. An object literal handed to style= goes
// down the inline path and reaches the DOM as `backdrop-filter` alone,
// which Safari did not support unprefixed until 18 — so on an older
// iPhone the property was dropped and the dock was a plain white slab.
// Registering it puts the declaration through RNW's prefix map, which
// already lists backdropFilter, and both spellings ship.
export const GLASS: ViewStyle | undefined =
  Platform.OS === 'web'
    ? StyleSheet.create({
        g: { backdropFilter: 'blur(24px) saturate(1.8)' } as unknown as ViewStyle,
      }).g
    : undefined;

// The fill that goes with it. Sheer enough that a card moving underneath
// is visible rather than implied — at 80% over this ground it was not:
// white at 80% over #F7F7F8 composites to #FDFDFD, which is a solid white
// pill with extra steps. The blur is what buys the legibility back, so
// native, which has none, keeps the heavier fill and lets its
// translucency alone do the smaller job it can do.
export const GLASS_FILL =
  Platform.OS === 'web'
    ? 'bg-surface/60 dark:bg-surface-dk/60'
    : 'bg-surface/80 dark:bg-surface-dk/80';

// The Timeline's day header, and the one piece of chrome here that is
// not a uniform sheet. It ramps: heaviest blur hard against the top of
// the window, easing to almost nothing by the time it reaches the day
// numbers, so a card does not hit an invisible wall as it scrolls up —
// it goes soft, then softer, then it is gone.
//
// A single backdrop-filter cannot do that; the property is one radius
// over the whole element. So it is four of them stacked, each blurring
// more than the last and each masked to a band nearer the top. A layer's
// backdrop is everything painted behind it, siblings included, so the
// blurs compound downward through the stack — roughly 26px at the top
// edge, nothing at the bottom — and the mask's own gradient is what
// makes each step a fade rather than a seam.
//
// The percentages are of the header's height, so the ramp holds its
// shape whether the header is two phone rows or two wider ones.
const rampLayer = (blur: number, solid: number, gone: number) => {
  const mask = `linear-gradient(to bottom, #000 0%, #000 ${solid}%, transparent ${gone}%)`;
  return {
    backdropFilter: `blur(${blur}px) saturate(1.6)`,
    maskImage: mask,
    WebkitMaskImage: mask,
  } as unknown as ViewStyle;
};

export const GLASS_PAGE_RAMP: ViewStyle[] = (() => {
  if (Platform.OS !== 'web') return [];
  const s = StyleSheet.create({
    a: rampLayer(3, 66, 100),
    b: rampLayer(6, 46, 84),
    c: rampLayer(12, 24, 58),
    d: rampLayer(22, 7, 34),
  });
  return [s.a, s.b, s.c, s.d];
})();

// How far the glass runs PAST the header's own content, and the reason
// the ramp is possible at all. The header is text almost to its bottom
// edge — the week strip's numbers end about 90% of the way down — so a
// ramp confined to it has a tenth of its height to clear out in, which
// is not a fade, it is a hard stop with a soft top. Worse, it clears
// while the day numbers are still there, and a card's paragraph comes
// through sharp behind them.
//
// Sizing it to the ramp instead: the glass is the header plus this, the
// clearing-out happens entirely below the strip, and the day numbers
// keep a backing the whole way. The layers are absolute, so this changes
// nothing about the height the scrollers take as their inset — at rest
// it covers ground that is empty anyway, and it is the stretch a card
// travels through while it goes soft.
export const GLASS_PAGE_BLEED = 72;

// The fill ramps with it, and has to: a fill that stayed flat while the
// blur faded would leave the bottom of the header a sharp page seen
// through a grey wash, which is worse than either. Three stops rather
// than two because a straight line from opaque to nothing reads as a
// band with soft edges; the midpoint held high keeps the day numbers
// backed while the last stretch clears out.
//
// Native gets no backdrop-filter and no ramp above, so its fill is doing
// the whole job alone and carries more weight at every stop. It still
// clears at the bottom, which is the part that reads as a bleed rather
// than a bar, and is the part it can actually do.
const RAMP_ALPHA = Platform.OS === 'web' ? [0.84, 0.72, 0] : [0.96, 0.86, 0];
export const GLASS_PAGE_LOCATIONS = [0, 0.76, 1] as const;

// expo-linear-gradient takes colour strings, and the theme's ground is a
// 6-digit hex, so the alpha rides on the end of it.
export function glassPageFill(ground: string): [string, string, string] {
  return RAMP_ALPHA.map(
    (a) => ground + Math.round(a * 255).toString(16).padStart(2, '0'),
  ) as [string, string, string];
}
