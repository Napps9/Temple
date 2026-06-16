import { Image } from 'react-native';

import { useThemePreference } from '@/lib/theme';

// Temple mark (the three stacked cards), centred for standalone use and
// swapped for the active scheme so the front card stays legible against
// the surface behind it. Companion to TempleLockup — same require-both
// pattern, both bundled by Metro and only the choice is runtime.
const DARK = require('../../assets/images/temple-brand/mark-colour-on-dark-centred-256px.png');
const LIGHT = require('../../assets/images/temple-brand/mark-colour-on-light-centred-256px.png');

export function TempleMark({ size = 44 }: { size?: number }) {
  const { scheme } = useThemePreference();
  return (
    <Image
      source={scheme === 'dark' ? DARK : LIGHT}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="Temple"
    />
  );
}
