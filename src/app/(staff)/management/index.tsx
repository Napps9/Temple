import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole, useSignOut } from '@/lib/auth';

type LinkHref = ComponentProps<typeof Link>['href'];

function ManagementCard({
  title,
  description,
  href,
  comingSoon,
}: {
  title: string;
  description: string;
  href?: LinkHref;
  comingSoon?: boolean;
}) {
  const body = (
    <View className="bg-white rounded-xl p-4 gap-1">
      <View className="flex-row justify-between items-center">
        <Text className="text-gray-900 font-semibold">{title}</Text>
        {comingSoon ? (
          <Text className="text-gray-400 text-xs uppercase tracking-widest">Coming soon</Text>
        ) : (
          <Text className="text-primary">→</Text>
        )}
      </View>
      <Text className="text-gray-500">{description}</Text>
    </View>
  );
  if (href && !comingSoon) {
    return (
      <Link href={href} asChild>
        <Pressable>{body}</Pressable>
      </Link>
    );
  }
  return body;
}

export default function ManagementHome() {
  const role = useRole();
  const { data: membership } = useGymMembership();
  const signOut = useSignOut();

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6">
        <View className="gap-1">
          <Text className="text-gray-500 text-sm uppercase tracking-widest">{role}</Text>
          <Text className="text-gray-900 text-3xl font-semibold">
            {membership?.gymName ?? 'Temple'}
          </Text>
        </View>

        {role === 'owner' ? (
          <ManagementCard
            title="Team"
            description="Invite owners, coaches, staff and members."
            href="/management/team"
          />
        ) : null}
        {role === 'owner' || role === 'coach' ? (
          <ManagementCard
            title="Class types"
            description="Name and colour the kinds of class you run."
            href="/management/class-types"
          />
        ) : null}
        <ManagementCard
          title="Members"
          description="View and manage everyone signed up to your gym."
          comingSoon
        />
        {role === 'owner' ? (
          <ManagementCard
            title="Billing"
            description="Memberships, payment plans, and revenue."
            comingSoon
          />
        ) : null}
        <ManagementCard
          title="Settings"
          description="Gym details, branding, and operational preferences."
          comingSoon
        />

        <View className="mt-6">
          <Button variant="ghost" onPress={() => signOut.mutate()}>
            Sign out
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}
