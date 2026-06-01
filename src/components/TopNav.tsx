import { router, useSegments } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MemberViewLink, StaffViewLinkIfStaff } from './CrossExperienceLink';
import { useGymMembership } from '@/lib/auth';

export type NavSection = { name: string; href: string; label: string };

function LogoMark({ initial }: { initial: string }) {
  return (
    <View className="w-9 h-9 rounded-lg bg-brand items-center justify-center">
      <Text className="text-ink font-bold text-base">{initial}</Text>
    </View>
  );
}

export function TopNav({
  sections,
  variant,
}: {
  sections: NavSection[];
  variant: 'staff' | 'member';
}) {
  const insets = useSafeAreaInsets();
  const segments = useSegments() as readonly string[];
  const { data: membership } = useGymMembership();

  const currentSection = segments[1];
  const gymName = membership?.gymName ?? 'Temple';
  const initial = (gymName.charAt(0) || 'T').toUpperCase();

  return (
    <View
      style={{ paddingTop: insets.top + 10 }}
      className="bg-ink border-b border-bone/10 px-6 pb-3 flex-row items-center gap-4">
      <View className="flex-row items-center gap-3 flex-1">
        <LogoMark initial={initial} />
        <Text className="text-bone font-semibold text-base">{gymName}</Text>
      </View>

      <View className="flex-row gap-7">
        {sections.map((s) => {
          const active = currentSection === s.name;
          return (
            <Pressable
              key={s.name}
              onPress={() => router.replace(s.href as never)}
              hitSlop={8}>
              <Text
                className={
                  active
                    ? 'text-brand font-semibold'
                    : 'text-bone/60 font-medium'
                }>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-1 items-end">
        {variant === 'staff' ? <MemberViewLink /> : <StaffViewLinkIfStaff />}
      </View>
    </View>
  );
}
