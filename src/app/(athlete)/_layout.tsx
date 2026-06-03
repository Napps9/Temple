import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';

import { TopNav, type NavSection } from '@/components/TopNav';
import { useSession } from '@/lib/auth';
import { useThemeColors } from '@/lib/theme';

const ATHLETE_SECTIONS: NavSection[] = [
  { name: 'workouts', href: '/athlete/workouts', label: 'Workouts', icon: 'trophy-outline' },
  { name: 'account', href: '/athlete/account', label: 'Account', icon: 'person-circle-outline' },
];

export default function AthleteLayout() {
  const session = useSession();
  const colors = useThemeColors();
  if (session === null) return <Redirect href="/sign-in" />;

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <TopNav sections={ATHLETE_SECTIONS} variant="member" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: colors.screenBg },
          animation: 'none',
        }}>
        <Tabs.Screen name="workouts" options={{ title: 'Workouts' }} />
        <Tabs.Screen name="account" options={{ title: 'Account' }} />
      </Tabs>
    </View>
  );
}
