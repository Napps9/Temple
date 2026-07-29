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

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '@/components/Button';
import { GymLogo } from '@/components/GymLogo';
import { InviteSection } from '@/components/InviteSection';
import {
  EMPTY_RECURRENCE,
  RecurrenceEditor,
  summariseRecurrence,
  validateRecurrence,
  type RecurrenceForm,
} from '@/components/RecurrenceEditor';
import { RuleSheet } from '@/components/RuleSheet';
import { Screen } from '@/components/Screen';
import { StatusDisk } from '@/components/StatusDisk';
import { useGymMembership, useMyProfile, useRole, useSession } from '@/lib/auth';
import { errorMessage, functionErrorMessage } from '@/lib/errors';
import {
  applyPlans,
  applyRules,
  applyTimetable,
} from '@/lib/setup-apply';
import {
  CLASS_TYPE_PALETTE,
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
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

// Day-one setup as a conversation. The script is fixed — timetable →
// prices → rules → go live — and the model only parses the owner's
// description into a proposal; nothing is written until they confirm,
// and every write then runs through the owner's own session on the same
// paths as the manual editors. /onboarding stays as the checklist escape
// hatch throughout.

// Order is the checklist's order, deliberately: settings before
// classes (so a class inherits the defaults just set), screening before
// payments, payments before plans (a plan can only sell on a connected
// account). /onboarding and this conversation must never disagree about
// what comes next.
type Step =
  | 'logo'
  | 'rules'
  | 'timetable'
  | 'parq'
  | 'stripe'
  | 'plans'
  | 'team'
  | 'golive';

type Msg =
  | { kind: 'temple'; text: string }
  | { kind: 'mine'; text: string }
  | { kind: 'receipt'; text: string; step?: Exclude<Step, 'golive'> }
  | { kind: 'step-ask'; step: Exclude<Step, 'golive'>; text: string }
  | { kind: 'logo-card'; open: boolean }
  | { kind: 'class-builder'; open: boolean }
  | { kind: 'stripe-card'; open: boolean }
  | { kind: 'plan-builder'; open: boolean }
  | { kind: 'waiver-card'; open: boolean }
  | { kind: 'team-card'; open: boolean }
  | { kind: 'timetable-card'; proposal: TimetableProposal; open: boolean }
  | { kind: 'plans-card'; proposal: PlansProposal; open: boolean }
  | { kind: 'rule-question'; q: number; open: boolean }
  | { kind: 'rules-gate'; open: boolean }
  | { kind: 'rules-summary'; choices: RuleChoices; open: boolean };

// The checklist's required list, in the checklist's order, so the
// progress bar counts exactly what /onboarding counts.
export const REQUIRED_SETUP_KEYS = [
  'logo',
  'settings',
  'class_type_and_schedule',
  'parq',
  'stripe',
  'plan',
] as const;

// Each step wears the checklist's own icon, label and time estimate, so
// a step opening in the chat and a row in the checklist read as the
// same object.
const STEP_META: Record<
  Exclude<Step, 'golive'>,
  { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; estimate: string }
> = {
  logo: { icon: 'image-outline', label: 'Add your gym logo', estimate: '1 min' },
  timetable: {
    icon: 'pricetag-outline',
    label: 'Add a class type & schedule',
    estimate: '3 min',
  },
  stripe: { icon: 'card-outline', label: 'Connect payments', estimate: '2 min' },
  plans: {
    icon: 'card-outline',
    label: 'Create a membership plan',
    estimate: '2 min',
  },
  parq: {
    icon: 'medkit-outline',
    label: 'Set up health screening',
    estimate: '2 min',
  },
  rules: {
    icon: 'settings-outline',
    label: 'Set your gym settings',
    estimate: '2 min',
  },
  team: {
    icon: 'people-outline',
    label: 'Invite your team',
    estimate: '1 min',
  },
};

// The checklist's sequencing survives as this script; each step takes
// whichever input is fastest — a tap for the logo, the real schedule
// editor for classes (typing the week out stays as the alternative in
// the bar), sentences for prices, chips for rules.
const ASK: Record<Exclude<Step, 'golive'>, string> = {
  logo:
    'First, make it yours — add your logo and the whole app wears it. Not to hand? Skip it; everything runs fine without.',
  timetable:
    'Now your week — add each class below — or just describe the whole thing in the box ("CrossFit at 6, 7 and 9:30 weekday mornings, 6pm evenings, cap of 16") and I\'ll build it.',
  stripe:
    'Payments next, before prices — connect your Stripe and members pay you directly; Temple takes no cut and adds nothing on top.',
  plans:
    'Prices next: add each membership below — or describe them ("Unlimited is £89 with 30 days notice, an 8-class pack is £59") and I\'ll build them.',
  parq:
    'Before anyone can book, members sign something — upload your waiver as a PDF and they sign it in the app. One is enough; a PAR-Q can come later.',
  team:
    'Last one, and it\u2019s optional — invite your coaches so they can take classes and write programming.',
  rules:
    'Next, a few rules — tap what fits. The first answer is what most gyms like yours do, and your classes will pick these up as their defaults. Change any of it later just by telling me.',
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
  const requiredDoneCount = REQUIRED_SETUP_KEYS.filter((k) =>
    doneKeys.has(k),
  ).length;

  function stepsRemaining(from: Step | null): Step[] {
    const all: Step[] = [
      'logo',
      'rules',
      'timetable',
      'parq',
      'stripe',
      'plans',
      'team',
      'golive',
    ];
    const start = from ? all.indexOf(from) + 1 : 0;
    return all.slice(start).filter((s) => {
      if (s === 'logo') return !doneKeys.has('logo');
      if (s === 'timetable') return !doneKeys.has('class_type_and_schedule');
      if (s === 'stripe') return !doneKeys.has('stripe');
      if (s === 'plans') return !doneKeys.has('plan');
      if (s === 'parq') return !doneKeys.has('parq');
      if (s === 'rules') return !doneKeys.has('settings');
      if (s === 'team') return !doneKeys.has('team');
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
      pushMsgs(
        { kind: 'step-ask', step: 'rules', text: ASK.rules },
        { kind: 'rule-question', q: 0, open: true },
      );
    } else if (next === 'logo') {
      pushMsgs(
        { kind: 'step-ask', step: 'logo', text: ASK.logo },
        { kind: 'logo-card', open: true },
      );
    } else if (next === 'timetable') {
      pushMsgs(
        { kind: 'step-ask', step: 'timetable', text: ASK.timetable },
        { kind: 'class-builder', open: true },
      );
    } else if (next === 'stripe') {
      pushMsgs(
        { kind: 'step-ask', step: 'stripe', text: ASK.stripe },
        { kind: 'stripe-card', open: true },
      );
    } else if (next === 'plans') {
      pushMsgs(
        { kind: 'step-ask', step: 'plans', text: ASK.plans },
        { kind: 'plan-builder', open: true },
      );
    } else if (next === 'parq') {
      pushMsgs(
        { kind: 'step-ask', step: 'parq', text: ASK.parq },
        { kind: 'waiver-card', open: true },
      );
    } else if (next === 'team') {
      pushMsgs(
        { kind: 'step-ask', step: 'team', text: ASK.team },
        { kind: 'team-card', open: true },
      );
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
    if (!text || !step) return;
    // The bar never disappears — steps whose fast path is a tap still
    // answer a typed message instead of presenting a dead input.
    if (
      step === 'logo' ||
      step === 'stripe' ||
      step === 'parq' ||
      step === 'team' ||
      step === 'rules' ||
      step === 'golive'
    ) {
      setInput('');
      pushMsgs(
        { kind: 'mine', text },
        {
          kind: 'temple',
          text:
            step === 'logo'
              ? 'This one’s a tap — choose your logo above, or skip and we’ll move on.'
              : step === 'stripe'
                ? 'Stripe needs its own secure page — tap Connect above, or do it later.'
                : step === 'parq'
                  ? 'This one’s a file — upload your waiver above, or skip it for now.'
                  : step === 'team'
                    ? 'Pop a coach’s email in the box above, or skip if you run solo.'
                    : step === 'rules'
                      ? 'Tap an answer above — the chips are quicker than typing for these.'
                      : 'These last few need real buttons — tap through the list above.',
        },
      );
      return;
    }
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
        if (step === 'timetable') {
          pushMsgs({ kind: 'class-builder', open: true });
        } else if (step === 'plans') {
          pushMsgs({ kind: 'plan-builder', open: true });
        }
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
          pushMsgs({
            kind: 'receipt',
            step: 'timetable',
            text: 'Timetable set — members can book as soon as you’re live.',
          });
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
          pushMsgs({
            kind: 'receipt',
            step: 'plans',
            text: doneKeys.has('stripe')
              ? 'Plans created — they’re on sale the moment you’re live.'
              : 'Plans created — they go on sale once Stripe is connected.',
          });
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
      <Screen edges={['bottom', 'left', 'right']}>
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
    <Screen edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        {/* The checklist's progress header, compacted for a conversation:
            same "N of M done · REQUIRED" line and primary-filled bar, so
            the chat reads as the same piece of software. */}
        <View className="px-4 pt-2 pb-2 gap-2 md:max-w-2xl md:mx-auto md:w-full">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2.5">
              <View className="w-8 h-8 rounded-xl bg-primary/15 items-center justify-center">
                <Ionicons name="rocket-outline" size={17} color={colors.primary} />
              </View>
              <View>
                <Text className="text-primary text-[10px] font-semibold uppercase tracking-widest">
                  Setting up
                </Text>
                <Text className="text-gray-900 dark:text-gray-50 font-semibold text-[15px]">
                  {brand.gymName}
                </Text>
              </View>
            </View>
            <View className="items-end gap-0.5">
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                {requiredDoneCount} of {REQUIRED_SETUP_KEYS.length} done
              </Text>
              <Pressable onPress={() => router.replace('/onboarding')} hitSlop={6}>
                <Text className="text-link text-xs font-medium">Prefer the checklist?</Text>
              </Pressable>
            </View>
          </View>
          <View className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <View
              style={{
                width: `${(requiredDoneCount / REQUIRED_SETUP_KEYS.length) * 100}%`,
              }}
              className="h-full bg-primary rounded-full"
            />
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          className="flex-1"
          // flex-grow + justify-end anchors a short conversation to the
          // ask bar (a two-message thread on a desktop viewport otherwise
          // pins to the top with a screen of dead space); once the thread
          // outgrows the viewport it scrolls exactly as before.
          contentContainerClassName="flex-grow justify-end gap-4 py-4 px-4 md:max-w-2xl md:mx-auto md:w-full">
          {messages.map((m, i) =>
            m.kind === 'logo-card' ? (
              m.open ? (
                <LogoCard
                  key={i}
                  gymId={membership.gymId}
                  onDone={(receipt) => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({ kind: 'receipt', text: receipt });
                    advance('logo');
                  }}
                />
              ) : null
            ) : m.kind === 'class-builder' ? (
              m.open ? (
                <ClassBuilderCard
                  key={i}
                  busy={busy}
                  onApply={confirmTimetable}
                />
              ) : null
            ) : m.kind === 'stripe-card' ? (
              m.open ? (
                <StripeCard
                  key={i}
                  onSkip={() => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({
                      kind: 'receipt',
                      step: 'stripe',
                      text: 'Stripe can wait — plans become buyable once it’s connected.',
                    });
                    advance('stripe');
                  }}
                />
              ) : null
            ) : m.kind === 'plan-builder' ? (
              m.open ? (
                <PlanBuilderCard key={i} busy={busy} onApply={confirmPlans} />
              ) : null
            ) : m.kind === 'waiver-card' ? (
              m.open ? (
                <WaiverCard
                  key={i}
                  gymId={membership.gymId}
                  onDone={(receipt) => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({ kind: 'receipt', step: 'parq', text: receipt });
                    advance('parq');
                  }}
                />
              ) : null
            ) : m.kind === 'team-card' ? (
              m.open ? (
                <TeamCard
                  key={i}
                  onDone={(receipt) => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({ kind: 'receipt', step: 'team', text: receipt });
                    advance('team');
                  }}
                />
              ) : null
            ) : (
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
            ),
          )}

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

        {step !== null ? (
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
  const accent = useThemeColors().primary;
  // Rendered by the parent's special cases, never here.
  if (
    msg.kind === 'logo-card' ||
    msg.kind === 'class-builder' ||
    msg.kind === 'stripe-card' ||
    msg.kind === 'plan-builder' ||
    msg.kind === 'waiver-card' ||
    msg.kind === 'team-card'
  ) {
    return null;
  }
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
  // A finished step reads exactly like a ticked checklist row: emerald
  // disk, the step's own label struck through, the outcome beneath.
  if (msg.kind === 'receipt') {
    const meta = msg.step ? STEP_META[msg.step] : null;
    return (
      <View className="flex-row items-start gap-3">
        <StatusDisk
          size={28}
          done
          partial={false}
          complete={1}
          target={1}
          icon="checkmark"
          accent="#10B981"
        />
        <View className="flex-1">
          {meta ? (
            <Text className="text-gray-400 dark:text-gray-500 text-[13px] font-medium line-through">
              {meta.label}
            </Text>
          ) : null}
          <Text className="text-gray-500 dark:text-gray-400 text-[13px]">
            {msg.text}
          </Text>
        </View>
      </View>
    );
  }

  // A step opening: the checklist row's disk, label and ~estimate, with
  // the conversation's own prose underneath.
  if (msg.kind === 'step-ask') {
    const meta = STEP_META[msg.step];
    return (
      <View className="flex-row items-start gap-3">
        <StatusDisk
          size={28}
          done={false}
          partial={false}
          complete={0}
          target={1}
          icon={meta.icon}
          accent={accent}
        />
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-gray-900 dark:text-gray-50 text-[13px] font-semibold">
              {meta.label}
            </Text>
            <Text className="text-gray-400 dark:text-gray-500 text-[10px] font-mono">
              ~{meta.estimate}
            </Text>
          </View>
          <Text className="text-gray-700 dark:text-gray-200 text-[15px] leading-5">
            {msg.text}
          </Text>
        </View>
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

// The logo step: the branding screen's own picker, upload and
// set_gym_branding write, placed in the conversation. Skipping is a
// first-class answer — the checklist keeps the step open for later.
function LogoCard({
  gymId,
  onDone,
}: {
  gymId: string;
  onDone: (receipt: string) => void;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Photo library permission denied');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || result.assets.length === 0) return false;
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'png';
      const path = `${gymId}/light-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('gym-logos')
        .upload(path, blob, {
          contentType: asset.mimeType ?? `image/${ext}`,
          upsert: false,
        });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('gym-logos').getPublicUrl(path);

      // Per-card save discipline: send the server's values for every
      // other branding field so this write can only change the logo.
      const { data: gym, error: gErr } = await supabase
        .from('gyms')
        .select(
          'logo_url, primary_color, secondary_color, text_color, logo_url_dark, primary_color_dark, secondary_color_dark, text_color_dark',
        )
        .eq('id', gymId)
        .single();
      if (gErr || !gym) throw gErr ?? new Error('Could not read branding');
      const { error: sErr } = await supabase.rpc('set_gym_branding', {
        p_gym_id: gymId,
        p_logo_url: pub.publicUrl,
        p_primary_color: gym.primary_color,
        p_secondary_color: gym.secondary_color,
        p_text_color: gym.text_color,
        p_logo_url_dark: gym.logo_url_dark,
        p_primary_color_dark: gym.primary_color_dark,
        p_secondary_color_dark: gym.secondary_color_dark,
        p_text_color_dark: gym.text_color_dark,
      });
      if (sErr) throw sErr;
      setPreview(pub.publicUrl);
      return true;
    },
    onSuccess: (uploaded) => {
      if (!uploaded) return;
      queryClient.invalidateQueries({ queryKey: ['gym-row'] });
      queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
      queryClient.invalidateQueries({ queryKey: ['gym-membership'] });
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
      onDone('Logo’s in — the app is wearing it.');
    },
    onError: () => setError('That upload didn’t take — try again.'),
  });

  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-3">
      <View className="flex-row items-center gap-3">
        <GymLogo size={56} logoUrl={preview} name="?" primaryColor="#2563EB" />
        <Text className="flex-1 text-gray-500 dark:text-gray-400 text-sm leading-5">
          Square works best — it becomes the app icon your members install.
        </Text>
      </View>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={() => upload.mutate()} loading={upload.isPending}>
        Choose your logo
      </Button>
      <Pressable
        onPress={() => onDone('No logo for now — add it any time; the checklist keeps the step open.')}
        disabled={upload.isPending}
        hitSlop={6}>
        <Text className="text-link text-sm font-medium text-center">Skip for now</Text>
      </Pressable>
    </View>
  );
}

// The class step's structured path: the real schedule editor
// (RecurrenceEditor — the same component the class-types screen uses),
// embedded in the conversation. Each added class stacks up in the card;
// "That's my week" hands the lot to the same apply path the described
// week uses.
type BuilderEntry = { name: string; color: string; form: RecurrenceForm };

function ClassBuilderCard({
  busy,
  onApply,
}: {
  busy: boolean;
  onApply: (p: TimetableProposal) => void;
}) {
  const colors = useThemeColors();
  const { data: gymDefaults } = useGymOperatingDefaults();
  const weekStartsOn = gymDefaults?.week_starts_on ?? 'mon';
  const [entries, setEntries] = useState<BuilderEntry[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState(CLASS_TYPE_PALETTE[0]);
  // The settings step runs first (checklist order), so a class starts
  // from the defaults the owner just chose rather than a hard-coded 16.
  const [form, setForm] = useState<RecurrenceForm>({
    ...EMPTY_RECURRENCE,
    capacity: String(gymDefaults?.default_class_capacity ?? 16),
    durationMinutes: String(gymDefaults?.default_class_minutes ?? 60),
  });
  const [error, setError] = useState<string | null>(null);

  function addEntry() {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (cleanName.length < 2) {
      setError('Give the class a name — "CrossFit", "Spin", "Open Gym"…');
      return;
    }
    const invalid = validateRecurrence(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setEntries((e) => [...e, { name: cleanName, color, form }]);
    setName('');
    setColor(CLASS_TYPE_PALETTE[(entries.length + 1) % CLASS_TYPE_PALETTE.length]);
    setForm({ ...EMPTY_RECURRENCE, capacity: form.capacity, durationMinutes: form.durationMinutes });
  }

  function applyAll() {
    const typeByName = new Map<string, { name: string; color: string }>();
    for (const e of entries) {
      if (!typeByName.has(e.name.toLowerCase())) {
        typeByName.set(e.name.toLowerCase(), { name: e.name, color: e.color });
      }
    }
    onApply({
      class_types: [...typeByName.values()],
      schedules: entries.map((e) => ({
        class_type: e.name,
        days: e.form.days,
        times: e.form.times.map((t) => t.trim()).filter(Boolean),
        duration_minutes: parseInt(e.form.durationMinutes, 10),
        capacity: parseInt(e.form.capacity, 10),
      })),
    });
  }

  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-4">
      {entries.length > 0 ? (
        <View className="gap-2">
          {entries.map((e, i) => (
            <View key={i} className="flex-row items-start gap-2.5">
              <View
                className="w-3 h-3 rounded-full mt-1"
                style={{ backgroundColor: e.color }}
              />
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold text-sm">
                  {e.name}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {summariseRecurrence(e.form, weekStartsOn)}
                </Text>
              </View>
              <Pressable
                onPress={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                hitSlop={6}
                accessibilityLabel={`Remove ${e.name}`}>
                <Ionicons name="close" size={16} color={colors.iconSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Class name
        </Text>
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="CrossFit"
              placeholderTextColor="#9CA3AF"
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50"
            />
          </View>
          {CLASS_TYPE_PALETTE.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              accessibilityLabel={`Colour ${c}`}
              className={`w-6 h-6 rounded-full ${
                color === c ? 'border-2 border-gray-900 dark:border-gray-50' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </View>
      </View>

      <RecurrenceEditor value={form} onChange={setForm} hideRepeat />

      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button variant="secondary" onPress={addEntry} disabled={busy}>
            Add this class
          </Button>
        </View>
        <View className="flex-1">
          <Button onPress={applyAll} disabled={busy || entries.length === 0} loading={busy}>
            That’s my week
          </Button>
        </View>
      </View>
    </View>
  );
}

// The payments step. Stripe's OAuth has to leave the app — that part is
// unavoidable — but there is no reason to detour through the billing
// screen to reach the same button, so the card starts the round-trip
// itself. The callback lands on billing with ?stripe=connected, whose
// handler sees the setup flag and returns here, so the owner's
// experience is: tap in the chat, authorise, back in the chat.
function StripeCard({ onSkip }: { onSkip: () => void }) {
  const { data: membership } = useGymMembership();
  const [error, setError] = useState<string | null>(null);

  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.jointemple.io';

  const connect = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('Missing context');
      const { data, error: e } = await supabase.functions.invoke(
        'stripe-connect-start',
        { body: { gym_id: membership.gymId, origin, return_path: '/setup' } },
      );
      if (e) throw new Error(await functionErrorMessage(e));
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error('Could not start the Stripe connection');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem('temple-setup-stripe', '1');
        } catch {
          // sessionStorage unavailable — billing's own back link still works
        }
        window.location.href = url;
        return;
      }
      throw new Error('Connecting Stripe is only available on the web for now');
    },
    onError: (e) =>
      setError(errorMessage(e, 'Could not start the Stripe connection')),
  });

  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-3">
      <Text className="text-gray-500 dark:text-gray-400 text-sm leading-5">
        Your own Stripe account takes the money and pays out to your bank.
        Card processing is Stripe's usual rate; Temple adds nothing on top and
        takes no cut of bookings.
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-sm leading-5">
        You'll sign in to Stripe (or create an account) and come straight back
        here. It takes about a minute.
      </Text>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={() => connect.mutate()} loading={connect.isPending}>
        Connect Stripe
      </Button>
      <Pressable onPress={onSkip} disabled={connect.isPending} hitSlop={6}>
        <Text className="text-link text-sm font-medium text-center">Do this later</Text>
      </Pressable>
    </View>
  );
}

// The plans step's structured path: the same container shape as the
// class builder — kind chips, price, credits, notice — stacking plans
// and applying through the same path as described prices.
type PlanEntry = {
  name: string;
  kind: 'unlimited' | 'credit_period' | 'credit_pack';
  pounds: string;
  credits: string;
  notice: string;
};

const PLAN_KIND_LABEL: Record<PlanEntry['kind'], string> = {
  unlimited: 'Unlimited',
  credit_period: 'Classes a month',
  credit_pack: 'Class pack',
};

function PlanBuilderCard({
  busy,
  onApply,
}: {
  busy: boolean;
  onApply: (p: PlansProposal) => void;
}) {
  const colors = useThemeColors();
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [draft, setDraft] = useState<PlanEntry>({
    name: '',
    kind: 'unlimited',
    pounds: '',
    credits: '8',
    notice: '30',
  });
  const [error, setError] = useState<string | null>(null);

  const creditKind = draft.kind !== 'unlimited';
  const recurringKind = draft.kind !== 'credit_pack';

  function addEntry() {
    const name = draft.name.trim().replace(/\s+/g, ' ');
    const pounds = Number(draft.pounds.replace(',', '.'));
    const credits = parseInt(draft.credits, 10);
    const notice = draft.notice.trim() === '' ? 0 : parseInt(draft.notice, 10);
    if (name.length < 2) {
      setError('Give the plan a name — "Unlimited", "8-class pack"…');
      return;
    }
    if (!Number.isFinite(pounds) || pounds <= 0) {
      setError('Set a price — a plan with no price can’t be sold.');
      return;
    }
    if (creditKind && (!Number.isInteger(credits) || credits < 1 || credits > 100)) {
      setError('How many classes does it include? 1–100.');
      return;
    }
    if (recurringKind && (!Number.isInteger(notice) || notice < 0 || notice > 90)) {
      setError('Notice must be 0–90 days.');
      return;
    }
    setError(null);
    setEntries((e) => [...e, { ...draft, name }]);
    setDraft({ name: '', kind: draft.kind, pounds: '', credits: draft.credits, notice: draft.notice });
  }

  function applyAll() {
    onApply({
      plans: entries.map((e) => ({
        name: e.name,
        kind: e.kind,
        monthly_price_cents: Math.round(Number(e.pounds.replace(',', '.')) * 100),
        credit_count: e.kind === 'unlimited' ? null : parseInt(e.credits, 10),
        notice_period_days:
          e.kind === 'credit_pack' || e.notice.trim() === ''
            ? null
            : parseInt(e.notice, 10),
        blurb: '',
      })),
    });
  }

  function entrySummary(e: PlanEntry): string {
    const bits = [`£${e.pounds}`];
    if (e.kind !== 'unlimited') bits.push(`${e.credits} classes`);
    if (e.kind !== 'credit_pack' && e.notice.trim() !== '' && e.notice !== '0') {
      bits.push(`${e.notice} days notice`);
    }
    return `${PLAN_KIND_LABEL[e.kind]} · ${bits.join(' · ')}`;
  }

  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-4">
      {entries.length > 0 ? (
        <View className="gap-2">
          {entries.map((e, i) => (
            <View key={i} className="flex-row items-start gap-2.5">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold text-sm">
                  {e.name}
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  {entrySummary(e)}
                </Text>
              </View>
              <Pressable
                onPress={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                hitSlop={6}
                accessibilityLabel={`Remove ${e.name}`}>
                <Ionicons name="close" size={16} color={colors.iconSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-1.5">
        <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
          Plan name
        </Text>
        <TextInput
          value={draft.name}
          onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          placeholder="Unlimited"
          placeholderTextColor="#9CA3AF"
          className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50"
        />
      </View>

      <View className="flex-row flex-wrap gap-1.5">
        {(Object.keys(PLAN_KIND_LABEL) as PlanEntry['kind'][]).map((k) => {
          const sel = draft.kind === k;
          return (
            <Pressable
              key={k}
              onPress={() => setDraft((d) => ({ ...d, kind: k }))}
              className={`px-3 py-1.5 rounded-full border active:opacity-70 ${
                sel
                  ? 'bg-primary border-primary'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
              }`}>
              <Text
                className={`text-[13px] font-semibold ${
                  sel ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}>
                {PLAN_KIND_LABEL[k]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1 gap-1.5">
          <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
            {draft.kind === 'credit_pack' ? 'Price (£)' : 'Price (£ / month)'}
          </Text>
          <TextInput
            value={draft.pounds}
            onChangeText={(pounds) => setDraft((d) => ({ ...d, pounds }))}
            placeholder="89"
            keyboardType="decimal-pad"
            placeholderTextColor="#9CA3AF"
            className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50"
          />
        </View>
        {creditKind ? (
          <View className="flex-1 gap-1.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
              Classes
            </Text>
            <TextInput
              value={draft.credits}
              onChangeText={(credits) => setDraft((d) => ({ ...d, credits }))}
              keyboardType="number-pad"
              placeholderTextColor="#9CA3AF"
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50"
            />
          </View>
        ) : null}
        {recurringKind ? (
          <View className="flex-1 gap-1.5">
            <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
              Notice (days)
            </Text>
            <TextInput
              value={draft.notice}
              onChangeText={(notice) => setDraft((d) => ({ ...d, notice }))}
              keyboardType="number-pad"
              placeholderTextColor="#9CA3AF"
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50"
            />
          </View>
        ) : null}
      </View>

      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button variant="secondary" onPress={addEntry} disabled={busy}>
            Add this plan
          </Button>
        </View>
        <View className="flex-1">
          <Button onPress={applyAll} disabled={busy || entries.length === 0} loading={busy}>
            That’s the lot
          </Button>
        </View>
      </View>
    </View>
  );
}

// The health-screening step: the same PDF pick → gym-waivers upload →
// publish_waiver path the health screening screen uses, in one tap. A
// PAR-Q questionnaire is the deeper surface and stays one tap away —
// one of the two satisfies the requirement.
function WaiverCard({
  gymId,
  onDone,
}: {
  gymId: string;
  onDone: (receipt: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return false;
      const asset = res.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const path = `${gymId}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from('gym-waivers')
        .upload(path, blob, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('gym-waivers').getPublicUrl(path);
      const { error: pErr } = await supabase.rpc('publish_waiver', {
        p_gym_id: gymId,
        p_title: 'Liability waiver',
        p_file_path: path,
        p_file_url: pub.publicUrl,
      });
      if (pErr) throw pErr;
      return true;
    },
    onSuccess: (published) => {
      if (!published) return;
      queryClient.invalidateQueries({ queryKey: ['waiver-active'] });
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
      onDone('Waiver published — members sign it before their first class.');
    },
    onError: () => setError('That upload didn’t take — PDFs only, and try again.'),
  });

  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-3">
      <Text className="text-gray-500 dark:text-gray-400 text-sm leading-5">
        A PDF is all it takes — members sign it with their finger in the app,
        and it’s kept as a liability record.
      </Text>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={() => upload.mutate()} loading={upload.isPending}>
        Upload your waiver
      </Button>
      <Pressable
        onPress={() => router.push('/management/parq?backTo=setup' as never)}
        hitSlop={6}>
        <Text className="text-link text-sm font-medium text-center">
          Build a PAR-Q instead
        </Text>
      </Pressable>
      <Pressable
        onPress={() =>
          onDone('Health screening skipped — members can’t book until one is published.')
        }
        disabled={upload.isPending}
        hitSlop={6}>
        <Text className="text-gray-400 dark:text-gray-500 text-sm text-center">
          Do this later
        </Text>
      </Pressable>
    </View>
  );
}

// The team step: the Team screen's own InviteSection, dropped into the
// conversation — same code minting the same single-use invite, same
// manual-link fallback when email isn't configured.
function TeamCard({ onDone }: { onDone: (receipt: string) => void }) {
  return (
    <View className="ml-9 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 gap-3">
      <InviteSection
        title="Invite a coach"
        subtitle="They'll get a link to join with the right access."
        roles={['coach', 'staff', 'admin']}
        initialRole="coach"
      />
      <Pressable onPress={() => onDone('Team invites done — you can add more any time.')} hitSlop={6}>
        <Text className="text-link text-sm font-medium text-center">
          That’s everyone
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onDone('No invites for now — it’s a two-tap job whenever you need it.')}
        hitSlop={6}>
        <Text className="text-gray-400 dark:text-gray-500 text-sm text-center">
          I run solo
        </Text>
      </Pressable>
    </View>
  );
}
