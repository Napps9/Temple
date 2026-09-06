import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { Avatar } from './Avatar';
import { DockMenu, MenuDivider, MenuRow, type DockMenuAnchor } from './DockMenu';
import { Text } from './Text';
import { useGymMembership, useMyProfile, useSession } from '@/lib/auth';
import { haptic } from '@/lib/haptic';
import { useInboxUnreadCount, useNotificationCount } from '@/lib/notifications';
import { useGymStoreConfig } from '@/lib/store';
import { CURRENT_SUB_STATUSES, useGymPlans, useMySubscriptions } from '@/lib/subscriptions';
import { MD } from '@/lib/breakpoint';
import { useThemeColors, useThemePreference } from '@/lib/theme';
import { useCan } from '@/lib/useCan';

// Messages, theme, account, membership and store — the things that are
// neither a section nor the page, folded behind the avatar.
//
// It lives here rather than inside TopNav because there are two navs now
// and they must not drift: a menu that gained an item in the top bar and
// not the sidebar would be a feature that exists only on a phone.
//
// `anchor` is the only thing the callers differ on — see DockMenu.
export function NavAccountMenu({
  variant,
  anchor,
  showLabel,
}: {
  variant: 'staff' | 'member';
  anchor: DockMenuAnchor;
  // The rail has room for the name beside the avatar; the top bar does not.
  showLabel?: boolean;
}) {
  const session = useSession();
  const { data: profile } = useMyProfile();
  const { data: membership } = useGymMembership();
  const { scheme, set } = useThemePreference();
  const colors = useThemeColors();
  const notifCount = useNotificationCount();
  const inboxCount = useInboxUnreadCount();
  const { width: windowWidth } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const canAccessStaff = useCan('can_access_staff_area') ?? false;
  // Below md the bar that carried the "Viewing Staff" switch is gone and
  // the avatar lives in the dock, so the switch lives here instead. Above
  // md the bar still has the button.
  const showSideSwitch =
    windowWidth < MD && (variant === 'staff' || canAccessStaff);
  const switchHref = variant === 'staff' ? '/book' : '/classes';
  const switchLabel =
    variant === 'staff' ? 'Switch to member view' : 'Switch to staff view';

  // Membership + store are member-only concepts — only query them for the
  // member nav so the staff one doesn't pay for unused fetches.
  const storeGymId = variant === 'member' ? membership?.gymId : undefined;
  const storeConfig = useGymStoreConfig(storeGymId);
  const plans = useGymPlans(storeGymId);
  const subs = useMySubscriptions(storeGymId, session?.user.id);
  const hasCurrentSub = (subs.data ?? []).some((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );
  const showMembership =
    variant === 'member' &&
    !!membership &&
    ((plans.data?.length ?? 0) > 0 || hasCurrentSub);
  const showStore =
    variant === 'member' &&
    !!membership &&
    !!session &&
    !!storeConfig.data?.store_enabled;

  const accountHref = variant === 'staff' ? '/management/account' : '/account';
  const displayName = profile?.full_name?.trim() || session?.user.email || '';

  function go(href: string) {
    haptic.tap();
    setOpen(false);
    router.push(href as never);
  }

  return (
    <>
      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen(true);
        }}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={
          notifCount > 0 ? `Account, ${notifCount} unread` : 'Account and settings'
        }
        className={`flex-row items-center gap-2.5 rounded-full hover:opacity-80 active:opacity-70 ${
          showLabel ? 'px-1.5 py-1.5' : ''
        }`}>
        <View className="w-9 h-9 rounded-full items-center justify-center">
          <Avatar name={displayName} avatarUrl={profile?.avatar_url} size={30} />
          {notifCount > 0 ? (
            <View className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-ground dark:border-ground-dk" />
          ) : null}
        </View>
        {showLabel ? (
          <Text
            className="flex-1 text-ink dark:text-ink-dk text-[13.5px] font-semibold"
            numberOfLines={1}>
            {displayName}
          </Text>
        ) : null}
      </Pressable>

      <DockMenu visible={open} onClose={() => setOpen(false)} anchor={anchor}>
        <View className="px-3 py-2 flex-row items-center gap-3">
          <Avatar name={displayName} avatarUrl={profile?.avatar_url} size={34} />
          <Text
            className="flex-1 text-ink dark:text-ink-dk font-semibold text-base"
            numberOfLines={1}>
            {displayName}
          </Text>
        </View>

        <MenuDivider />

        {showSideSwitch ? (
          <MenuRow
            icon="swap-horizontal-outline"
            label={switchLabel}
            iconColor={variant === 'staff' ? '#10B981' : '#3B82F6'}
            onPress={() => {
              haptic.selection();
              setOpen(false);
              router.replace(switchHref as never);
            }}
          />
        ) : null}
        <MenuRow
          icon="chatbubble-ellipses-outline"
          label="Messages"
          iconColor={colors.ink}
          badge={inboxCount}
          onPress={() => go('/inbox')}
        />
        <MenuRow
          icon={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
          label={scheme === 'dark' ? 'Light mode' : 'Dark mode'}
          iconColor={colors.ink}
          onPress={() => {
            haptic.selection();
            set(scheme === 'dark' ? 'light' : 'dark');
            setOpen(false);
          }}
        />
        <MenuRow
          icon="person-circle-outline"
          label="Account"
          iconColor={colors.ink}
          onPress={() => go(accountHref)}
        />
        {showMembership ? (
          <MenuRow
            icon="card-outline"
            label="Membership"
            iconColor={colors.ink}
            onPress={() => go('/membership')}
          />
        ) : null}
        {showStore ? (
          <MenuRow
            icon="bag-handle-outline"
            label="Store"
            iconColor={colors.ink}
            onPress={() => go('/store')}
          />
        ) : null}
      </DockMenu>
    </>
  );
}
