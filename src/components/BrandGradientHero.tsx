import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { DAWN } from '@/lib/theme';

// The rich-hero treatment for the "this is a big moment" surfaces
// (talk-to-your-AI, go-live): the dawn gradient, which is the brand's
// one moment of colour, plus two soft decorative circles. The same
// gradient in both schemes on purpose — a moment doesn't dim — and the
// content on it is always ink: every stop carries #14161A above the 3:1
// UI floor (contrast.test.ts holds this), so callers stop choosing a
// text colour per theme. HERO_INK is that content colour.
export const HERO_INK = '#14161A';

export function BrandGradientHero({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View className="rounded-card overflow-hidden" style={style}>
      <LinearGradient
        colors={[...DAWN.dark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -50,
            top: -50,
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: 'rgba(20,22,26,0.08)',
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 50,
            bottom: -60,
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: 'rgba(20,22,26,0.05)',
          }}
        />
        {children}
      </LinearGradient>
    </View>
  );
}
