import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '@/components/Button';
import { GymLogo } from '@/components/GymLogo';
import { joinUrl } from '@/lib/brand';
import {
  autoDetect as memberAutoDetect,
  buildImportRow,
  TEMPLE_FIELD_LABELS,
  type TempleField,
} from '@/lib/import/columns';
import { parseCsv } from '@/lib/import/csv';
import {
  overridesFrom,
  resolveMovements,
} from '@/lib/import/resolve-movements';
import {
  autoDetect as workoutAutoDetect,
  buildResults,
  type WorkoutField,
} from '@/lib/import/workout-columns';
import { InviteSection } from '@/components/InviteSection';
import {
  EMPTY_RECURRENCE,
  RecurrenceEditor,
  summariseRecurrence,
  validateRecurrence,
  type RecurrenceForm,
} from '@/components/RecurrenceEditor';
import { CustomRuleChip } from '@/components/CustomRuleValue';
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
  formatRuleValue,
  formatDays,
  currencySymbol,
  formatPrice,
  mergeRuleAnswers,
  nextRuleQuestion,
  RULE_FIELD_OPTIONS,
  RULE_QUESTIONS,
  ruleSentence,
  ruleSheet,
  sanitisePlans,
  sanitiseRuleChanges,
  sanitiseTimetable,
  timetableSummary,
  type PlansProposal,
  type RuleChoices,
  type RuleField,
  type TimetableProposal,
} from '@/lib/setup-flow';
import { useGymCurrency } from '@/lib/useGymCurrency';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';
import type { Json } from '@/types/database';

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
  | 'members'
  | 'workouts'
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
  | { kind: 'members-card'; open: boolean }
  | { kind: 'workouts-card'; open: boolean }
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
  members: {
    icon: 'cloud-upload-outline',
    label: 'Bring your members across',
    estimate: '3 min',
  },
  workouts: {
    icon: 'stats-chart-outline',
    label: 'Import workout history',
    estimate: '3 min',
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
    'Prices next: add each membership below — or describe them ("Unlimited is ¤89 with 30 days notice, an 8-class pack is ¤59") and I\'ll build them.',
  parq:
    'Before anyone can book, members sign something — upload your waiver as a PDF and they sign it in the app. One is enough; a PAR-Q can come later.',
  team:
    'That\u2019s the required list done. The last three are optional — first, invite your coaches so they can take classes and write programming.',
  members:
    'Coming from another platform? Bring your members across — a CSV of names, emails and plans, or pull them straight out of Stripe.',
  workouts:
    'Last one — if you have workout history, import it and members walk in to their own PRs and leaderboards rather than an empty app.',
  rules:
    'Next, a few rules — tap what fits, or say it in your own words if your answer isn\u2019t on the list. The first chip is what most gyms like yours do, and your classes will pick these up as their defaults.',
};

// Steps whose fast path is a tap. The bar never disappears, so a typed
// message gets pointed back at the card rather than meeting a dead input.
const GOLIVE_LINE = 'That’s the walk-through done.';

const TAP_ONLY: Partial<Record<Step, string>> = {
  logo: 'This one’s a tap — choose your logo above, or skip and we’ll move on.',
  stripe: 'Stripe needs its own secure page — tap Connect above, or do it later.',
  parq: 'This one’s a file — upload your waiver above, or skip it for now.',
  team: 'Pop a coach’s email in the box above, or skip if you run solo.',
  members:
    'The importer has its own screen for matching up your columns — tap above, or skip it.',
  workouts: 'Same again — the importer has its own screen; tap above, or skip it.',
  golive: 'Setup’s done — head into your gym, or pick up anything you left above.',
};

export default function SetupScreen() {
  const session = useSession();
  // Stripe's OAuth has to leave the app, so a failure comes back as a
  // param rather than a thrown error. A step that failed is not a step
  // that happened: progress still says it's open, so the script reopens
  // it, and this only adds the sentence saying why.
  const { stripe: stripeOutcome } = useLocalSearchParams<{ stripe?: string }>();
  const { data: membership } = useGymMembership();
  const role = useRole();
  const { data: profile } = useMyProfile();
  const brand = useGymBrand();
  const colors = useThemeColors();
  const currency = useGymCurrency();
  const gymTz = useGymOperatingDefaults().data?.timezone ?? 'UTC';
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
  // Steps the owner has already dealt with this session, finished or
  // skipped. Server progress says what's *done*, and that is the right
  // source of truth for the checklist — but it can lag behind what
  // actually happened. Importing 60 workout results for members who
  // haven't signed up yet stages every row and creates no
  // `tracked_workouts`, so `workouts_imported` stays false and the step
  // would be offered again forever. Having dealt with a step is its own
  // fact, and the conversation is the thing that knows it.
  const handled = useRef<Set<Step>>(new Set());
  // A CSV dropped on the wrong step travels to the right one rather than
  // being handed back with an error. Making someone find the file again
  // to fix a mistake the app already understood is the rudest possible
  // way to be correct.
  const handoff = useRef<{ csv: string; name: string | null } | null>(null);
  // Which rule question is on screen, so a typed answer reaches the
  // parser with the question it is answering.
  const openRuleQ = useRef<number | null>(null);

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
      'members',
      'workouts',
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
      if (s === 'members') return !doneKeys.has('members_imported');
      if (s === 'workouts') return !doneKeys.has('workouts_imported');
      return true;
    }).filter((s) => s === 'golive' || !handled.current.has(s));
  }

  function pushMsgs(...msgs: Msg[]) {
    setMessages((m) => [...m, ...msgs]);
  }

  function closeCards(m: Msg[]): Msg[] {
    return m.map((x) => ('open' in x ? { ...x, open: false } : x));
  }

  function advance(from: Step | null) {
    if (from) handled.current.add(from);
    openStep(stepsRemaining(from)[0] ?? 'golive');
  }

  // Opening a named step, rather than only the next one — the finish card
  // reopens whatever the owner left, in place.
  // ¤ is the generic currency sign: the prices step quotes example
  // amounts and they have to be in the gym's money, which Stripe sets one
  // step earlier.
  const ask = (step: Exclude<Step, 'golive'>) =>
    ASK[step].replace(/¤/g, currencySymbol(currency));

  function openStep(next: Step) {
    setStep(next);
    setMessages((m) => closeCards(m));
    if (next === 'golive') {
      // Reopening a step and finishing it lands back here, and the line
      // is a summary, not an event — saying it twice reads like the
      // conversation lost its place.
      setMessages((m) =>
        m.some((x) => x.kind === 'temple' && x.text === GOLIVE_LINE)
          ? m
          : [...m, { kind: 'temple', text: GOLIVE_LINE }],
      );
    } else if (next === 'rules') {
      ruleAnswers.current = {};
      openRuleQ.current = 0;
      pushMsgs(
        { kind: 'step-ask', step: 'rules', text: ask('rules') },
        { kind: 'rule-question', q: 0, open: true },
      );
    } else if (next === 'logo') {
      pushMsgs(
        { kind: 'step-ask', step: 'logo', text: ask('logo') },
        { kind: 'logo-card', open: true },
      );
    } else if (next === 'timetable') {
      pushMsgs(
        { kind: 'step-ask', step: 'timetable', text: ask('timetable') },
        { kind: 'class-builder', open: true },
      );
    } else if (next === 'stripe') {
      pushMsgs(
        { kind: 'step-ask', step: 'stripe', text: ask('stripe') },
        { kind: 'stripe-card', open: true },
      );
    } else if (next === 'plans') {
      pushMsgs(
        { kind: 'step-ask', step: 'plans', text: ask('plans') },
        { kind: 'plan-builder', open: true },
      );
    } else if (next === 'parq') {
      pushMsgs(
        { kind: 'step-ask', step: 'parq', text: ask('parq') },
        { kind: 'waiver-card', open: true },
      );
    } else if (next === 'team') {
      pushMsgs(
        { kind: 'step-ask', step: 'team', text: ask('team') },
        { kind: 'team-card', open: true },
      );
    } else if (next === 'members') {
      pushMsgs(
        { kind: 'step-ask', step: 'members', text: ask('members') },
        { kind: 'members-card', open: true },
      );
    } else if (next === 'workouts') {
      pushMsgs(
        { kind: 'step-ask', step: 'workouts', text: ask('workouts') },
        { kind: 'workouts-card', open: true },
      );
    } else {
      pushMsgs({ kind: 'temple', text: ask(next) });
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
    if (stripeOutcome === 'error') {
      pushMsgs({
        kind: 'temple',
        text: 'Stripe didn’t connect — nothing was saved, so that step is still open. Worth another go; it usually just needs the right Stripe login.',
      });
    }
    advance(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.data, seeded, membership]);

  const parse = useMutation({
    mutationFn: async (args: {
      step: 'timetable' | 'plans' | 'change';
      text: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('parse-setup', {
        body: { gym_id: membership!.gymId, step: args.step, text: args.text },
      });
      if (error) throw error;
      return data as { proposal?: Record<string, unknown> };
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
    const nudge = TAP_ONLY[step];
    if (nudge) {
      setInput('');
      pushMsgs({ kind: 'mine', text }, { kind: 'temple', text: nudge });
      return;
    }
    setInput('');
    setMessages((m) => [...closeCards(m), { kind: 'mine', text }]);
    if (step === 'rules') {
      await answerRulesByText(text);
      return;
    }
    try {
      const res = await parse.mutateAsync({
        step: step === 'timetable' ? 'timetable' : 'plans',
        text,
      });
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
    applying.mutate(
      () => applyTimetable(supabase, membership!.gymId, gymTz, p),
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

  // Chips and typing feed the same draft, and a sentence can settle a
  // question that hasn't been asked yet, so the run always resumes at
  // whatever is still unanswered rather than the next one in line.
  function askRule() {
    const q = nextRuleQuestion(ruleAnswers.current);
    openRuleQ.current = q;
    if (q === null) {
      pushMsgs(
        {
          kind: 'temple',
          text: 'That’s the big five done. Everything else is set the way most gyms run it.',
        },
        { kind: 'rules-gate', open: true },
      );
      return;
    }
    pushMsgs({ kind: 'rule-question', q, open: true });
  }

  function answerRule(q: number, optionIndex: number) {
    const question = RULE_QUESTIONS[q];
    const option = question.options[optionIndex];
    (ruleAnswers.current as Record<string, unknown>)[question.id] = option.value;
    setMessages((m) => closeCards(m));
    pushMsgs({ kind: 'mine', text: option.label });
    askRule();
  }

  // The defaults already are what most gyms run, and they're already on
  // the gym row — so skipping writes nothing rather than writing the same
  // values back, and the step stays open for whenever they care.
  function skipRules() {
    setMessages((m) => closeCards(m));
    pushMsgs({
      kind: 'receipt',
      text: 'Left as they are — change any rule later by telling me.',
    });
    advance('rules');
  }

  function customRule(q: number, value: RuleChoices[RuleField]) {
    const question = RULE_QUESTIONS[q];
    (ruleAnswers.current as Record<string, unknown>)[question.id] = value;
    setMessages((m) => closeCards(m));
    pushMsgs({ kind: 'mine', text: formatRuleValue(question.id, value) });
    askRule();
  }

  // The chips are the fast path, not the only path. An answer that isn't
  // on the menu goes to the parser carrying the question it answers, so
  // "30 minutes before" can't be read as a booking cutoff when what was
  // asked about was cancelling. Nothing is written until the end of the
  // step, so a mis-read is visible in the read-back before it reaches the
  // gym — and the parser is told to name what it couldn't take rather
  // than round a typed answer onto the nearest chip.
  async function answerRulesByText(text: string) {
    const asked = openRuleQ.current;
    const current = mergeRuleAnswers(ruleAnswers.current);
    try {
      const res = await parse.mutateAsync({
        step: 'change',
        text: asked === null ? text : `${RULE_QUESTIONS[asked].prompt} ${text}`,
      });
      const p = res.proposal ?? {};
      const changes = Array.isArray(p.rule_changes)
        ? sanitiseRuleChanges({ changes: p.rule_changes }, current)
        : null;
      const cannot =
        typeof p.cannot === 'string' && p.cannot.trim() ? p.cannot.trim() : null;
      if (changes) {
        const next = { ...current };
        for (const c of changes) {
          (ruleAnswers.current as Record<string, unknown>)[c.field] = c.value;
          (next as Record<string, unknown>)[c.field] = c.value;
        }
        pushMsgs({
          kind: 'temple',
          text: `Taken as: ${changes.map((c) => ruleSentence(c.field, next)).join('. ')}.`,
        });
        if (cannot) {
          pushMsgs({
            kind: 'temple',
            text: `Not all of it, though — ${cannot} isn’t something I can set as one gym-wide rule.`,
          });
        }
      } else {
        pushMsgs({
          kind: 'temple',
          text: cannot
            ? `${cannot} isn’t one of these rules, so I’ve left it — pick what’s closest below and we can get exact later.`
            : 'I couldn’t map that onto one of these rules — tap what fits, or say it another way.',
        });
        // The cancel charge is the one rule here that lives on the class
        // type rather than the gym, so "different for the 6am" is a real
        // answer once there's a timetable — worth saying instead of
        // leaving them with three chips that don't fit.
        if (asked !== null && RULE_QUESTIONS[asked].id === 'late_cancel') {
          pushMsgs({
            kind: 'temple',
            text: 'This one is set per class type, so once your timetable is in you can give a single class its own rule.',
          });
        }
      }
    } catch {
      pushMsgs({
        kind: 'temple',
        text: 'I couldn’t work that out just now — tap an answer below instead.',
      });
    }
    askRule();
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
          pushMsgs({
            kind: 'receipt',
            step: 'rules',
            text: 'Rules set. Change any of them later by telling me.',
          });
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
                <Text className="text-ink dark:text-ink-dk font-semibold text-[15px]">
                  {brand.gymName}
                </Text>
              </View>
            </View>
            <View className="items-end gap-0.5">
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                {requiredDoneCount} of {REQUIRED_SETUP_KEYS.length} done
              </Text>
              <Pressable onPress={() => router.replace('/onboarding')} hitSlop={6}>
                <Text className="text-link text-xs font-medium">Prefer the checklist?</Text>
              </Pressable>
            </View>
          </View>
          <View className="h-1.5 rounded-full bg-raised dark:bg-raised-dk overflow-hidden">
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
                    pushMsgs({ kind: 'receipt', step: 'logo', text: receipt });
                    advance('logo');
                  }}
                  onSkip={() => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({
                      kind: 'receipt',
                      text: 'No logo for now — add it any time; the checklist keeps the step open.',
                    });
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
                  onSkip={() => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({
                      kind: 'receipt',
                      text: 'No classes yet — members can’t book until there are, so it’s worth coming back to.',
                    });
                    advance('timetable');
                  }}
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
                      text: 'Stripe can wait — plans become buyable once it’s connected.',
                    });
                    advance('stripe');
                  }}
                />
              ) : null
            ) : m.kind === 'plan-builder' ? (
              m.open ? (
                <PlanBuilderCard
                  key={i}
                  busy={busy}
                  onApply={confirmPlans}
                  onSkip={() => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({
                      kind: 'receipt',
                      text: 'No prices yet — nobody can subscribe until there’s a plan to buy.',
                    });
                    advance('plans');
                  }}
                />
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
                  onSkip={() => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({
                      kind: 'receipt',
                      text: 'Health screening skipped — members can’t book until one is published.',
                    });
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
                    pushMsgs({ kind: 'receipt', text: receipt });
                    advance('team');
                  }}
                />
              ) : null
            ) : m.kind === 'members-card' ? (
              m.open ? (
                <MembersImportCard
                  key={i}
                  gymId={membership.gymId}
                  initial={handoff.current}
                  stripeConnected={doneKeys.has('stripe')}
                  onDone={(receipt) => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({ kind: 'receipt', step: 'members', text: receipt });
                    advance('members');
                  }}
                  onSkip={() => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({
                      kind: 'receipt',
                      text: 'Starting fresh — members join themselves from your link.',
                    });
                    advance('members');
                  }}
                />
              ) : null
            ) : m.kind === 'workouts-card' ? (
              m.open ? (
                <WorkoutsImportCard
                  key={i}
                  gymId={membership.gymId}
                  onWrongStep={(csv, name) => {
                    handoff.current = { csv, name };
                    handled.current.delete('members');
                    openStep('members');
                  }}
                  onDone={(receipt) => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({ kind: 'receipt', step: 'workouts', text: receipt });
                    advance('workouts');
                  }}
                  onSkip={() => {
                    setMessages((prev) => closeCards(prev));
                    pushMsgs({
                      kind: 'receipt',
                      text: 'No history to bring — members start logging from day one.',
                    });
                    advance('workouts');
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
                onCustomRule={customRule}
                onSkipRules={skipRules}
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
              onReopen={openStep}
              handled={handled.current}
            />
          ) : null}

          {busy ? (
            <View className="flex-row items-center gap-2 pl-9">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Working on it…</Text>
            </View>
          ) : null}
        </ScrollView>

        {step !== null ? (
          <View className="px-4 pb-4 pt-1 md:max-w-2xl md:mx-auto md:w-full">
            <View className="flex-row items-center gap-2 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-full pl-4 pr-1.5 py-1.5 shadow-card">
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!busy}
                placeholder="Type it like you'd say it…"
                placeholderTextColor="#9CA3AF"
                multiline
                className="flex-1 text-ink dark:text-ink-dk text-[15px] max-h-24 py-1.5"
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

// Every step needs a way past it, and it has to be there the whole time —
// not only before you've engaged with the card. Picking a CSV and then
// deciding against importing it is an ordinary thing to do, and the first
// version of the import cards dropped the skip the moment a file loaded,
// which left the owner with no move except closing the tab. Same shape and
// same place on every card so it's findable without reading.
function StepSkip({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6}>
      <Text className="text-ink-3 dark:text-ink-3-dk text-sm text-center">
        {label}
      </Text>
    </Pressable>
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
  onCustomRule,
  onSkipRules,
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
  onCustomRule: (q: number, value: RuleChoices[RuleField]) => void;
  onSkipRules: () => void;
  onEditRule: (field: RuleField, value: RuleChoices[RuleField]) => void;
  onCarryOn: () => void;
  onHaveALook: () => void;
  onReword: () => void;
}) {
  const accent = useThemeColors().primary;
  const currency = useGymCurrency();
  // Rendered by the parent's special cases, never here.
  if (
    msg.kind === 'logo-card' ||
    msg.kind === 'class-builder' ||
    msg.kind === 'stripe-card' ||
    msg.kind === 'plan-builder' ||
    msg.kind === 'waiver-card' ||
    msg.kind === 'team-card' ||
    msg.kind === 'members-card' ||
    msg.kind === 'workouts-card'
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
        <Text className="flex-1 text-ink dark:text-ink-dk text-[15px] leading-6">
          {msg.text}
        </Text>
      </View>
    );
  }
  // A finished step reads exactly like a ticked checklist row: emerald
  // disk, the step's own label struck through, the outcome beneath. A
  // skipped one carries no step and so gets no struck label — the strike
  // means done, and the finish card lists the rest.
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
            <Text className="text-ink-3 dark:text-ink-3-dk text-[13px] font-medium line-through">
              {meta.label}
            </Text>
          ) : null}
          <Text className="text-ink-2 dark:text-ink-2-dk text-[13px]">
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
            <Text className="text-ink dark:text-ink-dk text-[13px] font-semibold">
              {meta.label}
            </Text>
            <Text className="text-ink-3 dark:text-ink-3-dk text-[10px] font-mono">
              ~{meta.estimate}
            </Text>
          </View>
          <Text className="text-ink-2 dark:text-ink-2-dk text-[15px] leading-5">
            {msg.text}
          </Text>
        </View>
      </View>
    );
  }

  const card = (children: React.ReactNode, confirmLabel: string, onConfirm: () => void) => (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
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
            <Text className="text-ink dark:text-ink-dk text-sm font-semibold">
              {s.class_type}
            </Text>
            <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-[13px]">
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
            className={`flex-row items-baseline gap-2 py-2 ${i > 0 ? 'border-t border-line dark:border-line-dk' : ''}`}>
            <Text className="text-ink dark:text-ink-dk text-[15px] font-semibold">{p.name}</Text>
            <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-[12.5px]">
              {p.blurb}
              {p.notice_period_days ? `${p.blurb ? ' · ' : ''}${p.notice_period_days} days notice` : ''}
            </Text>
            <Text className="text-ink dark:text-ink-dk text-[15px] font-semibold">
              {formatPrice(p.monthly_price_cents, currency)}
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
    return (
      <RuleQuestion
        msg={msg}
        onAnswer={onAnswerRule}
        onCustom={onCustomRule}
        onSkipAll={onSkipRules}
      />
    );
  }
  return (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
      <RuleSheet choices={msg.choices} editable={msg.open} onEdit={onEditRule} />
      {msg.open ? (
        <Button onPress={() => onConfirmRules(msg.choices)} loading={busy}>
          Use these
        </Button>
      ) : null}
    </View>
  );
}

// Every step is offered in the conversation, so the finish is only about
// what the owner chose to leave — and picking one up reopens that step
// here rather than sending them to a Manage page. Leaving the chat to
// finish a chat step was the whole thing we were trying not to do.
const FINISH_ROWS: { key: string; step: Exclude<Step, 'golive'> }[] = [
  { key: 'logo', step: 'logo' },
  { key: 'settings', step: 'rules' },
  { key: 'class_type_and_schedule', step: 'timetable' },
  { key: 'parq', step: 'parq' },
  { key: 'stripe', step: 'stripe' },
  { key: 'plan', step: 'plans' },
  { key: 'team', step: 'team' },
  { key: 'members_imported', step: 'members' },
  { key: 'workouts_imported', step: 'workouts' },
];

// A rule question: the presets as chips, plus "Something else" wherever
// the field takes a value the presets don't cover — which is most of
// them, since the columns behind these hold any number and any time.
function RuleQuestion({
  msg,
  onAnswer,
  onCustom,
  onSkipAll,
}: {
  msg: Extract<Msg, { kind: 'rule-question' }>;
  onAnswer: (q: number, optionIndex: number) => void;
  onCustom: (q: number, value: RuleChoices[RuleField]) => void;
  onSkipAll: () => void;
}) {
  const q = RULE_QUESTIONS[msg.q];
  return (
    <View className="gap-2.5">
      <View className="flex-row gap-2.5 pr-7">
        <TempleAvatar />
        <Text className="flex-1 text-ink dark:text-ink-dk text-[15px] leading-6">
          {q.prompt}
        </Text>
      </View>
      {msg.open ? (
        <View className="flex-row flex-wrap items-start gap-2 pl-9">
          {q.options.map((o, i) => (
            <Pressable
              key={o.label}
              onPress={() => onAnswer(msg.q, i)}
              className={`px-4 py-2.5 rounded-full border active:opacity-70 ${
                i === 0
                  ? 'bg-primary border-primary'
                  : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
              }`}>
              <Text
                className={`text-sm font-semibold ${
                  i === 0 ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                }`}>
                {o.label}
              </Text>
            </Pressable>
          ))}
          <CustomRuleChip field={q.id} onSet={(v) => onCustom(msg.q, v)} />
        </View>
      ) : null}
      {msg.open ? (
        <View className="pl-9">
          <StepSkip label="These are all fine as they are" onPress={onSkipAll} />
        </View>
      ) : null}
    </View>
  );
}

function GoLive({
  doneKeys,
  allDone,
  finishing,
  onFinish,
  onReopen,
  handled,
}: {
  doneKeys: Set<string>;
  allDone: boolean;
  finishing: boolean;
  onFinish: () => void;
  onReopen: (step: Exclude<Step, 'golive'>) => void;
  handled: Set<Step>;
}) {
  const left = FINISH_ROWS.filter(
    (r) => !doneKeys.has(r.key) && !handled.has(r.step),
  );
  return (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
        {left.length === 0
          ? 'Everything’s set. Members can find you, book, sign and pay.'
          : 'You left these — each one is a couple of taps whenever you want it.'}
      </Text>
      {left.map((it) => (
        <Pressable
          key={it.key}
          onPress={() => onReopen(it.step)}
          className="flex-row items-center gap-2.5 active:opacity-70">
          <Ionicons name="ellipse-outline" size={20} color="#9CA3AF" />
          <Text className="flex-1 text-[15px] font-medium text-ink dark:text-ink-dk">
            {STEP_META[it.step].label}
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

// "Full name (single column)" earns its parenthetical in a mapping table
// and loses it in a sentence.
function shortFieldLabel(f: TempleField): string {
  return TEMPLE_FIELD_LABELS[f].replace(/\s*\(.*\)$/, '');
}

// The columns autoDetect didn't place.
//
// The first version put every one of them on screen as a chip, next to a
// second, identically-styled cloud of Temple fields — twenty-five chips
// with nothing to say which list was which, and nine address columns
// shouting as loudly as the one column that's actually required. So:
// exactly one list is visible at a time, each under a heading that says
// what it is, and the required column is the only loud thing here. An
// export full of postcodes and country codes needs no decision from
// anyone, and it now takes one line to say so.
function ColumnMapper({
  unmatched,
  used,
  hasEmail,
  onAssign,
}: {
  unmatched: { h: string; i: number }[];
  used: Set<TempleField>;
  hasEmail: boolean;
  onAssign: (index: number, field: TempleField) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assigning, setAssigning] = useState<number | null>(null);
  if (unmatched.length === 0) return null;

  const name = (u: { h: string; i: number }) => u.h || `Column ${u.i + 1}`;

  const columnChips = (
    <View className="flex-row flex-wrap items-start gap-1.5">
      {unmatched.map((u) => (
        <Pressable
          key={u.i}
          onPress={() =>
            hasEmail ? setAssigning(u.i) : onAssign(u.i, 'email')
          }
          className="px-3 py-1.5 rounded-full border border-dashed border-line-strong dark:border-line-strong-dk active:opacity-70">
          <Text className="text-[13px] font-semibold text-ink-2 dark:text-ink-2-dk">
            {name(u)}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  // No email is a blocker, so it never hides behind a disclosure — and
  // tapping a column assigns it straight away rather than opening a
  // picker whose answer we already know.
  if (!hasEmail) {
    return (
      <View className="gap-2">
        <Text className="text-red-600 dark:text-red-400 text-[13px] leading-5">
          I need an email column — every row hangs off it. Tap the one that
          holds it.
        </Text>
        {columnChips}
      </View>
    );
  }

  if (!expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} hitSlop={4}>
        <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
          {unmatched.length} other column{unmatched.length === 1 ? '' : 's'}{' '}
          ignored — <Text className="text-link font-medium">bring one in</Text>
        </Text>
      </Pressable>
    );
  }

  if (assigning !== null) {
    const col = unmatched.find((u) => u.i === assigning);
    return (
      <View className="gap-2">
        <Text className="text-ink-2 dark:text-ink-2-dk text-[12.5px]">
          Bring “{col ? name(col) : ''}” in as…
        </Text>
        <View className="flex-row flex-wrap items-start gap-1.5">
          {(Object.keys(TEMPLE_FIELD_LABELS) as TempleField[])
            .filter((f) => !used.has(f))
            .map((f) => (
              <Pressable
                key={f}
                onPress={() => {
                  onAssign(assigning, f);
                  setAssigning(null);
                }}
                className="px-3 py-1.5 rounded-full border border-line dark:border-line-dk bg-raised dark:bg-raised-dk active:opacity-70">
                <Text className="text-[13px] font-semibold text-gray-700 dark:text-gray-300">
                  {TEMPLE_FIELD_LABELS[f]}
                </Text>
              </Pressable>
            ))}
        </View>
        <Pressable onPress={() => setAssigning(null)} hitSlop={6}>
          <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
            Pick a different column
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-2">
      <Text className="text-ink-2 dark:text-ink-2-dk text-[12.5px]">
        Which one do you want?
      </Text>
      {columnChips}
      <Pressable onPress={() => setExpanded(false)} hitSlop={6}>
        <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px]">
          Leave them out
        </Text>
      </Pressable>
    </View>
  );
}

// The member-import step, in the conversation. The wizard's judgement
// work — plan mapping, cross-gym inference, the Stripe double-bill guard
// — keeps its screen for the fussy cases, but the ordinary path is a file
// and a confirm, so it runs here over the same libs: parseCsv reads it,
// autoDetect matches the columns, buildImportRow shapes each row, and
// import_pending_members stages them. Staging only: nobody is charged and
// nobody is emailed until the owner says so.
function MembersImportCard({
  gymId,
  stripeConnected,
  onDone,
  onSkip,
  initial,
}: {
  gymId: string;
  stripeConnected: boolean;
  onDone: (receipt: string) => void;
  onSkip: () => void;
  // A file the workout step recognised as a member list and sent here.
  initial?: { csv: string; name: string | null } | null;
}) {
  const queryClient = useQueryClient();
  const [paste, setPaste] = useState('');
  const [file, setFile] = useState<{
    name: string | null;
    headers: string[];
    rows: string[][];
  } | null>(null);
  const [mapping, setMapping] = useState<(TempleField | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tookInitial = useRef(false);

  function take(text: string, name: string | null) {
    const grid = parseCsv(text);
    const headers = (grid[0] ?? []).map((h) => h.trim());
    const rows = grid.slice(1).filter((r) => r.some((c) => c.trim()));
    if (headers.length === 0 || rows.length === 0) {
      setError('That file had no rows I could read — headers in the first row.');
      return;
    }
    setError(null);
    setFile({ name, headers, rows });
    setMapping(memberAutoDetect(headers));
  }

  const pick = useMutation({
    mutationFn: async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const text = await (await fetch(asset.uri)).text();
      take(text, asset.name ?? null);
    },
    onError: () => setError("I couldn't read that file — a .csv export works best."),
  });

  // Once, on the way in: a file the workout step recognised as a member
  // list arrives already parsed. In an effect rather than in render —
  // take() sets four pieces of state and doing that mid-render is a
  // re-entrancy bug waiting for a slower device.
  useEffect(() => {
    if (!initial || tookInitial.current) return;
    tookInitial.current = true;
    take(initial.csv, initial.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const commit = useMutation({
    mutationFn: async () => {
      const built = file!.rows
        .map((cells) => buildImportRow(file!.headers, mapping, cells))
        .filter((r) => typeof r.email === 'string' && (r.email as string).length > 0);
      if (built.length === 0) throw new Error('no rows');
      const { data, error: e } = await supabase.rpc('import_pending_members', {
        p_gym_id: gymId,
        p_rows: built as unknown as Json,
      });
      if (e) throw e;
      const result = ((data ?? []) as { inserted: number; updated: number; skipped: number }[])[0];
      // The join link is what the owner needs next — staged rows link
      // themselves to a member when that member signs up through it.
      const { data: gym } = await supabase
        .from('gyms')
        .select('slug')
        .eq('id', gymId)
        .single();
      return { result, slug: (gym as { slug: string } | null)?.slug ?? null };
    },
    onSuccess: ({ result, slug }) => {
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
      queryClient.invalidateQueries({ queryKey: ['members-pending'] });
      const n = result?.inserted ?? 0;
      const skipped = result?.skipped ?? 0;
      // Nothing staged is not a completed step, whatever the RPC's exit
      // code says — every row was a duplicate or was rejected. Say so and
      // leave the card open rather than ticking it off.
      if (n === 0) {
        setError(
          skipped > 0
            ? `Nothing new — all ${skipped} of those are already here. Try a different export, or skip this step.`
            : 'Nothing came through. Check the email column is the right one, or try the full importer.',
        );
        return;
      }
      const origin =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.origin
          : 'https://app.jointemple.io';
      onDone(
        `${n} member${n === 1 ? '' : 's'} brought across${
          skipped > 0 ? `, ${skipped} already here` : ''
        }. They link to their history when they join${slug ? ` at ${joinUrl(origin, slug)}` : ''}.`,
      );
    },
    onError: () =>
      setError(
        'That didn’t save — check there’s an email in every row, or use the full importer.',
      ),
  });

  const used = new Set(mapping.filter(Boolean) as TempleField[]);
  const matched = file
    ? file.headers
        .map((h, i) => ({ h, f: mapping[i] }))
        .filter((x): x is { h: string; f: TempleField } => x.f !== null)
    : [];
  const unmatched = file
    ? file.headers.map((h, i) => ({ h, i })).filter((x) => mapping[x.i] === null)
    : [];
  const hasEmail = used.has('email');

  if (!file) {
    return (
      <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
          Export a CSV from wherever you are now — Mindbody, PushPress, Glofox,
          Wodify, a spreadsheet. I’ll match the columns and show you everything
          before a single row is saved.
        </Text>
        {stripeConnected ? (
          <Text className="text-amber-700 dark:text-amber-400 text-[13px] leading-5">
            If any of these already pay you through Stripe, bring those across
            from Stripe first — their subscription carries over and nobody gets
            billed twice.
          </Text>
        ) : null}
        {error ? (
          <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        <Button onPress={() => pick.mutate()} loading={pick.isPending}>
          Choose your CSV
        </Button>
        <TextInput
          value={paste}
          onChangeText={setPaste}
          onBlur={() => paste.trim() && take(paste, null)}
          multiline
          placeholder="…or paste it here: Email,First Name,Last Name,Plan"
          placeholderTextColor="#9CA3AF"
          className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 h-20 text-ink dark:text-ink-dk text-[13px]"
        />
        {/* The only step that deliberately keeps a screen. A CSV only
            stages rows — nobody is charged and nothing is adopted — but
            pulling from Stripe creates plans and takes over live
            subscriptions, so every price needs a decision and every
            decision is somebody's money. That review belongs on a page,
            and saying so is better than pretending it's the same job. */}
        {stripeConnected ? (
          <Pressable
            onPress={() =>
              router.push('/management/members/import-stripe?backTo=setup' as never)
            }
            hitSlop={6}>
            <Text className="text-link text-sm font-medium text-center">
              Already charging them on Stripe? Adopt those subscriptions
            </Text>
          </Pressable>
        ) : null}
        <StepSkip label="I’m starting fresh" onPress={onSkip} />
      </View>
    );
  }

  return (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
      <Text className="text-ink dark:text-ink-dk text-[15px] font-semibold">
        {file.rows.length} {file.rows.length === 1 ? 'row' : 'rows'}
        {file.name ? ` in ${file.name}` : ''}
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-[13px] leading-5">
        Matched: {matched.map((m) => shortFieldLabel(m.f)).join(', ')}
      </Text>

      <ColumnMapper
        unmatched={unmatched}
        used={used}
        hasEmail={hasEmail}
        onAssign={(index, field) =>
          setMapping((m) => m.map((x, i) => (i === index ? field : x)))
        }
      />

      <Text className="text-ink-2 dark:text-ink-2-dk text-[13px] leading-5">
        Nobody is charged and nobody is emailed. Each row waits until that
        person signs up, then attaches itself to them.
      </Text>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button
        onPress={() => commit.mutate()}
        disabled={!hasEmail || commit.isPending}
        loading={commit.isPending}>
        {hasEmail
          ? `Bring ${file.rows.length} across`
          : 'Pick the email column first'}
      </Button>
      <Pressable
        onPress={() => {
          setFile(null);
          setPaste('');
          setError(null);
        }}
        hitSlop={6}>
        <Text className="text-ink-3 dark:text-ink-3-dk text-sm text-center">
          Use a different file
        </Text>
      </Pressable>
      <StepSkip label="I’m starting fresh" onPress={onSkip} />
      <Pressable
        onPress={() => router.push('/management/members/import?backTo=setup' as never)}
        hitSlop={6}>
        <Text className="text-ink-3 dark:text-ink-3-dk text-[13px] text-center">
          Plans to map or duplicates to sort? Open the full importer
        </Text>
      </Pressable>
    </View>
  );
}

// The workout-history step, in the conversation. Same shape as the member
// import over the same wizard libs: parseCsv reads it, workout autoDetect
// matches the columns, buildResults sorts every row into weighted lifts /
// scored WODs / Hyrox splits, and the three import RPCs take them.
//
// Movement names are the one genuinely hard part — an old platform's
// "Bench Press (BB)" has to become Temple's `bench_press` — so the card
// does what the screen did: asks the resolver, applies what it's confident
// about, and says plainly what's left. Anything unresolved is staged by
// the RPC rather than dropped, so the import is never all-or-nothing.
function WorkoutsImportCard({
  gymId,
  onDone,
  onSkip,
  onWrongStep,
}: {
  gymId: string;
  onDone: (receipt: string) => void;
  onSkip: () => void;
  onWrongStep: (csv: string, name: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [paste, setPaste] = useState('');
  const [file, setFile] = useState<{
    name: string | null;
    raw: string;
    headers: string[];
    rows: string[][];
  } | null>(null);
  const [mapping, setMapping] = useState<(WorkoutField | null)[]>([]);
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the gym has anybody at all, member or pending. It's the
  // difference between "bring your members across first" and "you did —
  // these just aren't them", and only one of those is useful advice.
  const roster = useQuery({
    queryKey: ['setup-roster-count', gymId],
    queryFn: async () => {
      const [m, p] = await Promise.all([
        supabase
          .from('gym_memberships')
          .select('profile_id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .is('left_at', null),
        supabase
          .from('pending_members')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId),
      ]);
      return (m.count ?? 0) + (p.count ?? 0);
    },
  });
  const memberCount = roster.data ?? 0;

  function take(text: string, name: string | null) {
    const grid = parseCsv(text);
    const headers = (grid[0] ?? []).map((h) => h.trim());
    const rows = grid.slice(1).filter((r) => r.some((c) => c.trim()));
    if (headers.length === 0 || rows.length === 0) {
      setError('That file had no rows I could read — headers in the first row.');
      return;
    }
    setError(null);
    setOverrides(new Map());
    setResolved(false);
    setFile({ name, raw: text, headers, rows });
    setMapping(workoutAutoDetect(headers));
  }

  const pick = useMutation({
    mutationFn: async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const text = await (await fetch(asset.uri)).text();
      take(text, asset.name ?? null);
    },
    onError: () => setError("I couldn't read that file — a .csv export works best."),
  });

  const built = file
    ? buildResults(file.headers, mapping, file.rows, overrides)
    : null;
  const missNames = built
    ? [...new Set(built.misses.map((m) => m.value))].sort()
    : [];
  const ready = built
    ? built.weighted.length + built.sections.length + built.hyrox.length
    : 0;

  const resolve = useMutation({
    mutationFn: () => resolveMovements(gymId, missNames),
    onSuccess: (resolutions) => {
      setResolved(true);
      if (resolutions.length > 0) setOverrides(overridesFrom(resolutions));
    },
    onError: () => setResolved(true),
  });

  const commit = useMutation({
    mutationFn: async () => {
      const acc = { workouts: 0, results: 0, staged: 0, noMember: 0, noMovement: 0 };
      const add = (row: Record<string, number> | undefined) => {
        if (!row) return;
        acc.workouts += row.inserted_workouts ?? 0;
        acc.results +=
          (row.inserted_results ?? 0) + (row.inserted_sections ?? 0);
        acc.staged += row.staged ?? 0;
        acc.noMember += row.skipped_no_member ?? 0;
        acc.noMovement += row.skipped_no_movement ?? 0;
      };
      const run = async (fn: string, rows: unknown[]) => {
        if (rows.length === 0) return;
        const { data, error: e } = await supabase.rpc(fn as 'import_member_workouts', {
          p_gym_id: gymId,
          p_rows: rows as unknown as Json,
        });
        if (e) throw e;
        add((data ?? [])[0] as unknown as Record<string, number> | undefined);
      };
      await run('import_member_workouts', built!.weighted);
      await run('import_member_results', built!.sections);
      await run('import_member_hyrox_results', built!.hyrox);
      return acc;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
      // Nothing landed is not a finished step, whatever the RPCs returned.
      if (r.workouts === 0 && r.results === 0 && r.staged === 0) {
        if (r.noMember > 0) {
          // "Bring your members across first" is the wrong advice when they
          // already have — it just isn't these people. Naming the emails
          // makes a mismatched export obvious in one glance, which a count
          // never does.
          const emails = [...new Set(
            file!.rows
              .map((c) => c[file!.headers.findIndex((_, i) => mapping[i] === 'email')] ?? '')
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean),
          )];
          const shown = emails.slice(0, 2).join(', ');
          setError(
            memberCount === 0
              ? `Nobody's in your gym yet, so there's nothing for these ${r.noMember} results to attach to. Bring your members across first — then this file will land.`
              : `None of these emails are in your gym — not as members, not as pending imports${shown ? ` (${shown}…)` : ''}. ${emails.length} ${emails.length === 1 ? 'person' : 'people'} here, and none of them match the ones you brought across. Different export?`,
          );
        } else {
          setError('Nothing came through. Check the email and date columns are the right ones.');
        }
        return;
      }
      const bits: string[] = [];
      if (r.results > 0 || r.workouts > 0) {
        bits.push(
          `${r.results} result${r.results === 1 ? '' : 's'} across ${r.workouts} workout${r.workouts === 1 ? '' : 's'}`,
        );
      }
      // Every row staged and nothing inserted is the normal outcome before
      // anyone has signed up, so it leads the sentence rather than trailing
      // "0 results across 0 workouts", which reads like it failed.
      if (r.staged > 0) {
        bits.push(
          bits.length === 0
            ? `${r.staged} result${r.staged === 1 ? '' : 's'} held — each one attaches to its member the moment they join`
            : `${r.staged} held for members who haven't joined yet`,
        );
      }
      if (r.noMember > 0) bits.push(`${r.noMember} skipped — no member with that email`);
      if (r.noMovement > 0) bits.push(`${r.noMovement} skipped — movement I couldn't place`);
      onDone(`${bits.join('. ')}.`);
    },
    onError: () => setError('That didn’t save — try again, or use the full importer.'),
  });

  if (!file) {
    return (
      <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
          One row per result — weighted lifts, WODs scored for time or AMRAP,
          Hyrox splits. Members open the app to their own PRs and leaderboards
          rather than an empty history.
        </Text>
        {error ? (
          <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        <Button onPress={() => pick.mutate()} loading={pick.isPending}>
          Choose your CSV
        </Button>
        <TextInput
          value={paste}
          onChangeText={setPaste}
          onBlur={() => paste.trim() && take(paste, null)}
          multiline
          placeholder="…or paste it here: email,date,movement,weight,reps,unit"
          placeholderTextColor="#9CA3AF"
          className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 h-20 text-ink dark:text-ink-dk text-[13px]"
        />
        <StepSkip label="Nothing to bring across" onPress={onSkip} />
      </View>
    );
  }

  // Nothing readable as a result is usually not a broken workout export —
  // it's the member list, dropped one step too late. The columns say so
  // plainly, so read them rather than blaming the movement column.
  const looksLikeMembers =
    ready === 0 &&
    (() => {
      const asMembers = memberAutoDetect(file!.headers).filter(Boolean);
      return (
        asMembers.includes('email') &&
        asMembers.length >= 4 &&
        !asMembers.includes('notes')
      );
    })();

  const kinds = [
    built!.weighted.length > 0 ? `${built!.weighted.length} lifts` : null,
    built!.sections.length > 0 ? `${built!.sections.length} scored WODs` : null,
    built!.hyrox.length > 0 ? `${built!.hyrox.length} Hyrox results` : null,
  ].filter(Boolean);

  return (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
      <Text className="text-ink dark:text-ink-dk text-[15px] font-semibold">
        {file.rows.length} {file.rows.length === 1 ? 'row' : 'rows'}
        {file.name ? ` in ${file.name}` : ''}
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-[13px] leading-5">
        {kinds.length > 0
          ? `Ready: ${kinds.join(', ')}.${
              built!.deferred > 0
                ? ` ${built!.deferred} row${built!.deferred === 1 ? '' : 's'} left out — an 8×1km run total and Roxzone transitions aren't single stations, so there's no PB for them to be.`
                : ''
            }`
          : looksLikeMembers
            ? 'That’s your member list, not workout history — names, emails and plans, no dates or movements. It belongs in the step before this one.'
            : 'I couldn’t read any results out of that — a workout file needs a date, a movement and a score or weight per row.'}
      </Text>

      {looksLikeMembers ? (
        <Button onPress={() => onWrongStep(file!.raw, file!.name)}>
          Bring them in as members instead
        </Button>
      ) : null}

      {missNames.length > 0 ? (
        <View className="gap-2">
          <Text className="text-ink-2 dark:text-ink-2-dk text-[12.5px] leading-5">
            {missNames.length} movement{missNames.length === 1 ? '' : 's'} I don’t
            recognise: {missNames.slice(0, 6).join(', ')}
            {missNames.length > 6 ? `, +${missNames.length - 6} more` : ''}.
          </Text>
          {resolved ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-[12.5px] leading-5">
              Still unplaced — those rows get held rather than dropped, and you
              can name them later on the full importer.
            </Text>
          ) : (
            <Button
              variant="secondary"
              onPress={() => resolve.mutate()}
              loading={resolve.isPending}>
              Match them for me
            </Button>
          )}
        </View>
      ) : null}

      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button
        onPress={() => commit.mutate()}
        disabled={ready === 0 || commit.isPending}
        loading={commit.isPending}>
        {ready === 0 ? 'Nothing to import' : `Import ${ready} result${ready === 1 ? '' : 's'}`}
      </Button>
      <Pressable
        onPress={() => {
          setFile(null);
          setPaste('');
          setError(null);
        }}
        hitSlop={6}>
        <Text className="text-ink-3 dark:text-ink-3-dk text-sm text-center">
          Use a different file
        </Text>
      </Pressable>
      <StepSkip label="Nothing to bring across" onPress={onSkip} />
      <Pressable
        onPress={() =>
          router.push('/management/members/import-workouts?backTo=setup' as never)
        }
        hitSlop={6}>
        <Text className="text-ink-3 dark:text-ink-3-dk text-[13px] text-center">
          Movements to name by hand? Open the full importer
        </Text>
      </Pressable>
    </View>
  );
}

// The logo step: the branding screen's own picker, upload and
// set_gym_branding write, placed in the conversation. Skipping is a
// first-class answer — the checklist keeps the step open for later.
function LogoCard({
  gymId,
  onDone,
  onSkip,
}: {
  gymId: string;
  onDone: (receipt: string) => void;
  onSkip: () => void;
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
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
      <View className="flex-row items-center gap-3">
        <GymLogo size={56} logoUrl={preview} name="?" primaryColor="#2563EB" />
        <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm leading-5">
          Square works best — it becomes the app icon your members install.
        </Text>
      </View>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={() => upload.mutate()} loading={upload.isPending}>
        Choose your logo
      </Button>
      <StepSkip label="Skip for now" onPress={onSkip} disabled={upload.isPending} />
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
  onSkip,
}: {
  busy: boolean;
  onApply: (p: TimetableProposal) => void;
  onSkip: () => void;
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
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-4">
      {entries.length > 0 ? (
        <View className="gap-2">
          {entries.map((e, i) => (
            <View key={i} className="flex-row items-start gap-2.5">
              <View
                className="w-3 h-3 rounded-full mt-1"
                style={{ backgroundColor: e.color }}
              />
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-semibold text-sm">
                  {e.name}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {summariseRecurrence(e.form, weekStartsOn)}
                </Text>
              </View>
              <Pressable
                onPress={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                hitSlop={6}
                accessibilityLabel={`Remove ${e.name}`}>
                <Ionicons name="close" size={16} color={colors.ink2} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-1.5">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
          Class name
        </Text>
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="CrossFit"
              placeholderTextColor="#9CA3AF"
              className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk"
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
      <StepSkip label="I’ll add classes later" onPress={onSkip} disabled={busy} />
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
          window.sessionStorage.setItem('temple-setup-stripe', 'setup');
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
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
        Your own Stripe account takes the money and pays out to your bank.
        Card processing is Stripe's usual rate; Temple adds nothing on top and
        takes no cut of bookings.
      </Text>
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
        You'll sign in to Stripe (or create an account) and come straight back
        here. It takes about a minute.
      </Text>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={() => connect.mutate()} loading={connect.isPending}>
        Connect Stripe
      </Button>
      <StepSkip label="Do this later" onPress={onSkip} disabled={connect.isPending} />
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
  onSkip,
}: {
  busy: boolean;
  onApply: (p: PlansProposal) => void;
  onSkip: () => void;
}) {
  const colors = useThemeColors();
  const currency = useGymCurrency();
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
    const bits = [`${currencySymbol(currency)}${e.pounds}`];
    if (e.kind !== 'unlimited') bits.push(`${e.credits} classes`);
    if (e.kind !== 'credit_pack' && e.notice.trim() !== '' && e.notice !== '0') {
      bits.push(`${e.notice} days notice`);
    }
    return `${PLAN_KIND_LABEL[e.kind]} · ${bits.join(' · ')}`;
  }

  return (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-4">
      {entries.length > 0 ? (
        <View className="gap-2">
          {entries.map((e, i) => (
            <View key={i} className="flex-row items-start gap-2.5">
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dk font-semibold text-sm">
                  {e.name}
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  {entrySummary(e)}
                </Text>
              </View>
              <Pressable
                onPress={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                hitSlop={6}
                accessibilityLabel={`Remove ${e.name}`}>
                <Ionicons name="close" size={16} color={colors.ink2} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-1.5">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
          Plan name
        </Text>
        <TextInput
          value={draft.name}
          onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          placeholder="Unlimited"
          placeholderTextColor="#9CA3AF"
          className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk"
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
                  : 'bg-surface dark:bg-surface-dk border-line dark:border-line-dk'
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
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
            {draft.kind === 'credit_pack'
              ? `Price (${currencySymbol(currency)})`
              : `Price (${currencySymbol(currency)} / month)`}
          </Text>
          <TextInput
            value={draft.pounds}
            onChangeText={(pounds) => setDraft((d) => ({ ...d, pounds }))}
            placeholder="89"
            keyboardType="decimal-pad"
            placeholderTextColor="#9CA3AF"
            className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk"
          />
        </View>
        {creditKind ? (
          <View className="flex-1 gap-1.5">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
              Classes
            </Text>
            <TextInput
              value={draft.credits}
              onChangeText={(credits) => setDraft((d) => ({ ...d, credits }))}
              keyboardType="number-pad"
              placeholderTextColor="#9CA3AF"
              className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk"
            />
          </View>
        ) : null}
        {recurringKind ? (
          <View className="flex-1 gap-1.5">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
              Notice (days)
            </Text>
            <TextInput
              value={draft.notice}
              onChangeText={(notice) => setDraft((d) => ({ ...d, notice }))}
              keyboardType="number-pad"
              placeholderTextColor="#9CA3AF"
              className="bg-raised dark:bg-raised-dk border border-line dark:border-line-dk rounded-lg px-3 py-2.5 text-ink dark:text-ink-dk"
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
      <StepSkip label="I’ll set prices later" onPress={onSkip} disabled={busy} />
    </View>
  );
}

// The PAR-Q as the ACSM/PARmed-X screening seven, which is what a gym
// means when it says "a PAR-Q". Every one flags on yes: a yes is a
// conversation with a coach, not a refusal.
const STANDARD_PARQ = [
  'Has your doctor ever said that you have a heart condition, or that you should only do physical activity recommended by a doctor?',
  'Do you feel pain in your chest when you do physical activity?',
  'In the past month, have you had chest pain when you were not doing physical activity?',
  'Do you lose your balance because of dizziness, or do you ever lose consciousness?',
  'Do you have a bone or joint problem that could be made worse by a change in your physical activity?',
  'Is your doctor currently prescribing drugs for your blood pressure or a heart condition?',
  'Do you know of any other reason why you should not do physical activity?',
];

// The health-screening step: the same PDF pick → gym-waivers upload →
// publish_waiver path the health screening screen uses, in one tap. A
// PAR-Q questionnaire is the deeper surface and stays one tap away —
// one of the two satisfies the requirement.
function WaiverCard({
  gymId,
  onDone,
  onSkip,
}: {
  gymId: string;
  onDone: (receipt: string) => void;
  onSkip: () => void;
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

  // The other half of the step. A questionnaire is a builder screen when
  // the wording is yours, but the standard PAR-Q is seven fixed questions
  // every gym asks — so it's one tap here, on the same two inserts the
  // builder publishes with (version bumped, prior version left intact so
  // historical answers keep pointing at the wording the member saw).
  const parq = useMutation({
    mutationFn: async () => {
      const { data: userResp } = await supabase.auth.getUser();
      const userId = userResp?.user?.id;
      if (!userId) throw new Error('Missing context');
      const { data: prior } = await supabase
        .from('parq_questionnaires')
        .select('id, version')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .maybeSingle();
      const previous = prior as { id: string; version: number } | null;
      if (previous) {
        const { error: e1 } = await supabase
          .from('parq_questionnaires')
          .update({ is_active: false })
          .eq('id', previous.id);
        if (e1) throw e1;
      }
      const { data: inserted, error: e2 } = await supabase
        .from('parq_questionnaires')
        .insert({
          gym_id: gymId,
          version: (previous?.version ?? 0) + 1,
          is_active: true,
          published_by: userId,
        })
        .select('id')
        .single();
      if (e2 || !inserted) throw e2 ?? new Error('Could not publish');
      const { error: e3 } = await supabase.from('parq_questions').insert(
        STANDARD_PARQ.map((prompt, i) => ({
          questionnaire_id: (inserted as { id: string }).id,
          sort_order: i + 1,
          prompt,
          flag_on_yes: true,
        })),
      );
      if (e3) throw e3;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parq-active'] });
      queryClient.invalidateQueries({ queryKey: ['parq-questions'] });
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
      onDone(
        `Standard PAR-Q published — ${STANDARD_PARQ.length} questions, answered once before a member's first class.`,
      );
    },
    onError: () => setError('That didn’t publish — try again.'),
  });

  return (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
        A PDF is all it takes — members sign it with their finger in the app,
        and it’s kept as a liability record. Or ask the standard health
        questions instead; either one satisfies the step.
      </Text>
      {error ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">{error}</Text>
      ) : null}
      <Button onPress={() => upload.mutate()} loading={upload.isPending}>
        Upload your waiver
      </Button>
      <Button
        variant="secondary"
        onPress={() => parq.mutate()}
        loading={parq.isPending}
        disabled={upload.isPending}>
        Use the standard PAR-Q instead
      </Button>
      <Pressable
        onPress={() =>
          router.push(
            '/management?section=health-screening&backTo=setup' as never,
          )
        }
        hitSlop={6}>
        <Text className="text-ink-3 dark:text-ink-3-dk text-[13px] text-center">
          Own wording? Write your own questions
        </Text>
      </Pressable>
      <StepSkip label="Do this later" onPress={onSkip} disabled={upload.isPending} />
    </View>
  );
}

// The team step: the Team screen's own InviteSection, dropped into the
// conversation — same code minting the same single-use invite, same
// manual-link fallback when email isn't configured.
function TeamCard({ onDone }: { onDone: (receipt: string) => void }) {
  return (
    <View className="ml-9 bg-surface dark:bg-surface-dk rounded-2xl border border-line dark:border-line-dk shadow-card p-4 gap-3">
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
      <StepSkip
        label="I run solo"
        onPress={() => onDone('No invites for now — it’s a two-tap job whenever you need it.')}
      />
    </View>
  );
}
