import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { EmptyState } from '@/components/EmptyState';
import { Text, TextInput } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { MoneyJobCard } from '@/components/MoneyJobCard';
import { Screen } from '@/components/Screen';
import { SoftLine } from '@/components/TimelineLines';
import { useThemeColors } from '@/lib/theme';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { ASK_FAILED, ASK_UNAVAILABLE } from '@/lib/nudge-story';
import {
  firstNameOf,
  PAYMENT_ASK_PLACEHOLDER,
  PAYMENT_QUESTIONS,
  paymentSubLine,
  whatIdDoLines,
  whyLines,
  type AttendanceFacts,
  type OverdueRow,
} from '@/lib/payment-story';
import { supabase } from '@/lib/supabase';
import { formatTimelineLine, type TimelineEvent } from '@/lib/timeline';
import { useGymCurrency } from '@/lib/useGymCurrency';

// The forward-looking twin of the nudge story: that page is the receipt
// behind "I've nudged Emma", this one is the case for acting while the
// payment is still failing — why it came up, what Temple would do today,
// and the exact words ready to go the moment the owner says so.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AskTurn = { role: 'owner' | 'temple'; text: string };

export default function PaymentStory() {
  const colors = useThemeColors();
  const { subscription } = useLocalSearchParams<{ subscription: string }>();
  const subscriptionId = typeof subscription === 'string' ? subscription : '';
  const validId = UUID.test(subscriptionId);
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const currency = useGymCurrency();
  const queryClient = useQueryClient();

  const rows = useQuery({
    queryKey: ['overdue-memberships', gymId],
    enabled: !!gymId && validId,
    queryFn: async (): Promise<OverdueRow[]> => {
      const { data, error } = await supabase.rpc('gym_overdue_memberships', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return (data ?? []) as unknown as OverdueRow[];
    },
  });
  const row = (rows.data ?? []).find((r) => r.subscription_id === subscriptionId);

  const authority = useQuery({
    queryKey: ['agent-authority', gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_authority')
        .select('action_kind, level')
        .eq('gym_id', gymId!);
      if (error) throw error;
      return data ?? [];
    },
  });
  const jobOn = (authority.data ?? []).some(
    (a) => a.action_kind === 'chase_message',
  );

  const preview = useQuery({
    queryKey: ['chase-preview', gymId, subscriptionId],
    enabled: !!gymId && validId,
    queryFn: async (): Promise<{ subject: string; body: string } | null> => {
      const { data, error } = await supabase.rpc('payment_chase_preview', {
        p_gym_id: gymId!,
        p_subscription_id: subscriptionId,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const story = useQuery({
    queryKey: ['payment-chase-story', gymId, subscriptionId],
    enabled: !!gymId && validId,
    queryFn: async (): Promise<{ chased: boolean; actionId: string | null }> => {
      const kase = await supabase
        .from('agent_cases')
        .select('id')
        .eq('gym_id', gymId!)
        .eq('plan_subscription_id', subscriptionId)
        .neq('stage', 'closed')
        .maybeSingle();
      if (kase.error) throw kase.error;
      if (!kase.data) return { chased: false, actionId: null };
      const actions = await supabase
        .from('agent_actions')
        .select('id, status')
        .eq('case_id', kase.data.id)
        .eq('action_kind', 'chase_message')
        .in('status', ['approved', 'executed'])
        .order('decided_at', { ascending: false })
        .limit(1);
      if (actions.error) throw actions.error;
      const action = actions.data?.[0];
      return { chased: !!action, actionId: action?.id ?? null };
    },
  });

  // Attendance is colour, not structure — a failed read here must never
  // take the page down, so any error collapses to null and the story
  // simply says nothing about training.
  const attendance = useQuery({
    queryKey: ['member-attendance-facts', gymId, row?.profile_id],
    enabled: !!gymId && !!row,
    queryFn: async (): Promise<AttendanceFacts | null> => {
      try {
        const [last, next] = await Promise.all([
          supabase
            .from('class_bookings')
            .select('attended_at')
            .eq('gym_id', gymId!)
            .eq('profile_id', row!.profile_id)
            .not('attended_at', 'is', null)
            .order('attended_at', { ascending: false })
            .limit(1),
          supabase
            .from('class_bookings')
            .select('class_sessions!inner(starts_at, class_types(name))')
            .eq('gym_id', gymId!)
            .eq('profile_id', row!.profile_id)
            .gt('class_sessions.starts_at', new Date().toISOString())
            .limit(20),
        ]);
        if (last.error || next.error) return null;
        // Ordering by the embedded resource sorts inside each booking,
        // not across bookings — the soonest is picked here instead.
        const upcoming = ((next.data ?? []) as unknown as {
          class_sessions: {
            starts_at: string;
            class_types: { name: string | null } | null;
          };
        }[])
          .map((b) => b.class_sessions)
          .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))[0] ?? null;
        return {
          lastAttended: last.data?.[0]?.attended_at ?? null,
          nextClass: upcoming
            ? {
                startsAt: upcoming.starts_at,
                name: upcoming.class_types?.name ?? null,
              }
            : null,
        };
      } catch {
        return null;
      }
    },
  });

  const chase = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('request_payment_chase', {
        p_gym_id: gymId!,
        p_subscription_id: subscriptionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Mark the row chased before the refetch lands: with only the
      // invalidation, the button re-arms for a beat and a double-tap
      // spends the second touch on a duplicate email.
      queryClient.setQueryData<Set<string>>(
        ['payment-chases', gymId],
        (old) => new Set([...(old ?? []), subscriptionId]),
      );
      // The outbound queue drains on a 15-minute cron; the owner just
      // asked, so nudge the worker now. Best-effort — quiet hours or a
      // failure here just leave it to the cron.
      void supabase.functions.invoke('send-agent-messages', {
        body: { gym_id: gymId },
      });
      void queryClient.invalidateQueries({ queryKey: ['payment-chases', gymId] });
      void queryClient.invalidateQueries({
        queryKey: ['payment-chase-story', gymId, subscriptionId],
      });
      void queryClient.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    },
  });

  const chased = chase.isSuccess || (story.data?.chased ?? false);

  const [thread, setThread] = useState<AskTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !gymId || !validId) return;
    setInput('');
    setBusy(true);
    setThread((t) => [...t, { role: 'owner', text: q }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const { data, error } = await supabase.functions.invoke('explain-event', {
        body: {
          gym_id: gymId,
          subscription_id: subscriptionId,
          question: q,
          turns: thread.slice(-6),
        },
      });
      // FunctionsHttpError's message is one fixed sentence; the status
      // lives on the response it carries.
      const status = (error as { context?: { status?: number } } | null)
        ?.context?.status;
      // A 404 means the failure settled after this page loaded — recovery
      // deletes the row, so retrying can never succeed. Say so and let
      // the page catch up.
      if (status === 404) {
        setThread((t) => [
          ...t,
          {
            role: 'temple',
            text: 'That payment has come right — nothing is failing here anymore.',
          },
        ]);
        void queryClient.invalidateQueries({
          queryKey: ['overdue-memberships', gymId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['chase-preview', gymId, subscriptionId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['payment-chase-story', gymId, subscriptionId],
        });
        return;
      }
      const answer =
        !error && typeof (data as { answer?: unknown })?.answer === 'string'
          ? ((data as { answer: string }).answer)
          : null;
      setThread((t) => [
        ...t,
        {
          role: 'temple',
          text: answer ?? (status === 503 ? ASK_UNAVAILABLE : ASK_FAILED),
        },
      ]);
    } catch {
      setThread((t) => [...t, { role: 'temple', text: ASK_FAILED }]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const loading = rows.isLoading || !gymId;
  const first = row ? firstNameOf(row.full_name) : '';

  // The headline is the same sentence the Timeline spoke, from the same
  // formatter — two voices for one fact is how registers drift apart.
  const line = row
    ? formatTimelineLine({
        item_id: `dunning:${subscriptionId}`,
        kind: 'payment_failing',
        occurred_at: row.past_due_since,
        subject: row.full_name ?? '',
        detail: { next_payment_attempt: row.next_payment_attempt },
      } satisfies TimelineEvent)
    : null;

  return (
    <Screen edges={['bottom', 'left', 'right']} className="px-0">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink fallbackHref="/timeline" coveredByNav />

          {loading ? (
            <View className="px-4 py-4">
              <EmptyState kind="loading" rows={3} />
            </View>
          ) : rows.error ? (
            // A failed read must never dress up as a recovered payment —
            // the empty state below claims the money came right.
            <View className="py-16 px-6 items-center gap-3">
              <Text className="text-ink dark:text-ink-dk font-semibold text-base">
                Couldn&apos;t load this payment
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
                {errorMessage(rows.error, 'Something went wrong reading it')}
              </Text>
              <ChipButton
                label="Try again"
                icon="refresh-outline"
                tone="neutral"
                onPress={() => rows.refetch()}
              />
            </View>
          ) : !row ? (
            <View className="py-16 px-6 items-center gap-2">
              <Text className="text-ink dark:text-ink-dk font-semibold text-base">
                Nothing here
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm text-center">
                That payment has come right, or the link is stale.
              </Text>
            </View>
          ) : (
            <>
              <View className="gap-1">
                <Text className="text-ink dark:text-ink-dk text-xl font-bold leading-[28px]">
                  {line!.text}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-[13px]">
                  {paymentSubLine(row, currency)}
                </Text>
              </View>

              <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-1.5">
                <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wider">
                  Why this has come up
                </Text>
                {whyLines(row, attendance.data ?? null, new Date()).map((s, i) => (
                  <Text
                    key={i}
                    className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[20px]">
                    {s}
                  </Text>
                ))}
              </View>

              <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-1.5">
                <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wider">
                  What I&apos;d do today
                </Text>
                {whatIdDoLines(
                  row,
                  attendance.data ?? null,
                  jobOn,
                  chased,
                  new Date(),
                ).map((s, i) => (
                  <Text
                    key={i}
                    className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[20px]">
                    {s}
                  </Text>
                ))}
              </View>

              {preview.data ? (
                <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
                  <Text className="text-ink-3 dark:text-ink-3-dk text-[11px] font-bold uppercase tracking-wider">
                    {chased
                      ? `The nudge on its way to ${first}`
                      : `The message ${first} would get`}
                  </Text>
                  <Text className="text-ink dark:text-ink-dk text-[14.5px] font-semibold leading-[20px]">
                    {preview.data.subject}
                  </Text>
                  <View className="bg-raised dark:bg-raised-dk rounded-lg p-3">
                    <Text className="text-ink-2 dark:text-ink-2-dk text-[14px] leading-[21px]">
                      {preview.data.body}
                    </Text>
                  </View>
                  <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
                    {chased
                      ? 'The receipt in the Timeline has the delivery story.'
                      : 'Your template, their details — nothing goes until you say.'}
                  </Text>
                </View>
              ) : null}

              {chase.isSuccess ? (
                <SoftLine
                  text={`Handed over — my nudge to ${first} is on its way. The receipt lands in the Timeline.`}
                  tone="neutral"
                  icon="sparkles-outline"
                />
              ) : story.data?.chased ? (
                <SoftLine
                  text="I'm on it — my nudge is on its way."
                  tone="neutral"
                  icon="sparkles-outline"
                  href={
                    story.data.actionId
                      ? `/timeline/${story.data.actionId}`
                      : undefined
                  }
                />
              ) : jobOn && preview.data && story.isSuccess ? (
                // The button waits for the chase story to load — offering a
                // handover before knowing one already happened is how a
                // member gets the same email twice.
                <View className="gap-2">
                  <Button onPress={() => chase.mutate()} loading={chase.isPending}>
                    Chase for me
                  </Button>
                  {chase.error ? (
                    <Text className="text-red-500 dark:text-red-400 text-sm">
                      {errorMessage(chase.error, "That didn't go through")}
                    </Text>
                  ) : null}
                </View>
              ) : !jobOn ? (
                <MoneyJobCard
                  gymId={gymId}
                  onTakenOn={() => {
                    void queryClient.invalidateQueries({
                      queryKey: ['agent-authority', gymId],
                    });
                    void queryClient.invalidateQueries({
                      queryKey: ['chase-preview', gymId, subscriptionId],
                    });
                  }}
                />
              ) : null}

              <View className="flex-row flex-wrap gap-2 px-1">
                <ChipButton
                  label={`Message ${first}`}
                  icon="chatbubble-outline"
                  tone="neutral"
                  onPress={() =>
                    router.push(`/inbox/direct/${row.profile_id}` as never)
                  }
                />
                <ChipButton
                  label="Open their profile"
                  icon="person-outline"
                  tone="neutral"
                  onPress={() =>
                    router.push(`/management/members/${row.profile_id}` as never)
                  }
                />
              </View>

              {thread.map((t, i) =>
                t.role === 'owner' ? (
                  <View
                    key={i}
                    className="self-end max-w-[85%] bg-primary rounded-2xl rounded-br-md px-4 py-2.5">
                    <Text className="text-on-primary text-[15px] leading-[21px]">
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
                  {PAYMENT_QUESTIONS.map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => ask(q)}
                      disabled={busy}
                      className="px-3.5 py-2 rounded-full border border-line dark:border-line-dk bg-surface dark:bg-surface-dk active:opacity-70">
                      <Text className="text-ink-2 dark:text-ink-2-dk text-[13px] font-semibold">
                        {q}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {row ? (
          <View className="px-4 pb-4 pt-1 md:max-w-2xl md:mx-auto md:w-full">
            <View className="flex-row items-center gap-2 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-full pl-4 pr-1.5 py-1.5">
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!busy}
                placeholder={PAYMENT_ASK_PLACEHOLDER}
                placeholderTextColor={colors.ink3}
                multiline
                className="flex-1 text-ink dark:text-ink-dk text-[15px] max-h-24 py-1.5"
                onSubmitEditing={() => ask(input)}
              />
              <Pressable
                onPress={() => ask(input)}
                disabled={busy || !input.trim()}
                accessibilityLabel="Ask"
                className={`w-9 h-9 rounded-full items-center justify-center ${busy || !input.trim() ? 'bg-sunken dark:bg-raised-dk' : 'bg-primary'}`}>
                <Ionicons name="arrow-up" size={18} color={colors.onPrimary} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
