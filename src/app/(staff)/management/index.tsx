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
        {can(role, 'can_see_insights') ? (
          <ManagementCard
            title="Insights"
            description="Intros, expiring members, conversion vs targets."
            href="/management/insights"
          />
        ) : null}
        {can(role, 'can_view_attendance') ? (
          <ManagementCard
            title="Attendance"
            description="Trends from check-ins on class bookings."
            href="/management/attendance"
          />
        ) : null}
        {can(role, 'can_export_members') ? (
          <ManagementCard
            title="Reports"
            description="Export members, memberships, and attendance to CSV."
            href="/management/reports"
          />
        ) : null}
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
        {can(role, 'can_manage_tags') ? (
          <ManagementCard
            title="Members"
            description="View members by cohort, see and edit their tags."
            href="/management/members"
          />
        ) : null}
        {can(role, 'can_manage_tags') ? (
          <ManagementCard
            title="Tag rules"
            description="Auto-tag members based on cohort state."
            href="/management/tags"
          />
        ) : null}
        {can(role, 'can_see_money') ? (
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
      </ScrollView>
    </Screen>
  );
}
