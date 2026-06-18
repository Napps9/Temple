import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import {
  CURRENT_SUB_STATUSES,
  SUB_STATUS_META,
  useGymPlans,
  useMySubscriptions,
} from '@/lib/subscriptions';

// Account-screen entry point to the member's plans/billing. Summarises
// the current plan (or nudges them to get one) and links to the full
// membership page. Renders nothing when there's nothing to manage: a gym
// with no catalogue and no subscription for this member.
export function MembershipCard() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const plans = useGymPlans(membership?.gymId);
  const subs = useMySubscriptions(membership?.gymId, session?.user.id);

  if (!membership) return null;
  const sellsPlans = (plans.data?.length ?? 0) > 0;
  const current = (subs.data ?? []).find((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );
  if (!sellsPlans && !current) return null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <Text className="text-gray-900 dark:text-gray-50 font-semibold">
        Membership
      </Text>
      {current ? (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-gray-700 dark:text-gray-200 flex-1">
            {current.membership_plans?.name ?? 'Plan'}
          </Text>
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            {SUB_STATUS_META[current.status].label}
          </Text>
        </View>
      ) : (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          You don't have an active membership yet.
        </Text>
      )}
      {current ? (
        <Link href="/membership" asChild>
          <Pressable className="flex-row items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 py-2.5 active:bg-gray-100 dark:active:bg-gray-800">
            <Text className="text-gray-700 dark:text-gray-200 font-semibold">
              Manage membership
            </Text>
          </Pressable>
        </Link>
      ) : (
        <Link href="/membership" asChild>
          <Pressable className="flex-row items-center justify-center gap-2 bg-primary rounded-lg py-3 active:bg-primary-dark">
            <Ionicons name="card-outline" size={18} color="#FFFFFF" />
            <Text className="text-white font-semibold">Get a membership</Text>
          </Pressable>
        </Link>
      )}
    </View>
  );
}
