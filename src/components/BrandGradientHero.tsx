import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { darkenHex } from '@/lib/colour';

// The rich-hero treatment for the two "this is a big moment" surfaces
// (talk-to-your-AI, go-live): a diagonal gradient off the gym's own
// brand colour plus two soft decorative circles, rather than a flat
// fill. Darkens the same colour for the second stop instead of
// introducing a second hard-coded brand hue.
export function BrandGradientHero({
  color,
  children,
  style,
}: {
  color: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View className="rounded-2xl overflow-hidden" style={style}>
      <LinearGradient
        colors={[color, darkenHex(color, 0.4)]}
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
            backgroundColor: 'rgba(255,255,255,0.10)',
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
            backgroundColor: 'rgba(255,255,255,0.06)',
          }}
        />
        {children}
      </LinearGradient>
    </View>
  );
}
