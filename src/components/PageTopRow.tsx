import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useSegments } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { NavAccountMenu } from './NavAccountMenu';
import { Text } from './Text';
import { MD } from '@/lib/breakpoint';
import { haptic } from '@/lib/haptic';
import { useCan } from '@/lib/useCan';

// Below md the top bar is a row holding only the view-switch and the
// avatar, and the page's first row (a date header, on every main
// screen) sat under it renting a second row of the same height. A page
// that renders PageTopRow takes the bar's row over while it is focused:
// TopNav steps aside, and the row carries the bar's cluster at its right
// end, at the same x and y the bar draws it, so the avatar never moves
// between pages. At md+ the bar stays and the row renders its children
// alone, with whatever padding the caller's className gives it.

const TopBarContext = createContext<{
  owned: boolean;
  setOwned: (owned: boolean) => void;
}>({ owned: false, setOwned: () => {} });

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [owned, setOwned] = useState(false);
  return (
    <TopBarContext.Provider value={{ owned, setOwned }}>
      {children}
    </TopBarContext.Provider>
  );
}

export function useTopBarOwned() {
  return useContext(TopBarContext).owned;
}

// The bar's right cluster: which side you are on, and the account menu.
export function TopBarCluster({ variant }: { variant: 'staff' | 'member' }) {
  const canAccessStaff = useCan('can_access_staff_area') ?? false;
  const showCrossLink = variant === 'staff' || canAccessStaff;
  const crossHref = variant === 'staff' ? '/book' : '/classes';
  // States the CURRENT context ("Viewing Staff"), not the destination —
  // the old "Member view" label read as where-you-are to half of users
  // and where-you're-going to the rest.
  const crossLabel = variant === 'staff' ? 'Viewing Staff' : 'Viewing Member';

  // staff = blue, member = green: the switch doubles as a "which side
  // am I on" indicator, so the tint must change with the variant.
  const crossTint = variant === 'staff' ? '#3B82F6' : '#10B981';
  const crossClasses =
    variant === 'staff'
      ? 'border-blue-500/40 bg-blue-500/10'
      : 'border-emerald-500/40 bg-emerald-500/10';
  const crossTextClass =
    variant === 'staff' ? 'text-blue-500' : 'text-emerald-500';

  return (
    <>
      {showCrossLink ? (
        <Pressable
          onPress={() => {
            haptic.selection();
            router.replace(crossHref as never);
          }}
          hitSlop={4}
          accessibilityLabel={crossLabel}
          className={`h-9 w-9 md:w-auto md:px-3 rounded-full border flex-row items-center justify-center gap-1.5 hover:opacity-80 active:opacity-70 ${crossClasses}`}>
          <Ionicons name="swap-horizontal-outline" size={16} color={crossTint} />
          <Text className={`text-xs font-semibold hidden md:flex ${crossTextClass}`}>
            {crossLabel}
          </Text>
        </Pressable>
      ) : null}
      <NavAccountMenu variant={variant} anchor="top-right" />
    </>
  );
}

export function PageTopRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { setOwned } = useContext(TopBarContext);
  const { width } = useWindowDimensions();
  const segments = useSegments();
  const variant = segments[0] === '(staff)' ? 'staff' : 'member';
  const phone = width < MD;

  useFocusEffect(
    useCallback(() => {
      setOwned(true);
      return () => setOwned(false);
    }, [setOwned]),
  );

  return (
    <View
      className={`flex-row items-center ${className ?? ''}`}
      // The bar's own insets, so the cluster lands where the bar drew it.
      style={phone ? { paddingTop: 10, paddingHorizontal: 16 } : undefined}>
      {children}
      {phone ? (
        <View className="flex-row items-center gap-1.5 pl-2">
          <TopBarCluster variant={variant} />
        </View>
      ) : null}
    </View>
  );
}
