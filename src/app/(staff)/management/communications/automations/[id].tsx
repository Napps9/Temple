import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { FieldLabel } from '@/components/SectionLabel';
import { EmailEditor } from '@/components/email/EmailEditor';
import { HtmlPreview } from '@/components/email/HtmlPreview';
import { useGymMembership, useSession } from '@/lib/auth';
import { FALLBACK_BRAND_SEED, coerceDocument, documentWarnings, starterDocument, type EmailDocument } from '@/lib/email/blocks';
import { knobToStorage, storageToKnob } from '@/lib/email/automation-knob';
import { useGymTagLabels } from '@/lib/comms';
import { renderEmailHtml, renderEmailText } from '@/lib/email/render';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { useThemeColors } from '@/lib/theme';
import type { Json } from '@/types/database';

import { TRIGGER_LABELS } from '@/components/email/AutomationList';

type TriggerType =
  | 'member_joined'
  | 'member_first_class'
  | 'member_inactive'
  | 'lead_cold'
  | 'member_tagged';

type AutomationRow = {
  id: string;
  gym_id: string;
  name: string;
  enabled: boolean;
  trigger_type: TriggerType;
  delay_minutes: number;
  params: { inactive_days?: number; cold_hours?: number; tag?: string } | null;
  conditions: AutomationConditions | null;
  send_hour: number | null;
  send_days: number[] | null;
  topic_id: string | null;
  subject: string;
  preheader: string;
  from_name: string | null;
  design: unknown;
  compiled_html: string | null;
};

type AutomationConditions = {
  plan_ids?: string[];
  class_type_ids?: string[];
  lead_source_ids?: string[];
};

const TRIGGER_BLURB: Record<TriggerType, string> = {
  member_joined: 'Welcome new members a few days after they sign up.',
  member_first_class: 'Follow up after someone attends their first class.',
  member_inactive: 'Win back a member who hasn’t attended in a while.',
  lead_cold: 'Nurture a prospect who enquired but hasn’t been contacted.',
  member_tagged:
    'Start a sequence when a member gains a tag — added by hand or by a tag rule.',
};

// The single timing knob each trigger exposes, and how it maps to storage.
const KNOB_UNIT: Record<TriggerType, string> = {
  member_joined: 'days after they join',
  member_first_class: 'days after their first class',
  member_inactive: 'days without attending',
  lead_cold: 'hours if still cold',
  member_tagged: 'days after they gain the tag',
};

type Topic = { id: string; label: string };
type Option = { id: string; label: string };

type StepRow = {
  id: string;
  step_index: number;
  delay_minutes: number;
  send_hour: number | null;
  send_days: number[] | null;
  subject: string;
  preheader: string;
  from_name: string | null;
  design: unknown;
  compiled_html: string | null;
};

// A follow-up email in the sequence. delay_minutes is measured from the
// trigger anchor (same clock as the primary), stored in days in the UI.
type StepState = {
  id: string;
  delayDays: number;
  sendHour: number | null;
  sendDays: number[];
  subject: string;
  preheader: string;
  fromName: string;
  doc: EmailDocument;
};

function ConditionChips({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint: string;
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <View className="gap-1.5">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => {
          const sel = selected.includes(o.id);
          return (
            <Pressable
              key={o.id}
              onPress={() => onToggle(o.id)}
              className={`px-3 py-1.5 rounded-full border ${
                sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
              }`}>
              <Text className="text-xs text-ink-2 dark:text-ink-2-dk">{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="text-ink-3 dark:text-ink-3-dk text-xs">{hint}</Text>
    </View>
  );
}

function toggleId(id: string, set: (fn: (prev: string[]) => string[]) => void) {
  set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
}

// ISO weekday numbers (1=Mon..7=Sun) — the storage the send-slot helper reads.
const WEEKDAYS: { n: number; label: string }[] = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

function formatHour(h: number): string {
  const am = h < 12;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${am ? 'am' : 'pm'}`;
}

// "Send as soon as due" vs a fixed local hour on chosen weekdays. hour === null
// means as-soon-as-due; days empty means any day.
function SendTimeControls({
  hour,
  days,
  onHour,
  onDays,
}: {
  hour: number | null;
  days: number[];
  onHour: (h: number | null) => void;
  onDays: (fn: (prev: number[]) => number[]) => void;
}) {
  const { data: gymDefaults } = useGymOperatingDefaults();
  const weekdays =
    gymDefaults?.week_starts_on === 'sun'
      ? [WEEKDAYS[6], ...WEEKDAYS.slice(0, 6)]
      : WEEKDAYS;
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk text-sm font-medium">
            Send at a set time
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Otherwise it goes out as soon as the wait is up.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Send at a set time"
          value={hour !== null}
          onValueChange={(v) => onHour(v ? 9 : null)}
        />
      </View>
      {hour !== null ? (
        <View className="gap-2">
          <View className="flex-row flex-wrap gap-1.5">
            {Array.from({ length: 24 }, (_, h) => h).map((h) => {
              const sel = hour === h;
              return (
                <Pressable
                  key={h}
                  onPress={() => onHour(h)}
                  className={`px-2.5 py-1 rounded-full border ${
                    sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                  }`}>
                  <Text className="text-xs text-ink-2 dark:text-ink-2-dk">{formatHour(h)}</Text>
                </Pressable>
              );
            })}
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {weekdays.map((d) => {
              const sel = days.includes(d.n);
              return (
                <Pressable
                  key={d.n}
                  onPress={() => onDays((prev) => (prev.includes(d.n) ? prev.filter((x) => x !== d.n) : [...prev, d.n]))}
                  className={`px-2.5 py-1 rounded-full border ${
                    sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                  }`}>
                  <Text className="text-xs text-ink-2 dark:text-ink-2-dk">{d.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            {days.length === 0
              ? 'Any day, in your gym’s timezone.'
              : 'Only on the chosen days, in your gym’s timezone.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AutomationEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const colors = useThemeColors();
  const canManageComms = useCan('can_manage_comms');
  const queryClient = useQueryClient();

  const brandSeed = {
    primaryColor: FALLBACK_BRAND_SEED.primaryColor,
    secondaryColor: FALLBACK_BRAND_SEED.secondaryColor,
    textColor: FALLBACK_BRAND_SEED.textColor,
  };

  const automation = useQuery({
    queryKey: ['email-automation', id],
    enabled: !!id && canManageComms === true,
    queryFn: async (): Promise<AutomationRow> => {
      const { data, error } = await supabase
        .from('email_automations')
        .select(
          'id, gym_id, name, enabled, trigger_type, delay_minutes, params, conditions, send_hour, send_days, topic_id, subject, preheader, from_name, design, compiled_html',
        )
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as unknown as AutomationRow;
    },
  });

  const topics = useQuery({
    queryKey: ['gym-email-topics', membership?.gymId],
    enabled: !!membership?.gymId && canManageComms === true,
    queryFn: async (): Promise<Topic[]> => {
      const { data, error } = await supabase
        .from('gym_email_topics')
        .select('id, label')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Topic[];
    },
  });

  // Options for the "Only send to…" audience conditions. Which picker shows
  // depends on the trigger; all are gym-scoped and readable by any member.
  const plans = useQuery({
    queryKey: ['gym-plans', membership?.gymId],
    enabled: !!membership?.gymId && canManageComms === true,
    queryFn: async (): Promise<Option[]> => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('plan_id, name')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []).map((p) => ({ id: p.plan_id, label: p.name }));
    },
  });

  const classTypes = useQuery({
    queryKey: ['gym-class-types', membership?.gymId],
    enabled: !!membership?.gymId && canManageComms === true,
    queryFn: async (): Promise<Option[]> => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name')
        .eq('gym_id', membership!.gymId)
        .order('name');
      if (error) throw error;
      return (data ?? []).map((c) => ({ id: c.id, label: c.name }));
    },
  });

  const leadSources = useQuery({
    queryKey: ['gym-lead-sources', membership?.gymId],
    enabled: !!membership?.gymId && canManageComms === true,
    queryFn: async (): Promise<Option[]> => {
      const { data, error } = await supabase
        .from('lead_sources')
        .select('id, label')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('label');
      if (error) throw error;
      return (data ?? []) as Option[];
    },
  });

  const tagLabels = useGymTagLabels();

  const stepRows = useQuery({
    queryKey: ['email-automation-steps', id],
    enabled: !!id && canManageComms === true,
    queryFn: async (): Promise<StepRow[]> => {
      const { data, error } = await supabase
        .from('email_automation_steps')
        .select(
          'id, step_index, delay_minutes, send_hour, send_days, subject, preheader, from_name, design, compiled_html',
        )
        .eq('automation_id', id!)
        .order('step_index');
      if (error) throw error;
      return (data ?? []) as StepRow[];
    },
  });

  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<TriggerType>('member_joined');
  const [knob, setKnob] = useState('3');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [classTypeIds, setClassTypeIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [tagLabel, setTagLabel] = useState<string | null>(null);
  const [sendHour, setSendHour] = useState<number | null>(null);
  const [sendDays, setSendDays] = useState<number[]>([]);
  const [steps, setSteps] = useState<StepState[]>([]);
  // Which email the design mode edits: null = the primary email, else a step id.
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [fromName, setFromName] = useState('');
  const [doc, setDoc] = useState<EmailDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = none sent; 'primary' = the main email; else the step id just tested.
  const [testSent, setTestSent] = useState<string | null>(null);
  const [mode, setMode] = useState<'setup' | 'design'>('setup');
  const [showPreview, setShowPreview] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !automation.data) return;
    const a = automation.data;
    setName(a.name);
    setTrigger(a.trigger_type);
    setKnob(String(storageToKnob(a)));
    setTopicId(a.topic_id);
    setPlanIds(a.conditions?.plan_ids ?? []);
    setClassTypeIds(a.conditions?.class_type_ids ?? []);
    setSourceIds(a.conditions?.lead_source_ids ?? []);
    setTagLabel(a.params?.tag ?? null);
    setSendHour(a.send_hour);
    setSendDays(a.send_days ?? []);
    setSubject(a.subject);
    setPreheader(a.preheader);
    setFromName(a.from_name ?? '');
    setDoc(coerceDocument(a.design, brandSeed));
    loaded.current = true;
  }, [automation.data, brandSeed]);

  // Load follow-up steps once, mirroring the primary's one-shot load.
  const stepsLoaded = useRef(false);
  useEffect(() => {
    if (stepsLoaded.current || !stepRows.data) return;
    setSteps(
      stepRows.data.map((s) => ({
        id: s.id,
        delayDays: Math.max(0, Math.round(s.delay_minutes / 1440)),
        sendHour: s.send_hour,
        sendDays: s.send_days ?? [],
        subject: s.subject,
        preheader: s.preheader,
        fromName: s.from_name ?? '',
        doc: coerceDocument(s.design, brandSeed),
      })),
    );
    stepsLoaded.current = true;
  }, [stepRows.data, brandSeed]);

  const enabled = automation.data?.enabled ?? false;
  const warnings = doc ? documentWarnings(doc) : ['Loading'];
  // A member_tagged automation with no tag chosen would never fire — the
  // sweep matches nothing on a blank tag — so don't let it be enabled.
  const canEnable =
    warnings.length === 0 &&
    subject.trim() !== '' &&
    (trigger !== 'member_tagged' || !!tagLabel);

  const previewHtml = useMemo(
    () => (doc ? renderEmailHtml(doc, { preheader, unsubscribeUrl: '#' }) : ''),
    [doc, preheader],
  );

  // Only carry the conditions the current trigger actually uses, so switching
  // trigger never leaves a stale filter behind. Empty = fire for everyone.
  function buildConditions(): AutomationConditions {
    const c: AutomationConditions = {};
    const memberTrigger =
      trigger === 'member_joined' ||
      trigger === 'member_inactive' ||
      trigger === 'member_first_class' ||
      trigger === 'member_tagged';
    if (memberTrigger && planIds.length) c.plan_ids = planIds;
    if (trigger === 'member_first_class' && classTypeIds.length) c.class_type_ids = classTypeIds;
    if (trigger === 'lead_cold' && sourceIds.length) c.lead_source_ids = sourceIds;
    return c;
  }

  function buildPatch(): Record<string, unknown> | null {
    if (!doc) return null;
    const { delay_minutes, params } = knobToStorage(trigger, Number(knob) || 0);
    return {
      name: name.trim() || 'Untitled automation',
      trigger_type: trigger,
      delay_minutes,
      params:
        trigger === 'member_tagged' && tagLabel ? { ...params, tag: tagLabel } : params,
      conditions: buildConditions() as unknown as Json,
      send_hour: sendHour,
      send_days: sendHour === null || sendDays.length === 0 ? null : sendDays,
      topic_id: topicId,
      subject,
      preheader,
      from_name: fromName.trim() || null,
      design: doc as unknown as Json,
      compiled_html: renderEmailHtml(doc, { preheader }),
      compiled_text: renderEmailText(doc, { preheader }),
    };
  }

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error: e } = await supabase
        .from('email_automations')
        .update({ ...patch, updated_by: session?.user.id })
        .eq('id', id!);
      if (e) throw e;
    },
    onError: (e) => setError(errorMessage(e, 'Could not save')),
    onSuccess: () => {
      setError(null);
      setJustSaved(true);
      queryClient.invalidateQueries({ queryKey: ['email-automations', membership?.gymId] });
    },
  });

  async function saveNow() {
    const patch = buildPatch();
    if (patch) await save.mutateAsync(patch);
  }

  // Debounced autosave of the whole form once it has loaded. Any edit marks
  // the form dirty (clears the "Saved" state) and schedules a save.
  useEffect(() => {
    if (!loaded.current || !doc) return;
    setJustSaved(false);
    const timer = setTimeout(() => {
      const patch = buildPatch();
      if (patch) save.mutate(patch);
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, trigger, knob, topicId, planIds, classTypeIds, sourceIds, tagLabel, sendHour, sendDays, subject, preheader, fromName, doc]);

  function updateStep(stepId: string, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  function stepPatch(s: StepState) {
    return {
      delay_minutes: Math.max(0, Math.round(s.delayDays)) * 1440,
      send_hour: s.sendHour,
      send_days: s.sendHour === null || s.sendDays.length === 0 ? null : s.sendDays,
      subject: s.subject,
      preheader: s.preheader,
      from_name: s.fromName.trim() || null,
      design: s.doc as unknown as Json,
      compiled_html: renderEmailHtml(s.doc, { preheader: s.preheader }),
      compiled_text: renderEmailText(s.doc, { preheader: s.preheader }),
    };
  }

  // Debounced autosave of every follow-up step. Re-saving all of them on any
  // change keeps this simple; the set is tiny.
  useEffect(() => {
    if (!stepsLoaded.current) return;
    setJustSaved(false);
    const timer = setTimeout(() => {
      steps.forEach((s) => {
        supabase
          .from('email_automation_steps')
          .update(stepPatch(s))
          .eq('id', s.id)
          .then(({ error: e }) => {
            if (e) setError(errorMessage(e, 'Could not save a follow-up'));
          });
      });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  const addStep = useMutation({
    mutationFn: async (): Promise<StepRow> => {
      const doc0 = starterDocument(brandSeed, {
        gymName: brand.gymName,
        });
      const { data, error: e } = await supabase
        .from('email_automation_steps')
        .insert({
          automation_id: id!,
          gym_id: membership!.gymId,
          step_index: steps.length,
          delay_minutes: 3 * 1440,
          subject: '',
          design: doc0 as unknown as Json,
          compiled_html: renderEmailHtml(doc0),
          compiled_text: renderEmailText(doc0),
        })
        .select(
          'id, step_index, delay_minutes, send_hour, send_days, subject, preheader, from_name, design, compiled_html',
        )
        .single();
      if (e || !data) throw e ?? new Error('No step');
      return data as StepRow;
    },
    onSuccess: (row) => {
      setSteps((prev) => [
        ...prev,
        {
          id: row.id,
          delayDays: 3,
          sendHour: null,
          sendDays: [],
          subject: '',
          preheader: '',
          fromName: '',
          doc: coerceDocument(row.design, brandSeed),
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ['email-automation-steps', id] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not add a follow-up')),
  });

  const deleteStep = useMutation({
    mutationFn: async (stepId: string) => {
      const { error: e } = await supabase
        .from('email_automation_steps')
        .delete()
        .eq('id', stepId);
      if (e) throw e;
    },
    onSuccess: (_d, stepId) => {
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      if (editingStep === stepId) {
        setEditingStep(null);
        setMode('setup');
      }
      queryClient.invalidateQueries({ queryKey: ['email-automation-steps', id] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not remove the follow-up')),
  });

  const toggleEnabled = useMutation({
    mutationFn: async (next: boolean) => {
      const { error: e } = await supabase
        .from('email_automations')
        .update({ enabled: next })
        .eq('id', id!);
      if (e) throw e;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-automation', id] });
      queryClient.invalidateQueries({ queryKey: ['email-automations', membership?.gymId] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not change the automation')),
  });

  const sendTest = useMutation({
    mutationFn: async (stepId: string | null) => {
      const { error: e } = await supabase.rpc('send_automation_test', {
        p_automation_id: id!,
        p_step_id: stepId,
      });
      if (e) throw e;
    },
    onSuccess: (_d, stepId) => {
      setError(null);
      setTestSent(stepId ?? 'primary');
    },
    onError: (e) => setError(errorMessage(e, 'Could not send a test')),
  });

  if (canManageComms === false) return <Redirect href="/management/communications" />;
  if (!membership || !doc) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="py-6 px-4">
          <BackLink fallbackHref="/management/communications" />
          <Text className="text-ink-2 dark:text-ink-2-dk mt-4">Loading…</Text>
        </View>
      </Screen>
    );
  }

  // The design mode edits whichever email is active — the primary or a step.
  const activeStepIndex = editingStep ? steps.findIndex((s) => s.id === editingStep) : -1;
  const activeStep = activeStepIndex >= 0 ? steps[activeStepIndex] : null;
  const activeDoc = activeStep ? activeStep.doc : doc;
  const setActiveDoc = (d: EmailDocument) => {
    if (activeStep) updateStep(activeStep.id, { doc: d });
    else setDoc(d);
  };
  const activePreviewHtml = activeStep
    ? renderEmailHtml(activeStep.doc, { preheader: activeStep.preheader, unsubscribeUrl: '#' })
    : previewHtml;
  const activeLabel = activeStep ? `Follow-up ${activeStepIndex + 1}` : 'Main email';

  async function saveActiveNow() {
    if (activeStep) {
      const { error: e } = await supabase
        .from('email_automation_steps')
        .update(stepPatch(activeStep))
        .eq('id', activeStep.id);
      if (e) setError(errorMessage(e, 'Could not save a follow-up'));
      else setJustSaved(true);
    } else {
      await saveNow();
    }
  }

  if (mode === 'design') {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="flex-1 gap-3 py-4">
          <View className="flex-row items-center gap-3 px-4">
            <Pressable
              onPress={() => setMode('setup')}
              hitSlop={6}
              className="flex-row items-center gap-1 active:opacity-70 hover:opacity-80">
              <Ionicons name="chevron-back" size={18} color={colors.ink2} />
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                Setup
              </Text>
            </Pressable>
            <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
              {activeLabel}
            </Text>
            <Button
              variant="secondary"
              onPress={saveActiveNow}
              loading={save.isPending}
              success={justSaved}>
              Save
            </Button>
            {Platform.OS === 'web' ? (
              <Pressable
                onPress={() => setShowPreview((v) => !v)}
                hitSlop={6}
                className="flex-row items-center gap-1.5 active:opacity-70 hover:opacity-80">
                <Ionicons
                  name={showPreview ? 'create-outline' : 'eye-outline'}
                  size={15}
                  color={colors.ink2}
                />
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                  {showPreview ? 'Back to editor' : 'Preview'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {showPreview && Platform.OS === 'web' ? (
            <ScrollView className="flex-1" contentContainerClassName="pb-4 px-4">
              <HtmlPreview html={activePreviewHtml} />
            </ScrollView>
          ) : (
            <EmailEditor
              document={activeDoc}
              onChange={setActiveDoc}
              brand={brandSeed}
              gymId={membership.gymId}
            />
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/communications" />

        <PageHead
          title="Edit automation"
          action={
            <Button
              variant="secondary"
              onPress={saveNow}
              loading={save.isPending}
              success={justSaved}>
              Save
            </Button>
          }
        />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-medium">
              Automation is live
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              {canEnable
                ? 'Sends automatically whenever the trigger fires.'
                : 'Add a subject and some content before turning this on.'}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Automation is live"
            value={enabled}
            disabled={!canEnable && !enabled}
            onValueChange={(v) => toggleEnabled.mutate(v)}
          />
        </View>

        <Input label="Automation name" value={name} onChangeText={setName} placeholder="Welcome new members" />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <FieldLabel>
            When it fires
          </FieldLabel>
          {(['member_joined', 'member_first_class', 'member_inactive', 'member_tagged', 'lead_cold'] as TriggerType[]).map(
            (t) => {
              const sel = trigger === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTrigger(t)}
                  className={`rounded-lg border p-3 gap-1 ${
                    sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                  }`}>
                  <Text className="text-ink dark:text-ink-dk font-medium">
                    {TRIGGER_LABELS[t]}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    {TRIGGER_BLURB[t]}
                  </Text>
                </Pressable>
              );
            },
          )}
          {trigger === 'member_tagged' ? (
            <View className="gap-1.5">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                Which tag
              </Text>
              {tagLabels.isLoading ? (
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Loading tags…</Text>
              ) : (tagLabels.data ?? []).length === 0 ? (
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  No member tags yet. Add tags or tag rules from Manage → Members first.
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {(tagLabels.data ?? []).map((label) => {
                    const sel = tagLabel === label;
                    return (
                      <Pressable
                        key={label}
                        onPress={() => setTagLabel(label)}
                        className={`px-3 py-1.5 rounded-full border ${
                          sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                        }`}>
                        <Text className="text-xs text-ink-2 dark:text-ink-2-dk">{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                Fires once per member, whether the tag is added by hand or by a
                tag rule. Losing and regaining the tag doesn’t re-send.
              </Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-3">
            <View className="w-24">
              <Input label="Wait" value={knob} onChangeText={setKnob} keyboardType="number-pad" />
            </View>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm flex-1 pt-5">
              {KNOB_UNIT[trigger]}
            </Text>
          </View>
        </View>

        {(() => {
          const showPlan =
            trigger === 'member_joined' ||
            trigger === 'member_inactive' ||
            trigger === 'member_first_class' ||
            trigger === 'member_tagged';
          const showType = trigger === 'member_first_class';
          const showSource = trigger === 'lead_cold';
          const anyOptions =
            (showPlan && (plans.data?.length ?? 0) > 0) ||
            (showType && (classTypes.data?.length ?? 0) > 0) ||
            (showSource && (leadSources.data?.length ?? 0) > 0);
          if (!anyOptions) return null;
          return (
            <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
              <View className="gap-1">
                <FieldLabel>
                  Only send to
                </FieldLabel>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Leave everything unticked to send to everyone the trigger matches.
                </Text>
              </View>
              {showPlan ? (
                <ConditionChips
                  label="Members on these plans"
                  hint="Only members with a current subscription to a ticked plan."
                  options={plans.data ?? []}
                  selected={planIds}
                  onToggle={(pid) => toggleId(pid, setPlanIds)}
                />
              ) : null}
              {showType ? (
                <ConditionChips
                  label="Whose first class is one of these"
                  hint="Fires on their first attended class of a ticked type."
                  options={classTypes.data ?? []}
                  selected={classTypeIds}
                  onToggle={(cid) => toggleId(cid, setClassTypeIds)}
                />
              ) : null}
              {showSource ? (
                <ConditionChips
                  label="Leads from these sources"
                  hint="Only leads captured from a ticked source."
                  options={leadSources.data ?? []}
                  selected={sourceIds}
                  onToggle={(sid) => toggleId(sid, setSourceIds)}
                />
              ) : null}
            </View>
          );
        })()}

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <FieldLabel>
            The email
          </FieldLabel>
          <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="Welcome to the gym" />
          <Input
            label="Preview text"
            value={preheader}
            onChangeText={setPreheader}
            placeholder="The snippet shown next to the subject"
          />
          <Input label="From name (optional)" value={fromName} onChangeText={setFromName} placeholder={brand.gymName} />

          <View className="border-t border-line dark:border-line-dk pt-3">
            <SendTimeControls
              hour={sendHour}
              days={sendDays}
              onHour={setSendHour}
              onDays={setSendDays}
            />
          </View>

          {trigger !== 'lead_cold' && (topics.data?.length ?? 0) > 0 ? (
            <View className="gap-1.5">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">Topic</Text>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => setTopicId(null)}
                  className={`px-3 py-1.5 rounded-full border ${
                    topicId === null ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                  }`}>
                  <Text className="text-xs text-ink-2 dark:text-ink-2-dk">No topic</Text>
                </Pressable>
                {(topics.data ?? []).map((t) => {
                  const sel = topicId === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setTopicId(t.id)}
                      className={`px-3 py-1.5 rounded-full border ${
                        sel ? 'border-transparent bg-raised dark:bg-raised-dk' : 'border-line dark:border-line-dk'
                      }`}>
                      <Text className="text-xs text-ink-2 dark:text-ink-2-dk">{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                Members who opted out of this topic won’t be emailed.
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => {
            setEditingStep(null);
            setMode('design');
          }}
          className="flex-row items-center gap-3 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 active:opacity-70">
          <View className="w-9 h-9 rounded-lg bg-raised dark:bg-raised-dk items-center justify-center">
            <Ionicons name="brush-outline" size={18} color={colors.ink2} />
          </View>
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Design your email
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              {doc.blocks.length} block{doc.blocks.length === 1 ? '' : 's'} · edit the
              layout and content
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={15} color={colors.ink3} />
        </Pressable>

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <View className="gap-1">
            <FieldLabel>
              Follow-up emails
            </FieldLabel>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Send more emails later in the same sequence. Each one’s wait is
              measured from the trigger, not the email before it.
            </Text>
          </View>

          {steps.map((s, i) => (
            <View
              key={s.id}
              className="rounded-lg border border-line dark:border-line-dk p-3 gap-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-ink dark:text-ink-dk font-medium">
                  Follow-up {i + 1}
                </Text>
                <Pressable
                  onPress={() => deleteStep.mutate(s.id)}
                  hitSlop={6}
                  className="active:opacity-70">
                  <Ionicons name="trash-outline" size={18} color={colors.ink2} />
                </Pressable>
              </View>
              <View className="flex-row items-center gap-3">
                <View className="w-24">
                  <Input
                    label="Wait"
                    value={String(s.delayDays)}
                    onChangeText={(v) => updateStep(s.id, { delayDays: Number(v) || 0 })}
                    keyboardType="number-pad"
                  />
                </View>
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm flex-1 pt-5">
                  days after the trigger
                </Text>
              </View>
              <Input
                label="Subject"
                value={s.subject}
                onChangeText={(v) => updateStep(s.id, { subject: v })}
                placeholder="Following up"
              />
              <SendTimeControls
                hour={s.sendHour}
                days={s.sendDays}
                onHour={(h) => updateStep(s.id, { sendHour: h })}
                onDays={(fn) => updateStep(s.id, { sendDays: fn(s.sendDays) })}
              />
              <View className="flex-row items-center justify-between gap-3">
                <Pressable
                  onPress={() => {
                    setEditingStep(s.id);
                    setMode('design');
                  }}
                  className="flex-row items-center gap-2 active:opacity-70">
                  <Ionicons name="brush-outline" size={16} color={colors.ink2} />
                  <Text className="text-primary text-sm font-medium">
                    Design this email · {s.doc.blocks.length} block
                    {s.doc.blocks.length === 1 ? '' : 's'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => sendTest.mutate(s.id)}
                  disabled={sendTest.isPending}
                  className="active:opacity-70">
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-medium">
                    {testSent === s.id ? 'Test queued' : 'Send a test'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}

          <Button
            variant="secondary"
            onPress={() => addStep.mutate()}
            loading={addStep.isPending}>
            Add a follow-up
          </Button>
        </View>

        {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}

        <View className="gap-2">
          <Button variant="secondary" onPress={() => sendTest.mutate(null)} loading={sendTest.isPending}>
            Send a test to me
          </Button>
          {testSent === 'primary' ? (
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs text-center">
              Test queued — it’ll arrive shortly (or simulate in dev).
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
