import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

const KEY = 'app_theme';

// Temple's accent is ink. The primary action on a page is the filled
// thing, not the coloured thing — an ink button on a light ground, a
// paper button on a dark one, the same inversion the mark itself uses.
// This token used to be the gym's saved colour, then a burnt orange;
// both are gone, and every `bg-primary` call site keeps working
// unchanged because the source is still this one constant.
//
// `primaryDark` is the pressed/hover step, not the dark-scheme partner:
// ink presses lighter and paper presses darker, because each is already
// at its end of the ramp.
export const ACCENT = {
  light: { primary: '#14161A', primaryDark: '#2A2E33', ink: '#14161A', onPrimary: '#FFFFFF' },
  dark: { primary: '#F4F5F6', primaryDark: '#D9DBDE', ink: '#F4F5F6', onPrimary: '#14161A' },
} as const;

// The one moment of colour the brand keeps: a dawn gradient, reserved
// for brand moments — the headline on the logged-out screens and the
// top rule on Temple's emails. Never a button, an icon tint, or a
// repeated row element; the accent above stays ink so the gradient
// stays an event. Two stop sets because the vivid stops that sing on
// #0A0B0D fall under the 3:1 large-text floor on #F7F7F8 — the light
// set is the same dawn, deepened until every stop clears it
// (contrast.test.ts holds the floor).
// The brand's flat colour — the dawn's leading stop, worn by the logo
// star, the favicon, and the platform's selected states in both schemes.
export const BRAND = '#E04898';

export const DAWN = {
  light: ['#E04898', '#EA5D7C', '#D37254'],
  dark: ['#E04898', '#EE5E7E', '#F08260'],
} as const;

export function dawnGradient(scheme: Scheme): string {
  const [a, b, c] = DAWN[scheme];
  return `linear-gradient(100deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
}

export type Scheme = 'light' | 'dark';

// Light is the platform default. nativewind's useColorScheme would
// otherwise fall back to the OS preference, which surprises new
// signups whose device is on dark — Temple's first impression is
// always the lighter palette unless the user has explicitly chosen
// dark from the in-app toggle.
export function useThemePreference() {
  const { colorScheme, setColorScheme } = useColorScheme();

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(KEY).then((v) => {
      if (!mounted) return;
      if (v === 'light' || v === 'dark') setColorScheme(v);
      else setColorScheme('light');
    });
    return () => {
      mounted = false;
    };
  }, [setColorScheme]);

  function set(next: Scheme) {
    setColorScheme(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }

  return { scheme: (colorScheme ?? 'light') as Scheme, set };
}

export function useThemeColors() {
  const { scheme } = useThemePreference();
  const dark = scheme === 'dark';
  const accent = dark ? ACCENT.dark : ACCENT.light;
  return {
    // The ground the whole app sits on. Cool and near-white rather than
    // slate, so a white card reads as a card rather than as more page.
    // Drives the native scene backgrounds and the web theme-color meta,
    // and is the runtime twin of the `ground` Tailwind token.
    screenBg: dark ? '#0A0B0D' : '#F7F7F8',
    statusBar: dark ? ('light' as const) : ('dark' as const),
    // Temple's action fill — ink on light, paper on dark. Drives solid
    // fills and active-state emphasis: the one action per page, never a
    // repeated row action.
    primary: accent.primary,
    // The label on an accent fill (`text-on-primary` / colors.onPrimary).
    onPrimary: accent.onPrimary,
    // Links and CTA copy (`text-link`). Ink, not the accent: every
    // `text-link` in the product already carries font-medium or
    // font-semibold, so weight marks it as tappable and the colour was
    // redundant. Accent-coloured links put a second accent beside the
    // page's one action — on create-gym, "Have an account? Sign in" sat
    // directly under an accent-filled Create gym.
    text: accent.ink,
    // Accent chips and tints (`text-secondary`).
    secondary: accent.ink,
    white: '#FFFFFF',

    // The neutral ramp, for the places a colour has to be a runtime value
    // rather than a class: Ionicon tints, SVG fills, shadow colours. Same
    // values as the `ground` / `surface` / `ink` Tailwind tokens, so a
    // component can mix classes and props without drifting.
    //
    // These replaced a parallel set named for icons — iconPrimary,
    // iconSecondary, iconTertiary, iconInverse — which held their own
    // greys off the ramp and, in iconSecondary's case, the same grey in
    // both schemes. Two names for one value is how a system drifts, so
    // there is one now: an icon takes `ink`, `ink2` or `ink3` like
    // everything else, and the label on an ink-filled chip takes
    // `surface`.
    surface: dark ? '#131519' : '#FFFFFF',
    raised: dark ? '#1B1E23' : '#F1F1F4',
    sunken: dark ? '#23272D' : '#E9E9EE',
    line: dark ? '#26282D' : '#E9E9EE',
    lineStrong: dark ? '#34373D' : '#DCDCE3',
    ink: dark ? '#F4F5F6' : '#14161A',
    ink2: dark ? '#9AA0A9' : '#5B606A',
    ink3: dark ? '#6C727B' : '#8B909A',
  };
}
