import { Platform, type ViewStyle } from 'react-native';

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
export const GLASS: ViewStyle | undefined =
  Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(16px) saturate(1.6)' } as unknown as ViewStyle)
    : undefined;

// The fill that goes with it. Opaque enough to read against, sheer enough
// that a card moving underneath is visible rather than implied.
export const GLASS_FILL = 'bg-surface/80 dark:bg-surface-dk/80';
