// Shared starter-theme registry — a small set of named palette + type
// presets a gym can apply for a look that isn't just their raw brand
// colour on a blank canvas. Used today by the email campaign builder;
// the site builder (planned, not yet built) is meant to import this
// same registry rather than defining the same themes twice in two
// different shapes, so a gym's site and emails can actually match.
//
// Kept React-free and dependency-light (only `contrastRatio`, matching
// the convention documented in brand-derivation.ts) so it stays
// unit-testable and importable from any consumer.

import { contrastRatio } from './contrast';

export type ThemeId = 'forged' | 'ringside' | 'daybreak' | 'baseline';

export type BrandTheme = {
  id: ThemeId;
  name: string;
  tagline: string;
  palette: {
    background: string; // page / outer background
    surface: string; // card / section background
    text: string; // primary body + heading text
    muted: string; // dividers and borders only — NOT readable as text
    mutedText: string; // secondary text; must clear WCAG AA (4.5:1) on background AND surface
    accent: string; // buttons, links, highlights
    accentText: string; // text colour that sits on top of `accent`
  };
  typography: {
    fontFamily: string;
    headingWeight: number;
    headingTransform: 'none' | 'uppercase';
    headingLetterSpacing: number; // px, can be negative
    // Schedule-block clock format — tight 24h ("06:00") reads tactical
    // for the intense themes, 12h ("6:00am") reads calm/welcoming for
    // the boutique/coaching ones. A deliberate per-theme choice, not
    // the visitor's browser locale.
    timeFormat: '12h' | '24h';
  };
  shape: {
    // A generic enum, not a px value — email and a future website
    // builder want different concrete radii for the same "feel", so
    // each consumer maps this to its own units.
    buttonRadius: 'square' | 'rounded' | 'pill';
  };
};

const SYSTEM_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const forged: BrandTheme = {
  id: 'forged',
  name: 'Forged',
  tagline: 'Strength, CrossFit, Hyrox',
  palette: {
    background: '#0B0B0C',
    surface: '#17171A',
    text: '#F5F5F0',
    muted: '#3A3A3D',
    mutedText: '#A3A3A8',
    accent: '#FF5A1F',
    accentText: '#0B0B0C',
  },
  typography: {
    fontFamily: SYSTEM_FONT_STACK,
    headingWeight: 800,
    headingTransform: 'uppercase',
    headingLetterSpacing: -0.2,
    timeFormat: '24h',
  },
  shape: { buttonRadius: 'square' },
};

const ringside: BrandTheme = {
  id: 'ringside',
  name: 'Ringside',
  tagline: 'Boxing, combat sports',
  palette: {
    background: '#0A0A0A',
    surface: '#1A0E0F',
    text: '#F5F1EF',
    muted: '#4A2A2C',
    mutedText: '#B3A6A4',
    accent: '#E10600',
    accentText: '#FFFFFF',
  },
  typography: {
    fontFamily: SYSTEM_FONT_STACK,
    headingWeight: 700,
    headingTransform: 'uppercase',
    headingLetterSpacing: -0.1,
    timeFormat: '24h',
  },
  shape: { buttonRadius: 'square' },
};

const daybreak: BrandTheme = {
  id: 'daybreak',
  name: 'Daybreak',
  tagline: 'Boutique, yoga, wellness',
  palette: {
    background: '#F6F1E7',
    surface: '#FFFDF8',
    text: '#3A3229',
    muted: '#8A9A5B',
    mutedText: '#6B604E',
    accent: '#A85A3A',
    accentText: '#FFFFFF',
  },
  typography: {
    fontFamily: SYSTEM_FONT_STACK,
    headingWeight: 500,
    headingTransform: 'none',
    headingLetterSpacing: 0,
    timeFormat: '12h',
  },
  shape: { buttonRadius: 'rounded' },
};

const baseline: BrandTheme = {
  id: 'baseline',
  name: 'Baseline',
  tagline: 'General & family fitness',
  palette: {
    background: '#F4F6F8',
    surface: '#FFFFFF',
    text: '#1E293B',
    muted: '#94A3B8',
    mutedText: '#5A6B7E',
    accent: '#0F766E',
    accentText: '#FFFFFF',
  },
  typography: {
    fontFamily: SYSTEM_FONT_STACK,
    headingWeight: 600,
    headingTransform: 'none',
    headingLetterSpacing: 0,
    timeFormat: '12h',
  },
  shape: { buttonRadius: 'pill' },
};

export const BRAND_THEMES: Record<ThemeId, BrandTheme> = {
  forged,
  ringside,
  daybreak,
  baseline,
};

export const BRAND_THEME_LIST: BrandTheme[] = Object.values(BRAND_THEMES);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && value in BRAND_THEMES;
}

// Minimum WCAG contrast a gym's own brand colour must clear against a
// theme's background before it's used as that theme's accent — matches
// the "large text / UI" floor brand-derivation.ts already uses for the
// same kind of judgement call.
const MIN_ACCENT_CONTRAST = 3;

// Substitutes the gym's own saved brand colour for a theme's stock
// accent, so two gyms picking the same theme don't send identically
// coloured emails regardless of their actual brand — composing, not
// overriding, the same principle CLAUDE.md states for the `primary`
// colour token everywhere else in the app. Falls back to the theme's
// own accent when the gym's colour doesn't clear a minimum contrast bar
// against the theme's background: better an on-theme accent than an
// unreadable on-brand one.
export function composeThemeWithBrand(
  theme: BrandTheme,
  brandPrimaryHex: string,
): BrandTheme {
  // Two bars before the gym's colour replaces the stock accent: it must
  // read against the page background (3:1, UI floor), AND at least one
  // of white / theme text must reach 4.5:1 on top of it — the accent is
  // a button fill, and a fill whose best label misses WCAG AA would
  // ship unreadable CTAs on the gym's public site and emails.
  const labelOn = (fill: string): string =>
    contrastRatio(fill, '#FFFFFF') >= contrastRatio(fill, theme.palette.text)
      ? '#FFFFFF'
      : theme.palette.text;
  const usesGymColour =
    contrastRatio(brandPrimaryHex, theme.palette.background) >= MIN_ACCENT_CONTRAST &&
    contrastRatio(brandPrimaryHex, labelOn(brandPrimaryHex)) >= 4.5;
  const accent = usesGymColour ? brandPrimaryHex : theme.palette.accent;
  const accentText = labelOn(accent);
  return { ...theme, palette: { ...theme.palette, accent, accentText } };
}
