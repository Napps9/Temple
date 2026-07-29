import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { MoneyJobCard } from '@/components/MoneyJobCard';
import { RuleSheet } from '@/components/RuleSheet';
import { Screen } from '@/components/Screen';
import { useGymMembership, useRole } from '@/lib/auth';
import { useDecideChangeRequest } from '@/lib/membership-changes';
import {
  choicesFromGym,
  GYM_RULES_SELECT,
  type ClassTypeCancelRow,
  type GymRulesRow,
} from '@/lib/rules-read';
import { applyPlans, applyRules, applyTimetable } from '@/lib/setup-apply';
import {
  fieldLabel,
  formatDays,
  formatPrice,
  ruleChangeLine,
  ruleSheet,
  sanitisePlans,
  sanitiseRuleChanges,
  sanitiseTimetable,
  sheetLineText,
  type PlansProposal,
  type RuleChange,
  type RuleChoices,
  type RuleField,
  type TimetableProposal,
} from '@/lib/setup-flow';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import {
  formatClock,
  formatTimelineLine,
  groupTimelineByDay,
  type TimelineEvent,
} from '@/lib/timeline';

// The Timeline (docs/roadmap.md phases 1, 3 and 4): the staff home. The
// stream is the gym's existing activity, read-only; the talk bar is the
// owner's pen — rules, new classes, new plans and closures as sentences,
// parsed to a proposal, confirmed on a card, applied through the same
// writes the manual editors use. Scope is narrow and honest: anything
// else gets a plain "not from here yet", never a guess.

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

function useMoneyAuthority(gymId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['agent-authority', gymId],
    enabled: !!gymId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_authority')
        .select('action_kind, level')
        .eq('gym_id', gymId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

type GymRules = {
  choices: RuleChoices;
  defaults: { capacity: number; minutes: number };
};

function useGymRules(gymId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['gym-rules', gymId],
    enabled: !!gymId && enabled,
    queryFn: async (): Promise<GymRules> => {
      const [gymRes, typesRes] = await Promise.all([
        supabase.from('gyms').select(GYM_RULES_SELECT).eq('id', gymId!).single(),
        supabase
          .from('class_types')
          .select(
            'cancel_cutoff_mode, cancel_cutoff_time, cancel_cutoff_minutes_before',
          )
          .eq('gym_id', gymId!)
          .is('archived_at', null),
      ]);
      if (gymRes.error || !gymRes.data) {
        throw gymRes.error ?? new Error('Could not read settings');
      }
      const gym = gymRes.data as unknown as GymRulesRow;
      const types = (typesRes.data ?? []) as ClassTypeCancelRow[];
      return {
        choices: choicesFromGym(gym, types),
        defaults: {
          capacity: gym.default_class_capacity,
          minutes: gym.default_class_minutes,
        },
      };
    },
  });
}

type LocalMsg =
  | { kind: 'mine'; text: string }
  | { kind: 'temple'; text: string }
  | { kind: 'receipt'; text: string }
  | { kind: 'rule-changes'; changes: RuleChange[]; open: boolean }
  | { kind: 'add-classes'; proposal: TimetableProposal; open: boolean }
  | {
      kind: 'closure';
      starts_on: string;
      ends_on: string;
      reason: string | null;
      open: boolean;
    }
  | { kind: 'add-plans'; proposal: PlansProposal; open: boolean }
  | { kind: 'rules-sheet' };

const CANNOT_COPY =
  "That's not something I can change from here yet — the Manage screens still cover it.";
const NO_CHANGE_COPY =
  "I didn't catch a change in that. Try it like: 'free cancel until 2 hours " +
  "before', 'add a 7am Wednesday spin class', or 'close the gym 24 to 28 December'.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function closureFromProposal(
  raw: unknown,
): { starts_on: string; ends_on: string; reason: string | null } | null {
  const c = raw as
    | { starts_on?: unknown; ends_on?: unknown; reason?: unknown }
    | null
    | undefined;
  if (!c || typeof c.starts_on !== 'string' || typeof c.ends_on !== 'string') {
    return null;
  }
  if (!DATE_RE.test(c.starts_on) || !DATE_RE.test(c.ends_on)) return null;
  if (c.ends_on < c.starts_on) return null;
  const reason =
    typeof c.reason === 'string' && c.reason.trim()
      ? c.reason.trim().slice(0, 120)
      : null;
  return { starts_on: c.starts_on, ends_on: c.ends_on, reason };
}

function formatClosureDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export default function Timeline() {
  const { data: membership } = useGymMembership();
  const gymId = membership?.gymId;
  const role = useRole();
  const isOwner = role === 'owner';
  const colors = useThemeColors();
  const qc = useQueryClient();

  const feed = useTimelineFeed(gymId);
  const rules = useGymRules(gymId, isOwner);
  const authority = useMoneyAuthority(gymId, isOwner);
  const [jobDismissed, setJobDismissed] = useState(false);

  const hasFailingPayment = (feed.data ?? []).some(
    (e) => e.kind === 'payment_failing',
  );
  const showMoneyJobCard =
    isOwner &&
    !jobDismissed &&
    hasFailingPayment &&
    authority.data !== undefined &&
    authority.data.length === 0;

  const [local, setLocal] = useState<LocalMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (local.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [local.length]);

  const push = (...msgs: LocalMsg[]) => setLocal((l) => [...l, ...msgs]);
  const closeCard = (index: number) =>
    setLocal((l) =>
      l.map((m, i) => (i === index && 'open' in m ? { ...m, open: false } : m)),
    );

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !gymId) return;
    setInput('');
    push({ kind: 'mine', text });
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-setup', {
        body: { gym_id: gymId, step: 'change', text },
      });
      if (error) throw error;
      const p = (data as { proposal?: Record<string, unknown> })?.proposal ?? {};
      const cards: LocalMsg[] = [];
      const current = rules.data?.choices;

      if (current && Array.isArray(p.rule_changes)) {
        const changes = sanitiseRuleChanges(
          { changes: p.rule_changes },
          current,
        );
        if (changes) cards.push({ kind: 'rule-changes', changes, open: true });
      }
      if (Array.isArray(p.add_classes)) {
        const proposal = sanitiseTimetable({ schedules: p.add_classes });
        if (proposal) cards.push({ kind: 'add-classes', proposal, open: true });
      }
      if (Array.isArray(p.add_plans)) {
        const proposal = sanitisePlans({ plans: p.add_plans });
        if (proposal) cards.push({ kind: 'add-plans', proposal, open: true });
      }
      const closure = closureFromProposal(p.closure);
      if (closure) cards.push({ kind: 'closure', ...closure, open: true });

      if (cards.length > 0) push(...cards);
      else if (typeof p.cannot === 'string' && p.cannot.trim()) {
        push({ kind: 'temple', text: CANNOT_COPY });
      } else {
        push({ kind: 'temple', text: NO_CHANGE_COPY });
      }
    } catch {
      push({
        kind: 'temple',
        text: "I couldn't work on that just now — try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmRules = async (index: number, changes: RuleChange[]) => {
    if (!gymId || !rules.data || busy) return;
    setBusy(true);
    try {
      const next = { ...rules.data.choices } as RuleChoices;
      for (const c of changes) {
        (next as Record<string, unknown>)[c.field] = c.value;
      }
      await applyRules(supabase, gymId, rules.data.defaults, next, {
        touchCancelPolicy: changes.some((c) => c.field === 'late_cancel'),
      });
      closeCard(index);
      const lines = changes.map((c) => {
        const sheetLine = ruleSheet(next)
          .flatMap((g) => g.lines)
          .find((l) => l.parts.some((pt) => 'f' in pt && pt.f === c.field));
        return sheetLine ? sheetLineText(sheetLine, next) : fieldLabel(c.field, next);
      });
      push({ kind: 'receipt', text: `Done. ${lines.join('. ')}.` });
      qc.invalidateQueries({ queryKey: ['gym-rules', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const applySingleRule = async (
    field: RuleField,
    value: RuleChoices[RuleField],
  ) => {
    if (!gymId || !rules.data || busy) return;
    await confirmRules(-1, [{ field, value }]);
  };

  const confirmClasses = async (index: number, proposal: TimetableProposal) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await applyTimetable(supabase, gymId, tz, proposal);
      closeCard(index);
      const lines = proposal.schedules.map(
        (s) => `${s.class_type} — ${formatDays(s.days)} at ${s.times.join(', ')}`,
      );
      push({ kind: 'receipt', text: `On the timetable. ${lines.join('. ')}.` });
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const confirmPlans = async (index: number, proposal: PlansProposal) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      await applyPlans(supabase, gymId, proposal);
      closeCard(index);
      const names = proposal.plans
        .map((p) => `${p.name} at ${formatPrice(p.monthly_price_cents)}`)
        .join(', ');
      push({ kind: 'receipt', text: `Created. ${names}.` });
    } catch (e) {
      const msg = e instanceof Error && /already exists|duplicate/i.test(e.message)
        ? 'One of those plans already exists — nothing was created.'
        : "That didn't save — try again.";
      push({ kind: 'temple', text: msg });
    } finally {
      setBusy(false);
    }
  };

  const confirmClosure = async (
    index: number,
    c: { starts_on: string; ends_on: string; reason: string | null },
  ) => {
    if (!gymId || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('close_gym_dates', {
        p_gym_id: gymId,
        p_start: c.starts_on,
        p_end: c.ends_on,
        p_reason: c.reason,
        p_exclude_session_ids: null,
      });
      if (error) throw error;
      closeCard(index);
      const result = data as { cancelled: number; notified: number } | null;
      const range =
        c.starts_on === c.ends_on
          ? `on ${formatClosureDay(c.starts_on)}`
          : `${formatClosureDay(c.starts_on)} to ${formatClosureDay(c.ends_on)}`;
      const cancelled = result?.cancelled ?? 0;
      push({
        kind: 'receipt',
        text:
          cancelled > 0
            ? `The gym is closed ${range}. ${cancelled} ${cancelled === 1 ? 'class' : 'classes'} cancelled — everyone booked has been refunded and told.`
            : `The gym is closed ${range}. Nothing was scheduled in those dates yet.`,
      });
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
    } catch {
      push({ kind: 'temple', text: "That didn't save — try again." });
    } finally {
      setBusy(false);
    }
  };

  const showRulesSheet = () => {
    setLocal((l) =>
      l.some((m) => m.kind === 'rules-sheet')
        ? l
        : [...l, { kind: 'rules-sheet' }],
    );
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const groups = groupTimelineByDay(feed.data ?? []);

  return (
    <Screen className="px-0">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          ref={scrollRef}
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
          ) : groups.length === 0 && local.length === 0 ? (
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
                  ) : e.kind === 'agent_action' &&
                    (e.detail as { status?: string }).status === 'proposed' ? (
                    <AgentActionCard key={e.item_id} event={e} gymId={gymId} />
                  ) : (
                    <ReceiptLine key={e.item_id} event={e} />
                  ),
                )}
              </View>
            ))
          )}

          {showMoneyJobCard ? (
            <MoneyJobCard
              gymId={gymId}
              onDismiss={() => setJobDismissed(true)}
              onTakenOn={() => {
                setJobDismissed(true);
                push({
                  kind: 'receipt',
                  text: "The money job is on — I'll ask before anything goes out.",
                });
                qc.invalidateQueries({ queryKey: ['agent-authority', gymId] });
              }}
            />
          ) : null}

          {local.map((m, i) => (
            <LocalRow
              key={i}
              msg={m}
              index={i}
              busy={busy}
              choices={rules.data?.choices}
              onConfirmRules={confirmRules}
              onConfirmClasses={confirmClasses}
              onConfirmPlans={confirmPlans}
              onConfirmClosure={confirmClosure}
              onDismiss={closeCard}
              onEditRule={applySingleRule}
            />
          ))}

          {busy ? (
            <View className="flex-row items-center gap-2 px-1">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Working on it…
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {isOwner ? (
          <View className="px-4 pb-4 pt-1 gap-2 md:max-w-2xl md:mx-auto md:w-full">
            <View className="flex-row gap-2">
              <BarChip
                icon="document-text-outline"
                label="Your rules"
                onPress={showRulesSheet}
              />
              <BarChip
                icon="people-outline"
                label="The team"
                onPress={() => router.push('/management/roster' as never)}
              />
              <BarChip
                icon="flag-outline"
                label="Goals"
                onPress={() => router.push('/management/goals' as never)}
              />
            </View>
            <View className="flex-row items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full pl-4 pr-1.5 py-1.5 shadow-card">
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!busy}
                placeholder="Change a rule, add a class, close some dates…"
                placeholderTextColor="#9CA3AF"
                multiline
                className="flex-1 text-gray-900 dark:text-gray-50 text-[15px] max-h-24 py-1.5"
                onSubmitEditing={send}
              />
              <Pressable
                onPress={send}
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

function BarChip({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 active:opacity-70">
      <Ionicons name={icon} size={14} color={colors.iconSecondary} />
      <Text className="text-gray-700 dark:text-gray-300 text-[13px] font-semibold">
        {label}
      </Text>
    </Pressable>
  );
}

function LocalRow({
  msg,
  index,
  busy,
  choices,
  onConfirmRules,
  onConfirmClasses,
  onConfirmPlans,
  onConfirmClosure,
  onDismiss,
  onEditRule,
}: {
  msg: LocalMsg;
  index: number;
  busy: boolean;
  choices: RuleChoices | undefined;
  onConfirmRules: (index: number, changes: RuleChange[]) => void;
  onConfirmClasses: (index: number, proposal: TimetableProposal) => void;
  onConfirmPlans: (index: number, proposal: PlansProposal) => void;
  onConfirmClosure: (
    index: number,
    c: { starts_on: string; ends_on: string; reason: string | null },
  ) => void;
  onDismiss: (index: number) => void;
  onEditRule: (field: RuleField, value: RuleChoices[RuleField]) => void;
}) {
  if (msg.kind === 'mine') {
    return (
      <View className="self-end max-w-[85%] bg-primary rounded-2xl rounded-br-md px-4 py-2.5">
        <Text className="text-white text-[15px] leading-[21px]">{msg.text}</Text>
      </View>
    );
  }
  if (msg.kind === 'temple') {
    return (
      <Text className="text-gray-700 dark:text-gray-200 text-[15px] leading-[22px] px-1">
        {msg.text}
      </Text>
    );
  }
  if (msg.kind === 'receipt') {
    return <SoftLine text={msg.text} tone="neutral" />;
  }
  if (msg.kind === 'rules-sheet') {
    if (!choices) return null;
    return (
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
        <RuleSheet choices={choices} editable={!busy} onEdit={onEditRule} />
      </View>
    );
  }

  if (msg.kind === 'rule-changes') {
    if (!msg.open || !choices) return null;
    return (
      <ProposalCard
        title={msg.changes.length === 1 ? 'Change this rule?' : 'Change these rules?'}
        lines={msg.changes.map((c) => ruleChangeLine(c, choices))}
        yes="Yes, change it"
        busy={busy}
        onYes={() => onConfirmRules(index, msg.changes)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  if (msg.kind === 'add-classes') {
    if (!msg.open) return null;
    return (
      <ProposalCard
        title="Add this to the timetable?"
        lines={msg.proposal.schedules.map(
          (s) =>
            `${s.class_type} — ${formatDays(s.days)} at ${s.times.join(', ')}, ` +
            `${s.duration_minutes} min, cap ${s.capacity}`,
        )}
        yes="Yes, add it"
        busy={busy}
        onYes={() => onConfirmClasses(index, msg.proposal)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  if (msg.kind === 'add-plans') {
    if (!msg.open) return null;
    return (
      <ProposalCard
        title="Create these memberships?"
        lines={msg.proposal.plans.map((p) => {
          const price = formatPrice(p.monthly_price_cents);
          const credits =
            p.credit_count !== null ? `, ${p.credit_count} classes` : '';
          const notice =
            p.notice_period_days !== null && p.notice_period_days > 0
              ? `, ${p.notice_period_days} days notice`
              : '';
          return `${p.name} — ${price}${credits}${notice}`;
        })}
        yes="Yes, create them"
        busy={busy}
        onYes={() => onConfirmPlans(index, msg.proposal)}
        onNo={() => onDismiss(index)}
      />
    );
  }
  // closure
  if (!msg.open) return null;
  const range =
    msg.starts_on === msg.ends_on
      ? formatClosureDay(msg.starts_on)
      : `${formatClosureDay(msg.starts_on)} to ${formatClosureDay(msg.ends_on)}`;
  return (
    <ProposalCard
      title={`Close the gym ${range}?`}
      lines={[
        'Every class in those dates is cancelled, everyone booked is refunded and told, and nothing new can be scheduled into them.',
      ]}
      yes="Yes, close it"
      busy={busy}
      onYes={() =>
        onConfirmClosure(index, {
          starts_on: msg.starts_on,
          ends_on: msg.ends_on,
          reason: msg.reason,
        })
      }
      onNo={() => onDismiss(index)}
    />
  );
}

function ProposalCard({
  title,
  lines,
  yes,
  busy,
  onYes,
  onNo,
}: {
  title: string;
  lines: string[];
  yes: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold leading-[22px]">
        {title}
      </Text>
      <View className="gap-1.5">
        {lines.map((l, i) => (
          <Text key={i} className="text-gray-600 dark:text-gray-300 text-sm leading-5">
            {l}
          </Text>
        ))}
      </View>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button onPress={onYes} loading={busy}>
            {yes}
          </Button>
        </View>
        <View className="flex-1">
          <Button variant="secondary" onPress={onNo} disabled={busy}>
            No
          </Button>
        </View>
      </View>
    </View>
  );
}

function ReceiptLine({ event }: { event: TimelineEvent }) {
  const line = formatTimelineLine(event);
  return <SoftLine text={line.text} tone={line.tone} at={event.occurred_at} />;
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

// A proposed action from the money loop: one question, one sentence of
// reasoning, the deterministic evidence behind "See the details", and
// exactly two choices. "Always allow this" rides the approval so the
// graduation is itself a ledgered decision (0206).
function AgentActionCard({
  event,
  gymId,
}: {
  event: TimelineEvent;
  gymId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [always, setAlways] = useState(false);
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const qc = useQueryClient();

  const payload = ((event.detail.payload ?? {}) as Record<string, unknown>);
  const kind = typeof event.detail.action_kind === 'string' ? event.detail.action_kind : '';
  const isOffer = kind === 'plan_adjustment_offer';
  const evidence = Array.isArray(event.detail.evidence)
    ? (event.detail.evidence as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];
  const memberName =
    typeof payload.member_name === 'string' && payload.member_name
      ? payload.member_name
      : event.subject;
  const first = memberName.trim().split(/\s+/)[0] || 'them';
  const offerPlan =
    typeof payload.offer_plan_name === 'string' ? payload.offer_plan_name : null;
  const offerPrice =
    typeof payload.offer_price === 'string' ? payload.offer_price : null;
  const actionId = event.item_id.split(':')[1];

  const line = formatTimelineLine(event);
  const reasoning = isOffer
    ? `Stripe has stopped trying${offerPlan ? ` — ${offerPlan}${offerPrice ? ` at ${offerPrice}` : ''} might keep them` : ''}.`
    : 'A friendly note with their pay link usually sorts it.';

  const decide = async (decision: 'approve' | 'reject') => {
    if (!actionId || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await supabase.rpc('decide_agent_action', {
        p_action_id: actionId,
        p_decision: decision,
        p_always_allow: decision === 'approve' && always,
      });
      if (error) throw error;
      setDecided(decision);
      qc.invalidateQueries({ queryKey: ['timeline-feed', gymId] });
      qc.invalidateQueries({ queryKey: ['agent-authority', gymId] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (decided) {
    return (
      <SoftLine
        tone="neutral"
        text={
          decided === 'approve'
            ? isOffer
              ? `Offered — ${first} has it in their inbox.`
              : `Sent — ${first} has the note.`
            : `Left alone — nothing was sent to ${first}.`
        }
      />
    );
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
      <Text className="text-gray-900 dark:text-gray-50 text-[15px] font-semibold leading-[22px]">
        {line.text}
      </Text>
      <Text className="text-gray-500 dark:text-gray-400 text-sm">{reasoning}</Text>
      {open ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-1.5">
          {evidence.map((s, i) => (
            <Text key={i} className="text-gray-700 dark:text-gray-200 text-sm">
              {s}
            </Text>
          ))}
          <Pressable
            onPress={() => setAlways((v) => !v)}
            className="flex-row items-center gap-2 pt-1.5"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: always }}>
            <Ionicons
              name={always ? 'checkbox' : 'square-outline'}
              size={18}
              color={always ? '#2563EB' : '#9CA3AF'}
            />
            <Text className="text-gray-700 dark:text-gray-200 text-sm">
              Always allow this — stop asking first
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button onPress={() => decide('approve')} loading={busy}>
            {isOffer ? 'Yes, offer it' : 'Yes, send it'}
          </Button>
        </View>
        <View className="flex-1">
          <Button variant="secondary" onPress={() => decide('reject')} disabled={busy}>
            No
          </Button>
        </View>
      </View>
      {!open ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={6}>
          <Text className="text-link text-sm font-semibold">See the details</Text>
        </Pressable>
      ) : null}
      {failed ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">
          That didn&apos;t go through — try again.
        </Text>
      ) : null}
    </View>
  );
}

// The stream's only standing card. One question, one sentence of context
// behind "See the details", exactly two choices with the yes labelled by
// the action — the loop-1 register, applied to the queue that already
// exists.
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
