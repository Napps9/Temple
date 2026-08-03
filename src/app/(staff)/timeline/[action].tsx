import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import {
  decisionLine,
  evidenceLines,
  messageStatusLine,
  outcomeLine,
  recipientName,
  type StoryAction,
  type StoryCase,
  type StoryMessage,
} from '@/lib/nudge-story';
import { supabase } from '@/lib/supabase';
import { formatClock, formatTimelineLine, type TimelineEvent } from '@/lib/timeline';

// One nudge, told in full (0247). The Timeline's line is the claim —
// "I've nudged Emma about their payment" — and this page is the receipt
// behind it: what Temple noticed, who said yes, the exact words that
// went to the member, whether they went, and what came of it. Every row
// read here has carried a can_see_money SELECT policy since 0204/0206,
// so the reads run in the viewer's own session under RLS, the same way
// the feed's cards do.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Story = {
  action: StoryAction & { id: string; subject_profile: string | null };
  messages: StoryMessage[];
  kase: StoryCase | null;
  deciderName: string | null;
};

function useNudgeStory(gymId: string | undefined, actionId: string) {
  return useQuery({
    queryKey: ['nudge-story', gymId, actionId],
    enabled: !!gymId && UUID.test(actionId),
    queryFn: async (): Promise<Story | null> => {
      const { data: action, error } = await supabase
        .from('agent_actions')
        .select(
          'id, action_kind, status, payload, evidence, proposed_at, decided_by, decided_at, subject_profile, case_id',
        )
        .eq('id', actionId)
        .eq('gym_id', gymId!)
        .maybeSingle();
      if (error) throw error;
      if (!action) return null;

      const [msgs, kase, decider] = await Promise.all([
        supabase
          .from('agent_outbound_messages')
          .select('recipient_profile_id, subject, body, status, error, sent_at')
          .eq('action_id', actionId)
          .order('created_at', { ascending: true }),
        action.case_id
          ? supabase
              .from('agent_cases')
              .select('stage, outcome, closed_at')
              .eq('id', action.case_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        action.decided_by
          ? supabase
              .from('profiles')
              .select('full_name')
              .eq('id', action.decided_by)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (msgs.error) throw msgs.error;

      return {
        action: {
          ...action,
          payload: (action.payload ?? {}) as Record<string, unknown>,
        },
        messages: (msgs.data ?? []) as StoryMessage[],
        kase: (kase.data ?? null) as StoryCase | null,
        deciderName:
          (decider.data as { full_name: string | null } | null)?.full_name ?? null,
      };
    },
  });
}

export default function NudgeStory() {
  const { action: actionParam } = useLocalSearchParams<{ action: string }>();
  const actionId = typeof actionParam === 'string' ? actionParam : '';
  const { data: membership } = useGymMembership();
  const session = useSession();
  const story = useNudgeStory(membership?.gymId, actionId);

  return (
    <Screen edges={['bottom', 'left', 'right']} className="px-0">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/timeline" />

        {story.isLoading ? (
          <View className="py-16 items-center">
            <ActivityIndicator />
          </View>
        ) : !story.data ? (
          <View className="py-16 px-6 items-center gap-2">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
              Nothing here
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm text-center">
              This one may belong to another gym, or the link is stale.
            </Text>
          </View>
        ) : (
          <StoryBody
            story={story.data}
            viewerId={session?.user.id}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function StoryBody({
  story,
  viewerId,
}: {
  story: Story;
  viewerId: string | undefined;
}) {
  const { action, messages, kase, deciderName } = story;
  const payload = action.payload as Record<string, unknown>;

  // The headline is the same sentence the Timeline spoke, from the same
  // formatter — two voices for one fact is how registers drift apart.
  const line = formatTimelineLine({
    item_id: `action:${action.id}`,
    kind: 'agent_action',
    occurred_at: action.proposed_at,
    subject: typeof payload.member_name === 'string' ? payload.member_name : '',
    detail: {
      action_kind: action.action_kind,
      status: action.status,
      payload,
      evidence: action.evidence,
    },
  } satisfies TimelineEvent);

  const evidence = evidenceLines(action);
  const decision = decisionLine(
    action,
    deciderName,
    !!action.decided_by && action.decided_by === viewerId,
  );
  const since = outcomeLine(kase);

  return (
    <>
      <View className="gap-1">
        <Text className="text-gray-900 dark:text-gray-50 text-xl font-bold leading-[28px]">
          {line.text}
        </Text>
        <Text className="text-gray-500 dark:text-gray-400 text-[13px]">
          Noticed {formatDate(action.proposed_at)} at{' '}
          {formatClock(action.proposed_at)}
        </Text>
      </View>

      {evidence.length > 0 ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-1.5">
          <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wider">
            Why it came up
          </Text>
          {evidence.map((s, i) => (
            <Text
              key={i}
              className="text-gray-700 dark:text-gray-200 text-[14px] leading-[20px]">
              {s}
            </Text>
          ))}
        </View>
      ) : null}

      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-1.5">
        <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wider">
          The decision
        </Text>
        <Text className="text-gray-700 dark:text-gray-200 text-[14px] leading-[20px]">
          {decision}
        </Text>
      </View>

      {messages.length > 0 ? (
        <View className="gap-3">
          {messages.map((m, i) => {
            const status = messageStatusLine(m);
            return (
              <View
                key={i}
                className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-2">
                <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wider">
                  What {recipientName(m, payload)} got
                </Text>
                <Text className="text-gray-900 dark:text-gray-50 text-[14.5px] font-semibold leading-[20px]">
                  {m.subject}
                </Text>
                <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <Text className="text-gray-700 dark:text-gray-200 text-[14px] leading-[21px]">
                    {m.body}
                  </Text>
                </View>
                <Text
                  className={
                    status.tone === 'amber'
                      ? 'text-amber-700 dark:text-amber-500 text-[13px]'
                      : 'text-gray-500 dark:text-gray-400 text-[13px]'
                  }>
                  {status.text}
                </Text>
              </View>
            );
          })}
          <Text className="text-gray-400 dark:text-gray-500 text-[12.5px] px-1">
            If they reply, it lands in your gym&apos;s email inbox — replies
            don&apos;t come back here.
          </Text>
        </View>
      ) : action.status === 'executed' && action.action_kind === 'cover_ask' ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
          <Text className="text-gray-700 dark:text-gray-200 text-[14px] leading-[20px]">
            This one nudged the coaches through their cover offers — nothing
            was emailed from here.
          </Text>
        </View>
      ) : (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
          <Text className="text-gray-700 dark:text-gray-200 text-[14px] leading-[20px]">
            Nothing has been sent.
          </Text>
        </View>
      )}

      {since ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card gap-1.5">
          <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wider">
            Since then
          </Text>
          <Text className="text-gray-700 dark:text-gray-200 text-[14px] leading-[20px]">
            {since}
          </Text>
        </View>
      ) : null}

      {action.subject_profile ? (
        <View className="flex-row px-1">
          <ChipButton
            label="Open their profile"
            icon="person-outline"
            tone="neutral"
            onPress={() =>
              router.push(
                `/management/members/${action.subject_profile}` as never,
              )
            }
          />
        </View>
      ) : null}
    </>
  );
}
