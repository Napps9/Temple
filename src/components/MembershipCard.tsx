import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useGymMembership, useSession } from '@/lib/auth';
import { clearPendingCheckout, hasPendingCheckout } from '@/lib/pending-checkout';
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
  const gymId = membership?.gymId;
  const plans = useGymPlans(gymId);
  const wantPoll = hasPendingCheckout(gymId);
  const subs = useMySubscriptions(gymId, session?.user.id, {
    pollUntilCurrent: wantPoll,
  });

  const current = (subs.data ?? []).find((s) =>
    CURRENT_SUB_STATUSES.has(s.status),
  );

  // Retire the just-checked-out marker once the subscription lands.
  useEffect(() => {
    if (current && gymId) clearPendingCheckout(gymId);
  }, [current, gymId]);

  if (!membership) return null;
  const sellsPlans = (plans.data?.length ?? 0) > 0;
  const pending = !current && wantPoll;
  if (!sellsPlans && !current && !pending) return null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
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
      ) : pending ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          <Text className="text-gray-500 dark:text-gray-400 text-sm flex-1">
            Setting up your membership…
          </Text>
          <View className="rounded-full border px-2.5 py-0.5 bg-amber-500/10 border-amber-500/40">
            <Text className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
              Pending
            </Text>
          </View>
        </View>
      ) : (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          You don't have an active membership yet.
        </Text>
      )}
      {current || pending ? (
        <Link href="/membership" asChild>
          <Pressable className="flex-row items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 py-2.5 active:bg-gray-100 dark:active:bg-gray-800">
            <Text className="text-gray-700 dark:text-gray-200 font-semibold">
              {current ? 'Manage membership' : 'View status'}
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
