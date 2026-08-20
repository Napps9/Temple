import { Redirect, Stack } from 'expo-router';
import { Spinner } from '@/components/EmptyState';
import { View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { useThemeColors } from '@/lib/theme';

// The athlete area is for signed-in users with no active gym
// membership — ex-members keeping their training history, and people
// between gyms. A user who DOES hold a membership is bounced back
// through the root index, which routes them to their real home; gymless
// users are routed here from the root index, so the two never loop.
export default function AthleteLayout() {
  const session = useSession();
  const { data: membership, isLoading } = useGymMembership();
  const colors = useThemeColors();

  if (session === undefined || isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-ground dark:bg-ground-dk">
        <Spinner />
      </View>
    );
  }
  if (session === null) return <Redirect href="/sign-in" />;
  if (membership) return <Redirect href="/" />;

  return (
    <View className="flex-1 bg-ground dark:bg-ground-dk">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.screenBg },
        }}
      />
    </View>
  );
}
