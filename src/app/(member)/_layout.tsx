import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';

import { TopNav, type NavSection } from '@/components/TopNav';
import { useSession } from '@/lib/auth';
import { useThemeColors } from '@/lib/theme';

// Bookings intentionally isn't a top-level section — it lives on the
// Book page ("My bookings" card) where members actually look for it.
const MEMBER_SECTIONS: NavSection[] = [
  // Programming exists under both (member) and (staff) at the same
  // '/programming' URL — the group-qualified navigateTo pins this pill to
  // the member view specifically. See NavSection's comment in TopNav.
  {
    name: 'programming',
    href: '/programming',
    navigateTo: '/(member)/programming',
    label: 'Programming',
    icon: 'barbell-outline',
  },
  { name: 'book', href: '/book', label: 'Book', icon: 'calendar-clear-outline' },
  { name: 'track', href: '/track', label: 'Track', icon: 'trending-up-outline' },
];

export default function MemberLayout() {
  const session = useSession();
  const colors = useThemeColors();
  if (session === null) return <Redirect href="/sign-in" />;

  return (
    <View className="flex-1 bg-slate-100 dark:bg-gray-950">
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
        <Tabs.Screen name="bookings" options={{ title: 'Bookings' }} />
        <Tabs.Screen name="track" options={{ title: 'Track' }} />
        <Tabs.Screen name="membership" options={{ title: 'Membership' }} />
        <Tabs.Screen name="store" options={{ title: 'Store' }} />
        <Tabs.Screen name="purchases" options={{ title: 'Purchases' }} />
        <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
        <Tabs.Screen name="consent" options={{ title: 'Consent' }} />
        <Tabs.Screen name="parq" options={{ title: 'Health screening' }} />
        <Tabs.Screen name="injury-check" options={{ title: 'Injuries' }} />
        <Tabs.Screen name="waiver" options={{ title: 'Waiver' }} />
        <Tabs.Screen name="account" options={{ title: 'Account' }} />
      </Tabs>
    </View>
  );
}
