import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { ChipButton } from '@/components/ChipButton';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatDate } from '@/lib/format-date';
import {
  ASK_FAILED,
  ASK_PLACEHOLDER,
  ASK_UNAVAILABLE,
  decisionLine,
  evidenceLines,
  messageStatusLine,
  outcomeLine,
  recipientName,
  suggestedQuestions,
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

// The Q&A thread lives in component state and dies with the screen —
// deliberately not persisted to chat_turns. 0221 keeps that table small
// on purpose, and a restored turn replays into the MAIN Timeline's chat
// on next open, where a sentence about an event the stream isn't
// showing would read as noise from nowhere.
type AskTurn = { role: 'owner' | 'temple'; text: string };

export default function NudgeStory() {
  const { action: actionParam } = useLocalSearchParams<{ action: string }>();
  const actionId = typeof actionParam === 'string' ? actionParam : '';
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const session = useSession();
  const story = useNudgeStory(gymId, actionId);

  const [thread, setThread] = useState<AskTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !gymId || !UUID.test(actionId)) return;
    setInput('');
    setBusy(true);
    setThread((t) => [...t, { role: 'owner', text: q }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const { data, error } = await supabase.functions.invoke('explain-event', {
        body: {
          gym_id: gymId,
          action_id: actionId,
          question: q,
          turns: thread.slice(-6),
        },
      });
      const answer =
        !error && typeof (data as { answer?: unknown })?.answer === 'string'
          ? ((data as { answer: string }).answer)
          : null;
      setThread((t) => [
        ...t,
        {
          role: 'temple',
          // FunctionsHttpError's message is one fixed sentence; the
          // status lives on the response it carries.
          text:
            answer ??
            ((error as { context?: { status?: number } } | null)?.context
              ?.status === 503
              ? ASK_UNAVAILABLE
              : ASK_FAILED),
        },
      ]);
    } catch {
      setThread((t) => [...t, { role: 'temple', text: ASK_FAILED }]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  return (
    <Screen edges={['bottom', 'left', 'right']} className="px-0">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink fallbackHref="/timeline" />

          {story.isLoading ? (
            <View className="py-16 items-center">
              <ActivityIndicator />
            </View>
          ) : !story.data ? (
            <View className="py-16 px-6 items-center gap-2">
              <Text className="text-ink dark:text-ink-dk font-semibold text-base">
                Nothing here
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
                This one may belong to another gym, or the link is stale.
              </Text>
            </View>
          ) : (
            <>
              <StoryBody story={story.data} viewerId={session?.user.id} />

              {thread.map((t, i) =>
                t.role === 'owner' ? (
                  <View
                    key={i}
                    className="self-end max-w-[85%] bg-primary rounded-2xl rounded-br-md px-4 py-2.5">
                    <Text className="text-white text-[15px] leading-[21px]">
                      {t.text}
                    </Text>
                  </View>
                ) : (
                  <Text
                    key={i}
                    className="text-ink-2 dark:text-ink-2-dk text-[15px] leading-[22px] px-1">
                    {t.text}
                  </Text>
                ),
              )}
              {busy ? (
                <View className="py-1 px-1">
                  <ActivityIndicator size="small" />
                </View>
              ) : null}
              {thread.length === 0 ? (
                <View className="flex-row flex-wrap gap-2 px-1">
                  {suggestedQuestions(story.data.action.action_kind).map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => ask(q)}
                      disabled={busy}
                      className="px-3.5 py-2 rounded-full border border-line dark:border-line-dk bg-surface dark:bg-surface-dk active:opacity-70">
                      <Text className="text-gray-700 dark:text-gray-300 text-[13px] font-semibold">
                        {q}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {story.data ? (
          <View className="px-4 pb-4 pt-1 md:max-w-2xl md:mx-auto md:w-full">
            <View className="flex-row items-center gap-2 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-full pl-4 pr-1.5 py-1.5 shadow-card">
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!busy}
                placeholder={ASK_PLACEHOLDER}
                placeholderTextColor="#9CA3AF"
                multiline
                className="flex-1 text-ink dark:text-ink-dk text-[15px] max-h-24 py-1.5"
                onSubmitEditing={() => ask(input)}
              />
              <Pressable
                onPress={() => ask(input)}
                disabled={busy || !input.trim()}
                accessibilityLabel="Ask"
                className={`w-9 h-9 rounded-full items-center justify-center ${busy || !input.trim() ? 'bg-gray-200 dark:bg-gray-800' : 'bg-primary'}`}>
                <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
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
        <Text className="text-ink dark:text-ink-dk text-xl font-bold leading-[28px]">
          {line.text}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-[13px]">
          Noticed {formatDate(action.proposed_at)} at{' '}
          {formatClock(action.proposed_at)}
        </Text>
      </View>

      {evidence.length > 0 ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card gap-1.5">
          <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wider">
            Why it came up
          </Text>
          {evidence.map((s, i) => (
            <Text
              key={i}
              className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[20px]">
              {s}
            </Text>
          ))}
        </View>
      ) : null}

      <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card gap-1.5">
        <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wider">
          The decision
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[20px]">
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
                className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card gap-2">
                <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wider">
                  What {recipientName(m, payload)} got
                </Text>
                <Text className="text-ink dark:text-ink-dk text-[14.5px] font-semibold leading-[20px]">
                  {m.subject}
                </Text>
                <View className="bg-raised dark:bg-raised-dk rounded-lg p-3">
                  <Text className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[21px]">
                    {m.body}
                  </Text>
                </View>
                <Text
                  className={
                    status.tone === 'amber'
                      ? 'text-amber-700 dark:text-amber-500 text-[13px]'
                      : 'text-ink-2 dark:text-ink-2-dk text-[13px]'
                  }>
                  {status.text}
                </Text>
              </View>
            );
          })}
          <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px] px-1">
            If they reply, it lands in your gym&apos;s email inbox — replies
            don&apos;t come back here.
          </Text>
        </View>
      ) : action.status === 'executed' && action.action_kind === 'cover_ask' ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card">
          <Text className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[20px]">
            This one nudged the coaches through their cover offers — nothing
            was emailed from here.
          </Text>
        </View>
      ) : (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card">
          <Text className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[20px]">
            Nothing has been sent.
          </Text>
        </View>
      )}

      {since ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 shadow-card gap-1.5">
          <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wider">
            Since then
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[20px]">
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
