// @vitest-environment jsdom
import { StyleSheet } from 'react-native';
import { describe, expect, it } from 'vitest';

import { GLASS, GLASS_FILL } from './glass';

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
});
