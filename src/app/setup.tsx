import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership, useMyProfile, useRole, useSession } from '@/lib/auth';
import {
  applyPlans,
  applyRules,
  applyTimetable,
} from '@/lib/setup-apply';
import {
  fieldLabel,
  formatDays,
  formatPrice,
  mergeRuleAnswers,
  RULE_FIELD_OPTIONS,
  RULE_QUESTIONS,
  ruleSheet,
  sanitisePlans,
  sanitiseTimetable,
  timetableSummary,
  type PlansProposal,
  type RuleChoices,
  type RuleField,
  type TimetableProposal,
} from '@/lib/setup-flow';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

// Day-one setup as a conversation. The script is fixed — timetable →
// prices → rules → go live — and the model only parses the owner's
// description into a proposal; nothing is written until they confirm,
// and every write then runs through the owner's own session on the same
// paths as the manual editors. /onboarding stays as the checklist escape
// hatch throughout.

type Step = 'timetable' | 'plans' | 'rules' | 'golive';

type Msg =
  | { kind: 'temple'; text: string }
  | { kind: 'mine'; text: string }
  | { kind: 'receipt'; text: string }
  | { kind: 'timetable-card'; proposal: TimetableProposal; open: boolean }
  | { kind: 'plans-card'; proposal: PlansProposal; open: boolean }
  | { kind: 'rule-question'; q: number; open: boolean }
  | { kind: 'rules-gate'; open: boolean }
  | { kind: 'rules-summary'; choices: RuleChoices; open: boolean };

const ASK: Record<Exclude<Step, 'golive'>, string> = {
  timetable:
    'First, your week: what classes do you run, when, and how many people fit? Say it like you would to a friend — "CrossFit at 6, 7 and 9:30 weekday mornings, 6pm evenings, 9am Saturday, cap of 16."',
  plans:
    'Prices next: what does membership cost? For example — "Unlimited is £89 with 30 days notice. An 8-class pack is £59."',
  rules:
    'A few quick rules — tap what fits. The first answer is what most gyms like yours do, and you can change any of it later just by telling me.',
};

export default function SetupScreen() {
  const session = useSession();
  const { data: membership } = useGymMembership();
  const role = useRole();
  const { data: profile } = useMyProfile();
  const brand = useGymBrand();
  const colors = useThemeColors();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [step, setStep] = useState<Step | null>(null);
  const [input, setInput] = useState('');
  const [seeded, setSeeded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Captured at confirm time so the rules step can set gym defaults to
  // what the owner actually runs, not a guess.
  const confirmedDefaults = useRef({ capacity: 16, minutes: 60 });
  const ruleAnswers = useRef<Partial<RuleChoices>>({});

  const progress = useQuery({
    queryKey: ['gym-setup-progress', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_gym_setup_progress', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
      return (data ?? []) as { step_key: string; done: boolean }[];
    },
  });

  const doneKeys = new Set(
    (progress.data ?? []).filter((r) => r.done).map((r) => r.step_key),
  );

  function stepsRemaining(from: Step | null): Step[] {
    const all: Step[] = ['timetable', 'plans', 'rules', 'golive'];
    const start = from ? all.indexOf(from) + 1 : 0;
    return all.slice(start).filter((s) => {
      if (s === 'timetable') return !doneKeys.has('class_type_and_schedule');
      if (s === 'plans') return !doneKeys.has('plan');
      if (s === 'rules') return !doneKeys.has('settings');
      return true;
    });
  }

  function pushMsgs(...msgs: Msg[]) {
    setMessages((m) => [...m, ...msgs]);
  }

  function closeCards(m: Msg[]): Msg[] {
    return m.map((x) => ('open' in x ? { ...x, open: false } : x));
  }

  function advance(from: Step | null) {
    const next = stepsRemaining(from)[0] ?? 'golive';
    setStep(next);
    if (next === 'golive') {
      pushMsgs({ kind: 'temple', text: 'That’s the big pieces. A couple of things need a real button:' });
    } else if (next === 'rules') {
      ruleAnswers.current = {};
      pushMsgs({ kind: 'temple', text: ASK.rules }, { kind: 'rule-question', q: 0, open: true });
    } else {
      pushMsgs({ kind: 'temple', text: ASK[next] });
    }
  }

  useEffect(() => {
    if (seeded || !progress.data || !membership) return;
    setSeeded(true);
    const first = profile?.full_name?.trim().split(/\s+/)[0];
    pushMsgs({
      kind: 'temple',
      text: `Welcome${first ? `, ${first}` : ''}. Let’s get ${brand.gymName} running — it takes about 15 minutes, and you can change anything later just by telling me.`,
    });
    advance(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.data, seeded, membership]);

  const parse = useMutation({
    mutationFn: async (text: string) => {
      const { data, error } = await supabase.functions.invoke('parse-setup', {
        body: { gym_id: membership!.gymId, step, text },
      });
      if (error) throw error;
      return data as { proposal?: unknown };
    },
  });

  const applying = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
    },
  });

  async function submitText() {
    const text = input.trim();
    if (!text || !step || step === 'rules' || step === 'golive') return;
    setInput('');
    setMessages((m) => [...closeCards(m), { kind: 'mine', text }]);
    try {
      const res = await parse.mutateAsync(text);
      const proposal =
        step === 'timetable'
          ? sanitiseTimetable(res.proposal)
          : sanitisePlans(res.proposal);
      if (!proposal) {
        pushMsgs({
          kind: 'temple',
          text: 'I couldn’t quite follow that — try again with days, times and prices spelled out, or use the checklist below.',
        });
        return;
      }
      if (step === 'timetable') {
        const p = proposal as TimetableProposal;
        pushMsgs(
          { kind: 'temple', text: `Here’s your week — ${timetableSummary(p)}` },
          { kind: 'timetable-card', proposal: p, open: true },
        );
      } else {
        const p = proposal as PlansProposal;
        pushMsgs(
          { kind: 'temple', text: `${p.plans.length} plan${p.plans.length === 1 ? '' : 's'}, ready to sell:` },
          { kind: 'plans-card', proposal: p, open: true },
        );
      }
    } catch {
      pushMsgs({
        kind: 'temple',
        text: 'I can’t parse right now — the checklist below does the same job with forms.',
      });
    }
  }

  function confirmTimetable(p: TimetableProposal) {
    const caps = p.schedules.map((s) => s.capacity);
    const durs = p.schedules.map((s) => s.duration_minutes);
    confirmedDefaults.current = {
      capacity: caps.sort((a, b) => caps.filter((x) => x === a).length - caps.filter((x) => x === b).length).pop() ?? 16,
      minutes: durs.sort((a, b) => durs.filter((x) => x === a).length - durs.filter((x) => x === b).length).pop() ?? 60,
    };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    applying.mutate(
      () => applyTimetable(supabase, membership!.gymId, tz, p),
      {
        onSuccess: () => {
          setMessages((m) => closeCards(m));
          pushMsgs({ kind: 'receipt', text: 'Timetable set — members can book as soon as you’re live.' });
          advance('timetable');
        },
        onError: () => pushMsgs({ kind: 'temple', text: 'That didn’t save — try again, or use the checklist below.' }),
      },
    );
  }

  function confirmPlans(p: PlansProposal) {
    applying.mutate(
      () => applyPlans(supabase, membership!.gymId, p),
      {
        onSuccess: () => {
          setMessages((m) => closeCards(m));
          pushMsgs({ kind: 'receipt', text: 'Plans created. Connecting payments (coming up) makes them buyable.' });
          advance('plans');
        },
        onError: () => pushMsgs({ kind: 'temple', text: 'That didn’t save — try again, or use the checklist below.' }),
      },
    );
  }

  function answerRule(q: number, optionIndex: number) {
    const question = RULE_QUESTIONS[q];
    const option = question.options[optionIndex];
    (ruleAnswers.current as Record<string, unknown>)[question.id] = option.value;
    setMessages((m) => closeCards(m));
    pushMsgs({ kind: 'mine', text: option.label });
    if (q + 1 < RULE_QUESTIONS.length) {
      pushMsgs({ kind: 'rule-question', q: q + 1, open: true });
    } else {
      pushMsgs(
        {
          kind: 'temple',
          text: 'That’s the big five done. Everything else is set the way most gyms run it.',
        },
        { kind: 'rules-gate', open: true },
      );
    }
  }

  function carryOn() {
    setMessages((m) => [...closeCards(m), { kind: 'mine', text: 'Carry on' }]);
    confirmRules(mergeRuleAnswers(ruleAnswers.current));
  }

  function haveALook() {
    setMessages((m) => [...closeCards(m), { kind: 'mine', text: 'Have a look' }]);
    pushMsgs({
      kind: 'rules-summary',
      choices: mergeRuleAnswers(ruleAnswers.current),
      open: true,
    });
  }

  function editRule(field: RuleField, value: RuleChoices[RuleField]) {
    (ruleAnswers.current as Record<string, unknown>)[field] = value;
    setMessages((m) =>
      m.map((x) =>
        x.kind === 'rules-summary'
          ? { ...x, choices: mergeRuleAnswers(ruleAnswers.current) }
          : x,
      ),
    );
  }

  function confirmRules(choices: RuleChoices) {
    applying.mutate(
      () => applyRules(supabase, membership!.gymId, confirmedDefaults.current, choices),
      {
        onSuccess: () => {
          setMessages((m) => closeCards(m));
          pushMsgs({ kind: 'receipt', text: 'Rules set. Change any of them later by telling me.' });
          advance('rules');
        },
        onError: () => pushMsgs({ kind: 'temple', text: 'That didn’t save — try again, or use the checklist below.' }),
      },
    );
  }

  function rewordCard() {
    setMessages((m) => closeCards(m));
    pushMsgs({ kind: 'temple', text: 'Tell me what’s different and I’ll redo the whole thing.' });
  }

  const dismiss = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('dismiss_gym_onboarding', {
        p_gym_id: membership!.gymId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gym-onboarding-dismissed'] });
      router.replace('/classes');
    },
  });

  if (!session) return <Redirect href="/" />;
  if (membership && role && role !== 'owner') return <Redirect href="/classes" />;
  if (!membership || progress.isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  const allRequiredDone = ['logo', 'settings', 'class_type_and_schedule', 'parq', 'stripe', 'plan'].every(
    (k) => doneKeys.has(k),
  );
  const busy = parse.isPending || applying.isPending;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <View className="flex-row items-center justify-between px-4 pt-2 pb-1 md:max-w-2xl md:mx-auto md:w-full">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
            Setting up {brand.gymName}
          </Text>
          <Pressable onPress={() => router.replace('/onboarding')} hitSlop={6}>
            <Text className="text-link text-sm font-medium">Prefer the checklist?</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          className="flex-1"
          contentContainerClassName="gap-4 py-4 px-4 md:max-w-2xl md:mx-auto md:w-full">
          {messages.map((m, i) => (
            <MessageRow
              key={i}
              msg={m}
              busy={busy}
              onConfirmTimetable={confirmTimetable}
              onConfirmPlans={confirmPlans}
              onConfirmRules={confirmRules}
              onAnswerRule={answerRule}
              onEditRule={editRule}
              onCarryOn={carryOn}
              onHaveALook={haveALook}
              onReword={rewordCard}
            />
          ))}

          {step === 'golive' ? (
            <GoLive
              doneKeys={doneKeys}
              allDone={allRequiredDone}
              finishing={dismiss.isPending}
              onFinish={() =>
                allRequiredDone ? router.replace('/classes') : dismiss.mutate()
              }
            />
          ) : null}

          {busy ? (
            <View className="flex-row items-center gap-2 pl-9">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-gray-500 dark:text-gray-400 text-sm">Working on it…</Text>
            </View>
          ) : null}
        </ScrollView>

        {step !== 'golive' && step !== 'rules' ? (
          <View className="px-4 pb-4 pt-1 md:max-w-2xl md:mx-auto md:w-full">
            <View className="flex-row items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full pl-4 pr-1.5 py-1.5 shadow-card">
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!busy}
                placeholder="Type it like you'd say it…"
                placeholderTextColor="#9CA3AF"
                multiline
                className="flex-1 text-gray-900 dark:text-gray-50 text-[15px] max-h-24 py-1.5"
                onSubmitEditing={submitText}
              />
              <Pressable
                onPress={submitText}
                disabled={busy || !input.trim()}
                accessibilityLabel="Send"
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

function TempleAvatar() {
  return (
    <View className="w-7 h-7 rounded-full bg-primary items-center justify-center mt-0.5">
      <Ionicons name="sparkles" size={13} color="#FFFFFF" />
    </View>
  );
}

function MessageRow({
  msg,
  busy,
  onConfirmTimetable,
  onConfirmPlans,
  onConfirmRules,
  onAnswerRule,
  onEditRule,
  onCarryOn,
  onHaveALook,
  onReword,
}: {
  msg: Msg;
  busy: boolean;
  onConfirmTimetable: (p: TimetableProposal) => void;
  onConfirmPlans: (p: PlansProposal) => void;
  onConfirmRules: (choices: RuleChoices) => void;
  onAnswerRule: (q: number, optionIndex: number) => void;
  onEditRule: (field: RuleField, value: RuleChoices[RuleField]) => void;
  onCarryOn: () => void;
  onHaveALook: () => void;
  onReword: () => void;
}) {
  if (msg.kind === 'mine') {
    return (
      <View className="self-end max-w-[82%] bg-primary rounded-2xl rounded-br-md px-4 py-2.5">
        <Text className="text-white text-[15px] leading-5">{msg.text}</Text>
      </View>
    );
  }
  if (msg.kind === 'temple') {
    return (
      <View className="flex-row gap-2.5 pr-7">
        <TempleAvatar />
        <Text className="flex-1 text-gray-900 dark:text-gray-50 text-[15px] leading-6">
          {msg.text}
        </Text>
      </View>
    );
  }
  if (msg.kind === 'receipt') {
    return (
      <View className="flex-row items-center gap-2 pl-9">
        <Ionicons name="checkmark-circle-outline" size={16} color="#10B981" />
        <Text className="flex-1 text-gray-500 dark:text-gray-400 text-[13px]">{msg.text}</Text>
      </View>
    );
  }

  const card = (children: React.ReactNode, confirmLabel: string, onConfirm: () => void) => (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-3">
      {children}
      {msg.open ? (
        <View className="flex-row gap-2.5">
          <View className="flex-1">
            <Button onPress={onConfirm} loading={busy}>{confirmLabel}</Button>
          </View>
          <View className="flex-1">
            <Button variant="secondary" onPress={onReword} disabled={busy}>
              Not quite
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );

  if (msg.kind === 'timetable-card') {
    return card(
      <View className="gap-2">
        {msg.proposal.schedules.map((s, i) => (
          <View key={i} className="flex-row items-baseline gap-2">
            <Text className="text-gray-900 dark:text-gray-50 text-sm font-semibold">
              {s.class_type}
            </Text>
            <Text className="flex-1 text-gray-500 dark:text-gray-400 text-[13px]">
              {formatDays(s.days)} · {s.times.join(', ')} · cap {s.capacity}
            </Text>
          </View>
        ))}
      </View>,
      'Yes, set it up',
      () => onConfirmTimetable(msg.proposal),
    );
  }
  if (msg.kind === 'plans-card') {
    return card(
      <View>
        {msg.proposal.plans.map((p, i) => (
          <View
            key={i}
            className={`flex-row items-baseline gap-2 py-2 ${i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}`}>
            <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold">{p.name}</Text>
            <Text className="flex-1 text-gray-500 dark:text-gray-400 text-[12.5px]">
              {p.blurb}
              {p.notice_period_days ? `${p.blurb ? ' · ' : ''}${p.notice_period_days} days notice` : ''}
            </Text>
            <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold">
              {formatPrice(p.monthly_price_cents)}
            </Text>
          </View>
        ))}
      </View>,
      'Yes, create them',
      () => onConfirmPlans(msg.proposal),
    );
  }
  if (msg.kind === 'rules-gate') {
    if (!msg.open) return null;
    return (
      <View className="flex-row gap-2.5 pl-9">
        <View className="flex-1">
          <Button onPress={onCarryOn} loading={busy}>Carry on</Button>
        </View>
        <View className="flex-1">
          <Button variant="secondary" onPress={onHaveALook} disabled={busy}>
            Have a look
          </Button>
        </View>
      </View>
    );
  }
  if (msg.kind === 'rule-question') {
    const q = RULE_QUESTIONS[msg.q];
    return (
      <View className="gap-2.5">
        <View className="flex-row gap-2.5 pr-7">
          <TempleAvatar />
          <Text className="flex-1 text-gray-900 dark:text-gray-50 text-[15px] leading-6">
            {q.prompt}
          </Text>
        </View>
        {msg.open ? (
          <View className="flex-row flex-wrap gap-2 pl-9">
            {q.options.map((o, i) => (
              <Pressable
                key={o.label}
                onPress={() => onAnswerRule(msg.q, i)}
                className={`px-4 py-2.5 rounded-full border active:opacity-70 ${
                  i === 0
                    ? 'bg-primary border-primary'
                    : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                }`}>
                <Text
                  className={`text-sm font-semibold ${
                    i === 0 ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                  }`}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-3">
      <RuleSheet choices={msg.choices} editable={msg.open} onEdit={onEditRule} />
      {msg.open ? (
        <Button onPress={() => onConfirmRules(msg.choices)} loading={busy}>
          Use these
        </Button>
      ) : null}
    </View>
  );
}

// The whole settings surface as sentences. Tapping a value token opens
// that field's options as chips under the line — the same options the
// question chips use, so a rule reads identically however it was set.
function RuleSheet({
  choices,
  editable,
  onEdit,
}: {
  choices: RuleChoices;
  editable: boolean;
  onEdit: (field: RuleField, value: RuleChoices[RuleField]) => void;
}) {
  const [openField, setOpenField] = useState<RuleField | null>(null);
  const [showFine, setShowFine] = useState(false);

  const groups = ruleSheet(choices).filter((g) => !g.fine || showFine);
  const fineCount = ruleSheet(choices)
    .filter((g) => g.fine)
    .reduce((n, g) => n + g.lines.length, 0);

  return (
    <View className="gap-3">
      <Text className="text-gray-900 dark:text-gray-50 text-base font-bold">Your rules</Text>
      {groups.map((g) => (
        <View key={g.group} className="gap-2">
          <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wide">
            {g.group}
          </Text>
          {g.lines.map((l, li) => {
            const lineField = l.parts.find((p) => 'f' in p);
            const field = lineField && 'f' in lineField ? lineField.f : null;
            return (
              <View key={li} className="gap-1.5">
                <Text className="text-gray-700 dark:text-gray-300 text-sm leading-5">
                  {l.parts.map((p, pi) =>
                    't' in p ? (
                      <Text key={pi}>{p.t}</Text>
                    ) : (
                      <Text
                        key={pi}
                        onPress={
                          editable
                            ? () => setOpenField(openField === p.f ? null : p.f)
                            : undefined
                        }
                        className="text-link font-semibold">
                        {fieldLabel(p.f, choices)}
                        {editable ? ' ▾' : ''}
                      </Text>
                    ),
                  )}
                </Text>
                {editable && field && openField === field ? (
                  <View className="flex-row flex-wrap gap-1.5 pb-1">
                    {RULE_FIELD_OPTIONS[field].map((o) => {
                      const selected = choices[field] === o.value;
                      return (
                        <Pressable
                          key={o.label}
                          onPress={() => {
                            onEdit(field, o.value);
                            setOpenField(null);
                          }}
                          className={`px-3 py-1.5 rounded-full border active:opacity-70 ${
                            selected
                              ? 'bg-primary border-primary'
                              : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                          }`}>
                          <Text
                            className={`text-[13px] font-semibold ${
                              selected ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                            }`}>
                            {o.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      {editable ? (
        <Pressable
          onPress={() => setShowFine((v) => !v)}
          className="flex-row items-center gap-1.5 active:opacity-70">
          <Ionicons
            name={showFine ? 'chevron-up' : 'chevron-down'}
            size={14}
            color="#9CA3AF"
          />
          <Text className="text-gray-500 dark:text-gray-400 text-[13px] font-medium">
            {showFine ? 'Hide the small print' : `The small print — ${fineCount} sensible defaults`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function GoLive({
  doneKeys,
  allDone,
  finishing,
  onFinish,
}: {
  doneKeys: Set<string>;
  allDone: boolean;
  finishing: boolean;
  onFinish: () => void;
}) {
  const items: { key: string; label: string; href: string }[] = [
    { key: 'stripe', label: 'Connect payments (Stripe)', href: '/management/billing' },
    { key: 'parq', label: 'Add your waiver and health questions', href: '/management/parq' },
    { key: 'logo', label: 'Add your logo and colours', href: '/management/branding' },
  ];
  const optional: { key: string; label: string; href: string }[] = [
    { key: 'team', label: 'Invite your coaches', href: '/management/team' },
    { key: 'members_imported', label: 'Bring your members across', href: '/management/members/import' },
    { key: 'members_imported_stripe', label: 'Pull plans and members from Stripe', href: '/management/members/import-stripe' },
    { key: 'workouts_imported', label: 'Import workout history', href: '/management/members/import-workouts' },
  ];
  const optDone = (key: string) =>
    doneKeys.has(key === 'members_imported_stripe' ? 'members_imported' : key);
  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-3">
      {items.map((it) => (
        <Pressable
          key={it.key}
          onPress={() => router.push(it.href as never)}
          disabled={doneKeys.has(it.key)}
          className="flex-row items-center gap-2.5 active:opacity-70">
          <Ionicons
            name={doneKeys.has(it.key) ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={doneKeys.has(it.key) ? '#10B981' : '#9CA3AF'}
          />
          <Text
            className={`flex-1 text-[15px] font-medium ${doneKeys.has(it.key) ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-50'}`}>
            {it.label}
          </Text>
          {!doneKeys.has(it.key) ? (
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          ) : null}
        </Pressable>
      ))}
      <View className="h-px bg-gray-100 dark:bg-gray-800" />
      <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-bold uppercase tracking-wide">
        Switching from another platform?
      </Text>
      {optional.map((it) => (
        <Pressable
          key={it.key}
          onPress={() => router.push(it.href as never)}
          className="flex-row items-center gap-2.5 active:opacity-70">
          <Ionicons
            name={optDone(it.key) ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={optDone(it.key) ? '#10B981' : '#9CA3AF'}
          />
          <Text
            className={`flex-1 text-[15px] font-medium ${optDone(it.key) ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-50'}`}>
            {it.label}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
        </Pressable>
      ))}
      <Button onPress={onFinish} loading={finishing}>
        {allDone ? 'Go to your gym' : 'I’ll finish these later'}
      </Button>
    </View>
  );
}
