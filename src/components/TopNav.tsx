import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from './Avatar';
import { GymLogo } from './GymLogo';
import { MemberGetStartedChecklist } from './MemberGetStartedChecklist';
import { useMyProfile, useSession } from '@/lib/auth';
import { haptic } from '@/lib/haptic';
import { useMemberOnboarding } from '@/lib/useMemberOnboarding';
import { useNotificationCount } from '@/lib/notifications';
import { useThemeColors, useThemePreference } from '@/lib/theme';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';

type IoniconName = keyof typeof Ionicons.glyphMap;

export type NavSection = {
  name: string;
  href: string;
  label: string;
  icon: IoniconName;
};

// Persistent top bar — replaced the old NavModal popup. Layout:
//   [logo + gym name] … [section pills, centred] … [view-switch] [avatar] [inbox] [theme]
// Section pills live in a single rounded track (same idiom as the
// calendar's segmented control) with the active section lit in the
// gym's brand colour. Labels collapse to icons below md. The
// day/week/month switcher lives with the calendar itself, not here.
export function TopNav({
  sections,
  variant,
}: {
  sections: NavSection[];
  variant: 'staff' | 'member';
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const brand = useGymBrand();
  const session = useSession();
  const { data: profile } = useMyProfile();
  const { scheme, set } = useThemePreference();
  const colors = useThemeColors();
  const canAccessStaff = useCan('can_access_staff_area') ?? false;
  const notifCount = useNotificationCount();
  const onboarding = useMemberOnboarding();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);

  const gymName = brand.gymName;

  const accountHref = variant === 'staff' ? '/management/account' : '/account';
  const homeHref = variant === 'staff' ? '/classes' : '/book';
  const showCrossLink = variant === 'staff' || canAccessStaff;
  const crossHref = variant === 'staff' ? '/book' : '/classes';
  // States the CURRENT context ("Viewing Staff"), not the destination —
  // the old "Member view" label read as where-you-are to half of users
  // and where-you're-going to the rest.
  const crossLabel = variant === 'staff' ? 'Viewing Staff' : 'Viewing Member';
  const onAccount = pathname === accountHref;
  const displayName = profile?.full_name?.trim() || session?.user.email || '';

  // staff = blue, member = green: the switch doubles as a "which side
  // am I on" indicator, so the tint must change with the variant.
  const crossTint = variant === 'staff' ? '#3B82F6' : '#10B981';
  const crossClasses =
    variant === 'staff'
      ? 'border-blue-500/40 bg-blue-500/10'
      : 'border-emerald-500/40 bg-emerald-500/10';
  const crossTextClass =
    variant === 'staff' ? 'text-blue-500' : 'text-emerald-500';

  const pills = (
    <View className="flex-row bg-slate-200 dark:bg-gray-800 rounded-full p-1">
      {sections.map((s) => {
        const active = pathname.startsWith(s.href);
        return (
          <Pressable
            key={s.name}
            onPress={() => {
              haptic.selection();
              router.replace(s.href as never);
            }}
            hitSlop={4}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            // The label Text is display:none on phones for inactive
            // pills, so the accessible name must not depend on it.
            accessibilityLabel={s.label}
            className={`flex-row items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full active:opacity-70 ${
              active
                ? 'bg-white dark:bg-gray-700 shadow-pill'
                : 'hover:bg-white/50 dark:hover:bg-gray-700/40'
            }`}>
            <Ionicons
              name={s.icon}
              size={17}
              color={active ? brand.primaryColor : colors.iconSecondary}
            />
            {/* Inline with the logo on the phone means space is tight, so
                only the active pill keeps its label there; wide screens
                show them all. */}
            <Text
              className={`text-sm font-medium ${
                active ? 'flex' : 'hidden md:flex'
              } ${
                active
                  ? 'text-gray-900 dark:text-gray-50'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View
      style={{ paddingTop: insets.top + 10 }}
      className="bg-slate-100 dark:bg-gray-950 px-3 md:px-6 pb-3 gap-2">
      <View className="flex-row items-center gap-2 md:gap-3">
        {/* Three equal zones (flex-1 left/right) keep the pills on the
            bar's true centre regardless of how wide the side clusters
            are. The pills sit inline on every size now that the right
            cluster is a single avatar — on the phone the inactive pills
            drop to icons so all three fit next to the logo. */}
        <View className="flex-1 flex-row items-center">
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(homeHref as never);
            }}
            hitSlop={6}
            className="flex-row items-center gap-3 hover:opacity-80 active:opacity-70">
            <GymLogo
              size={36}
              logoUrl={brand.logoUrl}
              name={gymName}
              primaryColor={brand.primaryColor}
            />
            <Text
              className="text-gray-900 dark:text-gray-50 font-semibold text-base hidden lg:flex"
              numberOfLines={1}>
              {gymName}
            </Text>
          </Pressable>
        </View>

        <View className="items-center">{pills}</View>

        <View className="flex-1 flex-row items-center justify-end gap-1.5 md:gap-2">
        {showCrossLink ? (
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(crossHref as never);
            }}
            hitSlop={4}
            accessibilityLabel={crossLabel}
            className={`h-9 px-3 rounded-full border flex-row items-center gap-1.5 hover:opacity-80 active:opacity-70 ${crossClasses}`}>
            <Ionicons name="swap-horizontal-outline" size={16} color={crossTint} />
            <Text className={`text-xs font-semibold hidden md:flex ${crossTextClass}`}>
              {crossLabel}
            </Text>
          </Pressable>
        ) : null}

        {/* Messages + theme fold into the account button — tap the avatar
            to expand them. A dot on the avatar surfaces unread messages
            while the menu is closed. */}
        <Pressable
          onPress={() => {
            haptic.tap();
            setMenuOpen(true);
          }}
          hitSlop={4}
          accessibilityLabel={
            notifCount > 0
              ? `Account, ${notifCount} unread`
              : 'Account and settings'
          }
          style={onAccount ? { borderColor: brand.primaryColor } : undefined}
          className={`w-9 h-9 rounded-full items-center justify-center border-2 hover:opacity-80 active:opacity-70 ${
            onAccount ? '' : 'border-transparent'
          }`}>
          <Avatar name={displayName} avatarUrl={profile?.avatar_url} size={30} />
          {/* Unread messages win the dot; otherwise a brand-tinted dot
              hints the get-started checklist is waiting inside. */}
          {notifCount > 0 ? (
            <View className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-slate-100 dark:border-gray-950" />
          ) : onboarding ? (
            <View
              style={{ backgroundColor: brand.primaryColor }}
              className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-100 dark:border-gray-950"
            />
          ) : null}
        </Pressable>
        </View>
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          className="flex-1"
          onPress={() => setMenuOpen(false)}
          accessibilityLabel="Close menu"
        />
        <View
          style={{
            position: 'absolute',
            top: insets.top + 52,
            right: 12,
            width: Math.min(320, windowWidth - 24),
            maxHeight: windowHeight - insets.top - 80,
          }}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-pop p-2">
          <ScrollView showsVerticalScrollIndicator={false}>
            <View className="px-3 py-2 flex-row items-center gap-3">
              <Avatar name={displayName} avatarUrl={profile?.avatar_url} size={34} />
              <Text
                className="flex-1 text-gray-900 dark:text-gray-50 font-semibold text-base"
                numberOfLines={1}>
                {displayName}
              </Text>
            </View>

            {onboarding ? (
              <View className="pb-1 pt-0.5">
                <MemberGetStartedChecklist
                  onNavigate={() => setMenuOpen(false)}
                />
              </View>
            ) : null}

            <View className="h-px bg-gray-100 dark:bg-gray-800 my-1.5" />

            <MenuRow
              icon="chatbubble-ellipses-outline"
              label="Messages"
              iconColor={colors.iconPrimary}
              badge={notifCount}
              onPress={() => {
                haptic.tap();
                setMenuOpen(false);
                router.push('/inbox' as never);
              }}
            />
            <MenuRow
              icon={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
              label={scheme === 'dark' ? 'Light mode' : 'Dark mode'}
              iconColor={colors.iconPrimary}
              onPress={() => {
                haptic.selection();
                set(scheme === 'dark' ? 'light' : 'dark');
                setMenuOpen(false);
              }}
            />
            <MenuRow
              icon="person-circle-outline"
              label="Account"
              iconColor={colors.iconPrimary}
              onPress={() => {
                haptic.tap();
                setMenuOpen(false);
                router.push(accountHref as never);
              }}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  iconColor,
  badge,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  iconColor: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-800">
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text className="flex-1 text-gray-900 dark:text-gray-50 text-[15px] font-medium">
        {label}
      </Text>
      {badge && badge > 0 ? (
        <View className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 items-center justify-center">
          <Text className="text-white text-[11px] font-bold">
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
