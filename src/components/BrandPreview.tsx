import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { GymLogo } from './GymLogo';
import { contrastRatio } from '@/lib/brand-derivation';

// Live preview the owner sees while editing the brand. Renders a
// miniature version of the chrome a member experiences: the gym
// name in the top header, a primary-coloured CTA, a sample card.
// Used in both the Manage screen's Branding section and create-gym onboarding
// step so the look stays consistent.
export function BrandPreview({
  gymName,
  logoUrl,
  primaryColor,
  secondaryColor,
  textColor,
}: {
  gymName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}) {
  // Mirror Button.tsx: label ink on the primary fill is whichever of
  // white / near-black reads better, so the preview shows what members
  // will actually get.
  const onPrimary =
    contrastRatio(primaryColor, '#FFFFFF') >=
    contrastRatio(primaryColor, '#111827')
      ? '#FFFFFF'
      : '#111827';
  return (
    <View className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <View
        className="flex-row items-center gap-3 p-3"
        style={{ backgroundColor: secondaryColor + '10' }}>
        <GymLogo
          size={36}
          logoUrl={logoUrl}
          name={gymName}
          primaryColor={primaryColor}
        />
        <Text
          className="flex-1 font-semibold text-gray-900 dark:text-gray-50"
          numberOfLines={1}>
          {gymName || 'Your gym name'}
        </Text>
        <Ionicons name="menu-outline" size={20} color={textColor} />
      </View>

      <View className="p-4 gap-3">
        <View
          className="rounded-xl p-3 flex-row items-center gap-3"
          style={{ backgroundColor: primaryColor }}>
          <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center">
            <Ionicons name="calendar" size={18} color={onPrimary} />
          </View>
          <View className="flex-1">
            <Text className="font-semibold text-sm" style={{ color: onPrimary }}>
              Book a class
            </Text>
            <Text className="text-xs" style={{ color: onPrimary, opacity: 0.8 }}>
              Tomorrow · 6:00 CrossFit
            </Text>
          </View>
        </View>

        <View className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 gap-1">
          <Text className="font-semibold" style={{ color: textColor }}>
            Today's WOD
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            21-15-9 thrusters and pull ups.
          </Text>
        </View>

        <View className="flex-row gap-2">
          <View
            className="px-3 py-1.5 rounded-full"
            style={{ backgroundColor: secondaryColor + '20' }}>
            <Text
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: secondaryColor }}>
              Leaderboard
            </Text>
          </View>
          <View className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800">
            <Text className="text-gray-600 dark:text-gray-300 text-xs">
              For time
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
