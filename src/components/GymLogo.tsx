import { Image, Text, View } from 'react-native';

import { gymInitial, DEFAULT_BRAND } from '@/lib/brand';

// Renders the gym's uploaded logo image when logoUrl is set; falls
// back to a coloured rounded square with the gym's first initial.
// All three pieces (logoUrl / colour / initial) come from the gym row
// so the same component drops cleanly into the top nav, the side
// menu, the brand preview, and the public /join/[slug] page.
export function GymLogo({
  size = 36,
  logoUrl,
  name,
  primaryColor = DEFAULT_BRAND.primaryColor,
}: {
  size?: number;
  logoUrl: string | null;
  name: string;
  primaryColor?: string;
}) {
  const radius = Math.round(size * 0.22);
  if (logoUrl) {
    return (
      <Image
        source={{ uri: logoUrl }}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: primaryColor,
      }}
      className="items-center justify-center">
      <Text
        style={{ fontSize: Math.round(size * 0.42) }}
        className="text-white font-bold">
        {gymInitial(name)}
      </Text>
    </View>
  );
}
