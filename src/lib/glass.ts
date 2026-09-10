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

// The fill for chrome that spans the page instead of floating on it as a
// pill — the Timeline's day header. It takes the GROUND, not the
// surface, and the difference is the whole point: this header has to be
// invisible when nothing is under it, because the same header on Classes
// and Programming is an ordinary row on the page ground carrying no fill
// at all. Surface at 60% over #F7F7F8 composites to #FCFCFC, which is a
// white band across the top of one screen in a product where the other
// two have none — a slab, and it needed a border to explain where it
// ended.
//
// Ground over ground is nothing to see, so there is nothing to draw a
// line under. Over a card that has scrolled beneath it, the tint and the
// blur are what keep the day legible, and the card stays visible through
// both, which is the thing the border was hiding.
// Sheerer than the pills, and it has to be. A pill floats over cards and
// coloured buttons, so 60% still shows movement. This spans a thread of
// WHITE cards on a near-white ground — #FFFFFF over #F7F7F8 is eight
// levels apart, so the card's body is invisible under any fill and the
// only thing with contrast under here is the text. At 70% just 30% of
// that reached the eye, and the 24px pill blur had already averaged 13px
// type into a flat wash before it got there. The two together erased the
// thing they were meant to reveal: a header with no line and nothing
// moving under it reads as a blank strip, not as glass.
export const GLASS_FILL_PAGE =
  Platform.OS === 'web'
    ? 'bg-ground/50 dark:bg-ground-dk/50'
    : 'bg-ground/88 dark:bg-ground-dk/88';

// The page header's own blur, at a smaller radius than the pills' 24px.
// Radius is what decides whether you see MOVEMENT or a smear: 24px over
// body text leaves one uniform grey, and a uniform grey does not travel
// when the thread scrolls. 16px keeps enough of a line's shape that the
// card visibly moves underneath, which is the whole claim the header is
// making. Registered, not a literal, for the reason at the top of this
// file — an inline object reaches WebKit unprefixed and does nothing.
export const GLASS_PAGE: ViewStyle | undefined =
  Platform.OS === 'web'
    ? StyleSheet.create({
        g: { backdropFilter: 'blur(16px) saturate(1.6)' } as unknown as ViewStyle,
      }).g
    : undefined;
