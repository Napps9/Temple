import { Redirect, Tabs } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';

import { BottomDock, DOCK_CLEARANCE } from '@/components/BottomDock';
import { MD } from '@/lib/breakpoint';
import { TopBarProvider } from '@/components/PageTopRow';
import { PinnedNotice } from '@/components/PinnedNotice';
import { TopNav, type NavSection } from '@/components/TopNav';
import { useGymMembership, useSession } from '@/lib/auth';
import { useDemoViews } from '@/lib/demo-visit';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

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
  const { width } = useWindowDimensions();
  const { data: membership } = useGymMembership();
  const { isDemo } = useGymBrand();
  // /book and /track are two of the ten screens the marketing site can
  // land a demo visitor on, and route_opens covers staff surfaces only —
  // so without this two of the five tour stops would be invisible (0279).
  useDemoViews(membership?.gymId, isDemo);
  if (session === null) return <Redirect href="/sign-in" />;
  const docked = width < MD;

  return (
    <TopBarProvider>
    <View className="flex-1 bg-ground dark:bg-ground-dk">
      <TopNav sections={MEMBER_SECTIONS} variant="member" />
      {/* The gym's live pinned notice sits under the bar rather than on
          any one page: the whole point is that it finds the member
          wherever they are. It renders nothing when nothing is pinned. */}
      <PinnedNotice />
      {/* backBehavior="history": when a back press bubbles past a tab's
          inner stack, return to the tab the user was actually on. The
          default is firstRoute, which teleported an unhandled back to
          whichever screen happens to be declared first below. */}
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: {
            backgroundColor: colors.screenBg,
            // Room for the floating dock on the widths that show it.
            paddingBottom: docked ? DOCK_CLEARANCE : 0,
          },
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
      <BottomDock sections={MEMBER_SECTIONS} variant="member" />
    </View>
    </TopBarProvider>
  );
}
