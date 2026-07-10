import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { EmailEditor } from '@/components/email/EmailEditor';
import { HtmlPreview } from '@/components/email/HtmlPreview';
import { useGymMembership, useSession } from '@/lib/auth';
import {
  coerceDocument,
  documentWarnings,
  type EmailDocument,
} from '@/lib/email/blocks';
import { renderEmailHtml, renderEmailText } from '@/lib/email/render';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import { useThemeColors } from '@/lib/theme';
import type { Json } from '@/types/database';

import { TRIGGER_LABELS } from '../automations';

type TriggerType =
  | 'member_joined'
  | 'member_first_class'
  | 'member_inactive'
  | 'lead_cold';

type AutomationRow = {
  id: string;
  gym_id: string;
  name: string;
  enabled: boolean;
  trigger_type: TriggerType;
  delay_minutes: number;
  params: { inactive_days?: number; cold_hours?: number } | null;
  topic_id: string | null;
  subject: string;
  preheader: string;
  from_name: string | null;
  design: unknown;
  compiled_html: string | null;
};

const TRIGGER_BLURB: Record<TriggerType, string> = {
  member_joined: 'Welcome new members a few days after they sign up.',
  member_first_class: 'Follow up after someone attends their first class.',
  member_inactive: 'Win back a member who hasn’t attended in a while.',
  lead_cold: 'Nurture a prospect who enquired but hasn’t been contacted.',
};

// The single timing knob each trigger exposes, and how it maps to storage.
const KNOB_UNIT: Record<TriggerType, string> = {
  member_joined: 'days after they join',
  member_first_class: 'days after their first class',
  member_inactive: 'days without attending',
  lead_cold: 'hours if still cold',
};

function knobToStorage(
  trigger: TriggerType,
  knob: number,
): { delay_minutes: number; params: Json } {
  switch (trigger) {
    case 'member_joined':
    case 'member_first_class':
      return { delay_minutes: Math.max(0, Math.round(knob)) * 1440, params: {} };
    case 'member_inactive':
      return { delay_minutes: 0, params: { inactive_days: Math.max(1, Math.round(knob)) } };
    case 'lead_cold':
      return { delay_minutes: 0, params: { cold_hours: Math.max(1, Math.round(knob)) } };
  }
}

function storageToKnob(row: AutomationRow): number {
  switch (row.trigger_type) {
    case 'member_joined':
    case 'member_first_class':
      return Math.round(row.delay_minutes / 1440) || 3;
    case 'member_inactive':
      return row.params?.inactive_days ?? 21;
    case 'lead_cold':
      return row.params?.cold_hours ?? 24;
  }
}

type Topic = { id: string; label: string };

export default function AutomationEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const colors = useThemeColors();
  const canManageComms = useCan('can_manage_comms');
  const queryClient = useQueryClient();

  const brandSeed = {
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    textColor: brand.textColor,
  };

  const automation = useQuery({
    queryKey: ['email-automation', id],
    enabled: !!id && canManageComms === true,
    queryFn: async (): Promise<AutomationRow> => {
      const { data, error } = await supabase
        .from('email_automations')
        .select(
          'id, gym_id, name, enabled, trigger_type, delay_minutes, params, topic_id, subject, preheader, from_name, design, compiled_html',
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

  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<TriggerType>('member_joined');
  const [knob, setKnob] = useState('3');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [fromName, setFromName] = useState('');
  const [doc, setDoc] = useState<EmailDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);
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
    setSubject(a.subject);
    setPreheader(a.preheader);
    setFromName(a.from_name ?? '');
    setDoc(coerceDocument(a.design, brandSeed));
    loaded.current = true;
  }, [automation.data, brandSeed]);

  const enabled = automation.data?.enabled ?? false;
  const warnings = doc ? documentWarnings(doc) : ['Loading'];
  const canEnable = warnings.length === 0 && subject.trim() !== '';

  const previewHtml = useMemo(
    () => (doc ? renderEmailHtml(doc, { preheader, unsubscribeUrl: '#' }) : ''),
    [doc, preheader],
  );

  function buildPatch(): Record<string, unknown> | null {
    if (!doc) return null;
    const { delay_minutes, params } = knobToStorage(trigger, Number(knob) || 0);
    return {
      name: name.trim() || 'Untitled automation',
      trigger_type: trigger,
      delay_minutes,
      params,
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
  }, [name, trigger, knob, topicId, subject, preheader, fromName, doc]);

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
    mutationFn: async () => {
      const { error: e } = await supabase.rpc('send_automation_test', {
        p_automation_id: id!,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setTestSent(true);
    },
    onError: (e) => setError(errorMessage(e, 'Could not send a test')),
  });

  if (canManageComms === false) return <Redirect href="/management/communications" />;
  if (!membership || !doc) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="py-6 px-4">
          <BackLink label="Automations" fallbackHref="/management/communications/automations" />
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading…</Text>
        </View>
      </Screen>
    );
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
              <Ionicons name="chevron-back" size={18} color={colors.iconSecondary} />
              <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
                Setup
              </Text>
            </Pressable>
            <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
              Design email
            </Text>
            <Button
              variant="secondary"
              onPress={saveNow}
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
                  color={colors.iconSecondary}
                />
                <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
                  {showPreview ? 'Back to editor' : 'Preview'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {showPreview && Platform.OS === 'web' ? (
            <ScrollView className="flex-1" contentContainerClassName="pb-4 px-4">
              <HtmlPreview html={previewHtml} />
            </ScrollView>
          ) : (
            <EmailEditor
              document={doc}
              onChange={setDoc}
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
        <BackLink label="Automations" fallbackHref="/management/communications/automations" />

        <View className="flex-row items-center justify-between gap-3 flex-wrap">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold flex-1">
            Edit automation
          </Text>
          <Button
            variant="secondary"
            onPress={saveNow}
            loading={save.isPending}
            success={justSaved}>
            Save
          </Button>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 flex-row items-center justify-between gap-3 shadow-card">
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-medium">
              Automation is live
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
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

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            When it fires
          </Text>
          {(['member_joined', 'member_first_class', 'member_inactive', 'lead_cold'] as TriggerType[]).map(
            (t) => {
              const sel = trigger === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTrigger(t)}
                  className={`rounded-lg border p-3 gap-1 ${
                    sel ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text className="text-gray-900 dark:text-gray-50 font-medium">
                    {TRIGGER_LABELS[t]}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {TRIGGER_BLURB[t]}
                  </Text>
                </Pressable>
              );
            },
          )}
          <View className="flex-row items-center gap-3">
            <View className="w-24">
              <Input label="Wait" value={knob} onChangeText={setKnob} keyboardType="number-pad" />
            </View>
            <Text className="text-gray-500 dark:text-gray-400 text-sm flex-1 pt-5">
              {KNOB_UNIT[trigger]}
            </Text>
          </View>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            The email
          </Text>
          <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="Welcome to the gym" />
          <Input
            label="Preview text"
            value={preheader}
            onChangeText={setPreheader}
            placeholder="The snippet shown next to the subject"
          />
          <Input label="From name (optional)" value={fromName} onChangeText={setFromName} placeholder={brand.gymName} />

          {trigger !== 'lead_cold' && (topics.data?.length ?? 0) > 0 ? (
            <View className="gap-1.5">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">Topic</Text>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => setTopicId(null)}
                  className={`px-3 py-1.5 rounded-full border ${
                    topicId === null ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text className="text-xs text-gray-700 dark:text-gray-200">No topic</Text>
                </Pressable>
                {(topics.data ?? []).map((t) => {
                  const sel = topicId === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setTopicId(t.id)}
                      className={`px-3 py-1.5 rounded-full border ${
                        sel ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-700'
                      }`}>
                      <Text className="text-xs text-gray-700 dark:text-gray-200">{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className="text-gray-400 dark:text-gray-500 text-xs">
                Members who opted out of this topic won’t be emailed.
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => setMode('design')}
          className="flex-row items-center gap-3 bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card active:opacity-70">
          <View className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
            <Ionicons name="brush-outline" size={18} color={colors.iconSecondary} />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Design your email
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              {doc.blocks.length} block{doc.blocks.length === 1 ? '' : 's'} · edit the
              layout and content
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.iconTertiary} />
        </Pressable>

        {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}

        <View className="gap-2">
          <Button variant="secondary" onPress={() => sendTest.mutate()} loading={sendTest.isPending}>
            Send a test to me
          </Button>
          {testSent ? (
            <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
              Test queued — it’ll arrive shortly (or simulate in dev).
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
