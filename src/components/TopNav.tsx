import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from './Avatar';
import { GymLogo } from './GymLogo';
import { useMyProfile, useSession } from '@/lib/auth';
import { haptic } from '@/lib/haptic';
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
            className={`flex-row items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full active:opacity-70 ${
              active ? 'bg-white dark:bg-gray-700' : ''
            }`}>
            <Ionicons
              name={s.icon}
              size={17}
              color={active ? brand.primaryColor : colors.iconSecondary}
            />
            <Text
              className={`text-sm font-medium ${
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
            are. On small screens the centre zone hides and the pills
            render as their own full-width row below — overlapping
            icons beat no icons, but a second row beats both. */}
        <View className="flex-1 flex-row items-center">
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(homeHref as never);
            }}
            hitSlop={6}
            className="flex-row items-center gap-3 active:opacity-70">
            <GymLogo
              size={36}
              logoUrl={brand.logoUrl}
              name={gymName}
              primaryColor={brand.primaryColor}
            />
            <Text
              style={{ color: colors.text }}
              className="font-semibold text-base hidden lg:flex"
              numberOfLines={1}>
              {gymName}
            </Text>
          </Pressable>
        </View>

        <View className="hidden md:flex items-center">{pills}</View>

        <View className="flex-row items-center justify-end gap-1.5 md:gap-2 md:flex-1">
        {showCrossLink ? (
          <Pressable
            onPress={() => {
              haptic.selection();
              router.replace(crossHref as never);
            }}
            hitSlop={4}
            accessibilityLabel={crossLabel}
            className={`h-9 px-3 rounded-full border flex-row items-center gap-1.5 active:opacity-70 ${crossClasses}`}>
            <Ionicons name="swap-horizontal-outline" size={16} color={crossTint} />
            <Text className={`text-xs font-semibold hidden md:flex ${crossTextClass}`}>
              {crossLabel}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => {
            haptic.tap();
            router.push(accountHref as never);
          }}
          hitSlop={4}
          accessibilityLabel="Account"
          style={onAccount ? { borderColor: brand.primaryColor } : undefined}
          className={`w-9 h-9 rounded-full items-center justify-center border-2 active:opacity-70 ${
            onAccount ? '' : 'border-transparent'
          }`}>
          <Avatar name={displayName} avatarUrl={profile?.avatar_url} size={30} />
        </Pressable>

        <Pressable
          onPress={() => {
            haptic.tap();
            router.push('/inbox' as never);
          }}
          hitSlop={4}
          accessibilityLabel="Inbox"
          className="w-9 h-9 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 items-center justify-center active:opacity-70">
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={19}
            color={colors.iconPrimary}
          />
        </Pressable>

        <Pressable
          onPress={() => {
            haptic.selection();
            set(scheme === 'dark' ? 'light' : 'dark');
          }}
          hitSlop={4}
          accessibilityLabel="Toggle theme"
          className="w-9 h-9 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 items-center justify-center active:opacity-70">
          <Ionicons
            name={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
            size={19}
            color={colors.iconPrimary}
          />
        </Pressable>
        </View>
      </View>

      <View className="md:hidden items-center">{pills}</View>
    </View>
  );
}
