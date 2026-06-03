import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useRole } from '@/lib/auth';
import { can } from '@/lib/can';

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
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-1">
      <View className="flex-row justify-between items-center">
        <Text className="text-gray-900 dark:text-gray-50 font-semibold">{title}</Text>
        {comingSoon ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Coming soon
          </Text>
        ) : (
          <Text className="text-primary">→</Text>
        )}
      </View>
      <Text className="text-gray-500 dark:text-gray-400">{description}</Text>
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

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <ManagementCard
          title="Account"
          description="Your name, email, and password."
          href="/management/account"
        />
        {can(role, 'can_manage_staff') ? (
          <ManagementCard
            title="Team"
            description="Invite owners, coaches, staff and members."
            href="/management/team"
          />
        ) : null}
        {can(role, 'can_edit_classes') ? (
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
        {can(role, 'can_edit_classes') ? (
          <ManagementCard
            title="Announcements"
            description="Broadcast notices to members."
            href="/management/announcements"
          />
        ) : null}
        {can(role, 'can_see_money') ? (
          <ManagementCard
            title="Billing"
            description="Connect Stripe, manage plans, and track revenue."
            href="/management/billing"
          />
        ) : null}
        <ManagementCard
          title="Settings"
          description="Gym details, branding, and operational preferences."
          comingSoon
        />
      </ScrollView>
    </Screen>
  );
}
