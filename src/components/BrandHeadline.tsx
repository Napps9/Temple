import { Platform } from 'react-native';

import { Text } from './Text';
import { dawnGradient, useThemePreference } from '@/lib/theme';

// The dawn gradient, applied to a headline — the brand's one moment of
// colour now that the accent is ink. Reserved for the logged-out
// screens' headings (and, in table-HTML form, the top rule on Temple's
// emails); inside the app the chrome stays mono so the gradient stays an
// event. Stops come from DAWN in theme.ts, per scheme, because the vivid
// dark-ground stops fall under the 3:1 large-text floor on paper.
//
// Web paints the gradient through the glyphs with background-clip.
// Native has no equivalent short of a mask-view dependency for two
// headlines, so there the same text renders in plain ink — correct,
// just quieter.
export function BrandHeadline({
  className,
  children,
}: {
  className?: string;
  children: string;
}) {
  const { scheme } = useThemePreference();
  if (Platform.OS === 'web') {
    return (
      <Text
        className={className}
        style={
          {
            backgroundImage: dawnGradient(scheme),
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          } as never
        }>
        {children}
      </Text>
    );
  }
  return (
    <Text className={`text-ink dark:text-ink-dk ${className ?? ''}`}>{children}</Text>
  );
}
