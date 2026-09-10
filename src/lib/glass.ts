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

