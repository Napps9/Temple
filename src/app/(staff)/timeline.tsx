import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { useDecideChangeRequest } from '@/lib/membership-changes';
import { supabase } from '@/lib/supabase';
import {
  formatClock,
  formatTimelineLine,
  groupTimelineByDay,
  type TimelineEvent,
} from '@/lib/timeline';

// The Timeline, phase 1 (docs/roadmap.md): read-only — the gym's existing
// activity as one stream, newest day at the bottom like a conversation.
// Membership requests are the only question cards, decided through the
// existing stripe-modify-subscription path. Loops start writing here in
// phase 2; the surface doesn't change when they do.

function useTimelineFeed(gymId: string | undefined) {
  return useQuery({
    queryKey: ['timeline-feed', gymId],
    enabled: !!gymId,
    staleTime: 30_000,
    queryFn: async (): Promise<TimelineEvent[]> => {
      const { data, error } = await supabase.rpc('timeline_feed', {
        p_gym_id: gymId!,
        p_limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as TimelineEvent[];
    },
  });
}

export default function Timeline() {
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const feed = useTimelineFeed(gymId);

  const groups = groupTimelineByDay(feed.data ?? []);

  return (
    <Screen className="px-0">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full"
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => feed.refetch()}
          />
        }>
        {feed.isLoading ? (
          <View className="py-16 items-center">
            <ActivityIndicator />
          </View>
        ) : groups.length === 0 ? (
          <View className="py-16 px-6 items-center gap-2">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
              Nothing here yet
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
              As things happen — someone joins, asks about their membership,
              needs looking after — it shows up here.
            </Text>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.key} className="gap-3">
              <Text className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 text-center">
                {g.label}
              </Text>
              {g.events.map((e) =>
                e.kind === 'membership_request' ? (
                  <RequestCard key={e.item_id} event={e} gymId={gymId} />
                ) : (
                  <ReceiptLine key={e.item_id} event={e} />
                ),
              )}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function ReceiptLine({ event }: { event: TimelineEvent }) {
  const line = formatTimelineLine(event);
  return (
    <SoftLine text={line.text} tone={line.tone} at={event.occurred_at} />
  );
}

function SoftLine({
  text,
  tone,
  at,
}: {
  text: string;
  tone: 'neutral' | 'amber';
  at?: string;
}) {
  return (
    <View className="flex-row items-start gap-3 px-1">
      <View
        className={`w-2 h-2 rounded-full mt-[7px] ${
          tone === 'amber' ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      />
      <Text className="flex-1 text-gray-700 dark:text-gray-200 text-[15px] leading-[22px]">
        {text}
      </Text>
      {at ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs mt-[3px]">
          {formatClock(at)}
        </Text>
      ) : null}
    </View>
  );
}

// The stream's only card. One question, one sentence of context behind
// "See the details", exactly two choices with the yes labelled by the
// action — the loop-1 register, applied to the queue that already exists.
function RequestCard({
  event,
  gymId,
}: {
  event: TimelineEvent;
  gymId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);
  const decide = useDecideChangeRequest(gymId);
  const line = formatTimelineLine(event);

  const requestId =
    typeof event.detail.request_id === 'string' ? event.detail.request_id : null;
  const kind = event.detail.request_kind;
  const currentPlan =
    typeof event.detail.current_plan === 'string' ? event.detail.current_plan : null;
  const targetPlan =
    typeof event.detail.target_plan === 'string' ? event.detail.target_plan : null;
  const note =
    typeof event.detail.member_note === 'string' ? event.detail.member_note : null;
  const firstName = event.subject.trim().split(/\s+/)[0] || 'them';

  const yesLabel = kind === 'cancel' ? 'Yes, cancel it' : `Yes, move ${firstName}`;

  const onDecide = (decision: 'approve' | 'reject') => {
    if (!requestId || decide.isPending) return;
    decide.mutate(
      { requestId, decision },
      { onSuccess: () => setDecided(decision) },
    );
  };

  if (decided) {
    return (
      <SoftLine
        tone="neutral"
        text={
          decided === 'approve'
            ? `${firstName}'s membership — sorted, as they asked.`
            : `${firstName}'s request — declined; nothing has changed.`
        }
      />
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold leading-[22px]">
        {line.text}
      </Text>
      {currentPlan ? (
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          {kind === 'cancel'
            ? `They're on ${currentPlan} at the moment.`
            : `From ${currentPlan}${targetPlan ? ` to ${targetPlan}` : ''}.`}
        </Text>
      ) : null}
      {open && note ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <Text className="text-gray-700 dark:text-gray-200 text-sm italic">
            &ldquo;{note}&rdquo;
          </Text>
        </View>
      ) : null}
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button onPress={() => onDecide('approve')} loading={decide.isPending}>
            {yesLabel}
          </Button>
        </View>
        <View className="flex-1">
          <Button
            variant="secondary"
            onPress={() => onDecide('reject')}
            disabled={decide.isPending}>
            No
          </Button>
        </View>
      </View>
      {note && !open ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={6}>
          <Text className="text-link text-sm font-semibold">See the details</Text>
        </Pressable>
      ) : null}
      {decide.isError ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">
          That didn&apos;t go through — try again.
        </Text>
      ) : null}
    </View>
  );
}
