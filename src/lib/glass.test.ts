// @vitest-environment jsdom
import { StyleSheet } from 'react-native';
import { describe, expect, it } from 'vitest';

import { GLASS, GLASS_FILL, GLASS_FILL_PAGE, GLASS_PAGE } from './glass';

// getSheet is react-native-web's, not React Native's, so it is absent from
// the types the app compiles against. It is the only way to read what the
// styles this module registers actually compile to.
const webSheet = () =>
  (StyleSheet as unknown as { getSheet(): { textContent: string } }).getSheet()
    .textContent;

describe('glass', () => {
  // A bare style object reaches the DOM unprefixed, and WebKit had no
  // unprefixed backdrop-filter before Safari 18 — so the dock rendered as
  // a white slab on every older iPhone with nothing to say the blur had
  // been dropped. Registering the style is what makes RNW prefix it.
  it('registers the blur so react-native-web prefixes it for WebKit', () => {
    expect(GLASS).toBeDefined();
    const css = webSheet();
    expect(css).toContain('-webkit-backdrop-filter');
    expect(css).toContain('backdrop-filter:blur(24px) saturate(1.8)');
  });

  it('is sheer enough on web to show the page through it', () => {
    expect(GLASS_FILL).toBe('bg-surface/60 dark:bg-surface-dk/60');
  });

  // The two fills are not interchangeable and swapping them is invisible
  // in a diff. A pill floating on the page takes the surface; chrome that
  // spans the page takes the ground, because it has to disappear into it
  // when nothing has scrolled under. Surface across the top of a screen
  // is a white band, which is what the Timeline's header was, and a band
  // needs a border to say where it ends.
  it('fills page-width chrome with the ground, not the surface', () => {
    expect(GLASS_FILL_PAGE).toContain('bg-ground/');
    expect(GLASS_FILL_PAGE).toContain('dark:bg-ground-dk/');
    expect(GLASS_FILL_PAGE).not.toContain('surface');
  });

  // The page header's blur is registered too, and at a smaller radius. A
  // 24px blur over body text is one flat grey, and a flat grey does not
  // travel when the thread scrolls — so the header read as a blank strip
  // with nothing moving under it, which is the same nothing the white
  // band gave and the reason the band looked like a band.
  it('blurs page-width chrome at a radius that still shows movement', () => {
    expect(GLASS_PAGE).toBeDefined();
    const css = webSheet();
    expect(css).toContain('backdrop-filter:blur(16px) saturate(1.6)');
    // Sheerer than the pills, for the same reason.
    expect(GLASS_FILL_PAGE).toBe('bg-ground/50 dark:bg-ground-dk/50');
  });
});
