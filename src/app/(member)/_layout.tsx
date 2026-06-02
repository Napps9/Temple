import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';

import { TopNav, type NavSection } from '@/components/TopNav';
import { useSession } from '@/lib/auth';

const MEMBER_SECTIONS: NavSection[] = [
  { name: 'book', href: '/book', label: 'Book' },
  { name: 'programming', href: '/programming', label: 'Programming' },
  { name: 'workouts', href: '/workouts', label: 'Workouts' },
  { name: 'account', href: '/account', label: 'Account' },
];

export default function MemberLayout() {
  const session = useSession();
  if (session === null) return <Redirect href="/sign-in" />;

  return (
    <View className="flex-1 bg-gray-50">
      <TopNav sections={MEMBER_SECTIONS} variant="member" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: '#F9FAFB' },
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
