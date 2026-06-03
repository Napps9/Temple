import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';

import { TopNav, type NavSection } from '@/components/TopNav';
import { useSession } from '@/lib/auth';
import { useThemeColors } from '@/lib/theme';

const MEMBER_SECTIONS: NavSection[] = [
  { name: 'book', href: '/book', label: 'Book', icon: 'calendar-clear-outline' },
  { name: 'programming', href: '/programming', label: 'Programming', icon: 'barbell-outline' },
  { name: 'workouts', href: '/workouts', label: 'Workouts', icon: 'trophy-outline' },
  { name: 'account', href: '/account', label: 'Account', icon: 'person-circle-outline' },
];

export default function MemberLayout() {
  const session = useSession();
  const colors = useThemeColors();
  if (session === null) return <Redirect href="/sign-in" />;

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <TopNav sections={MEMBER_SECTIONS} variant="member" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: colors.screenBg },
          animation: 'none',
        }}>
        <Tabs.Screen name="book" options={{ title: 'Book' }} />
        <Tabs.Screen name="programming" options={{ title: 'Programming' }} />
        <Tabs.Screen name="workouts" options={{ title: 'Workouts' }} />
        <Tabs.Screen name="account" options={{ title: 'Account' }} />
      </Tabs>
    </View>
  );
}
