import { router, useSegments } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MemberViewLink, StaffViewLinkIfStaff } from './CrossExperienceLink';
import { useGymMembership } from '@/lib/auth';

export type NavSection = { name: string; href: string; label: string };

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

  return (
    <View
      style={{ paddingTop: insets.top + 12 }}
      className="bg-ink border-b border-bone/10 px-6 pb-4">
      <View className="flex-row items-center mb-4">
        <View className="flex-1">
          {variant === 'member' ? <StaffViewLinkIfStaff /> : null}
        </View>
        <Text className="text-bone font-semibold text-base">
          {membership?.gymName ?? 'Temple'}
        </Text>
        <View className="flex-1 items-end">
          {variant === 'staff' ? <MemberViewLink /> : null}
        </View>
      </View>

      <View className="flex-row justify-center gap-7">
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
    </View>
  );
}
