// @vitest-environment jsdom
import { StyleSheet } from 'react-native';
import { describe, expect, it } from 'vitest';

import {
  GLASS,
  GLASS_FILL,
  GLASS_PAGE_BLEED,
  GLASS_PAGE_LOCATIONS,
  GLASS_PAGE_RAMP,
  glassPageFill,
} from './glass';

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

  // The ramp is four stacked layers because backdrop-filter is one radius
  // per element and the header needs several. Each blurs more than the
  // last and is masked to a band nearer the top, so the blurs compound
  // upward and fade out rather than ending at a seam.
  it('ramps the page header from heavy blur at the top to none', () => {
    expect(GLASS_PAGE_RAMP).toHaveLength(4);
    const css = webSheet();
    for (const radius of [3, 6, 12, 22]) {
      expect(css).toContain(`blur(${radius}px) saturate(1.6)`);
    }
  });

  // The masks are the ramp. Without them every layer covers the whole
  // header, the radii stop being a gradient and become one very blurred
  // sheet — and a mask that reaches the DOM unprefixed is dropped by
  // WebKit exactly the way backdrop-filter was, silently, leaving Safari
  // that same flat sheet. Registering is what emits both spellings, so
  // read them back rather than trusting the property survived.
  it('emits both mask spellings so the ramp exists on WebKit too', () => {
    const css = webSheet();
    expect(css).toContain('-webkit-mask-image');
    expect(css).toContain('mask-image:linear-gradient(to bottom,');
    // The band nearest the top is the narrowest and the most blurred.
    expect(css).toContain('#000 7%, transparent 34%');
    // The widest reaches the bottom edge, where it is gone entirely.
    expect(css).toContain('#000 66%, transparent 100%');
  });

  // The fill has to ramp with the blur. Flat fill under a fading blur
  // leaves the bottom of the header a sharp page seen through a grey
  // wash, which reads worse than either on its own.
  it('ramps the fill from the ground to nothing, in step with the blur', () => {
    const [top, mid, bottom] = glassPageFill('#F7F7F8');
    expect(top.startsWith('#F7F7F8')).toBe(true);
    const alpha = (c: string) => parseInt(c.slice(7), 16);
    expect(alpha(top)).toBeGreaterThan(alpha(mid));
    expect(alpha(mid)).toBeGreaterThan(alpha(bottom));
    // Nearly clear by the bottom edge: that is what makes it a bleed
    // rather than a bar with a soft edge.
    expect(alpha(bottom)).toBe(0);
    expect(GLASS_PAGE_LOCATIONS).toEqual([0, 0.76, 1]);
  });

  // The overhang is what gives the ramp room to finish below the week
  // strip. Shrink it toward zero and the fade has only the strip's own
  // bottom padding to happen in, which puts the clearing-out across the
  // day numbers — the fault this replaced.
  it('runs the glass past the header so the fade lands below the strip', () => {
    expect(GLASS_PAGE_BLEED).toBeGreaterThanOrEqual(56);
  });
});
