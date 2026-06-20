import { Redirect } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  useChangeRequestQueue,
  useDecideChangeRequest,
  type StaffChangeRequest,
} from '@/lib/membership-changes';
import { useCan } from '@/lib/useCan';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function RequestCard({
  req,
  decide,
}: {
  req: StaffChangeRequest;
  decide: ReturnType<typeof useDecideChangeRequest>;
}) {
  const isCancel = req.kind === 'cancel';
  const acting = decide.isPending && decide.variables?.requestId === req.id;
  const title = isCancel
    ? 'Wants to cancel their membership'
    : `Wants to switch${req.current_plan_name ? ` from ${req.current_plan_name}` : ''}${
        req.target_plan_name ? ` to ${req.target_plan_name}` : ''
      }`;
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-gray-200 dark:border-gray-800">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {req.member_name ?? 'Member'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">{title}</Text>
        </View>
        <View
          className={`rounded-full border px-2.5 py-0.5 ${
            isCancel
              ? 'bg-red-500/10 border-red-500/40'
              : 'bg-amber-500/10 border-amber-500/40'
          }`}>
          <Text
            className={`text-[10px] font-semibold uppercase tracking-widest ${
              isCancel
                ? 'text-red-700 dark:text-red-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}>
            {isCancel ? 'Cancel' : 'Switch'}
          </Text>
        </View>
      </View>

      {req.member_note ? (
        <Text className="text-gray-600 dark:text-gray-300 text-sm italic">
          “{req.member_note}”
        </Text>
      ) : null}

      <Text className="text-gray-400 dark:text-gray-500 text-xs">
        Requested {fmtDate(req.created_at)}
      </Text>

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            icon="checkmark"
            loading={acting && decide.variables?.decision === 'approve'}
            disabled={acting}
            onPress={() =>
              decide.mutate({ requestId: req.id, decision: 'approve' })
            }>
            Approve
          </Button>
        </View>
        <View className="flex-1">
          <Button
            variant="secondary"
            icon="close"
            loading={acting && decide.variables?.decision === 'reject'}
            disabled={acting}
            onPress={() =>
              decide.mutate({ requestId: req.id, decision: 'reject' })
            }>
            Reject
          </Button>
        </View>
      </View>
    </View>
  );
}

export default function MembershipRequestsScreen() {
  const { data: membership } = useGymMembership();
  const canAssignPlan = useCan('can_assign_plan');
  const queue = useChangeRequestQueue(membership?.gymId);
  const decide = useDecideChangeRequest(membership?.gymId);

  if (canAssignPlan === false) return <Redirect href="/management" />;

  const requests = queue.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />

        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Membership requests
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Members ask to switch or cancel here. Approving applies the change
            to their billing straight away; rejecting leaves things as they are.
          </Text>
        </View>

        {queue.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(queue.error, 'Could not load requests')}
          </Text>
        ) : null}
        {decide.error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">
            {errorMessage(decide.error, 'Could not apply the decision')}
          </Text>
        ) : null}

        {queue.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400 text-sm">Loading…</Text>
        ) : requests.length === 0 ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="No pending requests"
            description="When a member asks to change or cancel their plan, it shows up here for approval."
          />
        ) : (
          requests.map((req) => (
            <RequestCard key={req.id} req={req} decide={decide} />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
