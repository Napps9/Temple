import { Image } from 'react-native';

import { useThemePreference } from '@/lib/theme';

// Temple wordmark + mark, swapped for the active colour scheme so it
// always reads against the surface behind it. Both sources are static
// requires (Metro bundles both); only the choice is runtime.
const DARK = require('../../assets/images/temple-brand/lockup-on-dark-960px.png');
const LIGHT = require('../../assets/images/temple-brand/lockup-on-light-960px.png');

export function TempleLockup({
  width = 200,
  height = 50,
}: {
  width?: number;
  height?: number;
}) {
  const { scheme } = useThemePreference();
  return (
    <Image
      source={scheme === 'dark' ? DARK : LIGHT}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityLabel="Temple"
    />
  );
}
