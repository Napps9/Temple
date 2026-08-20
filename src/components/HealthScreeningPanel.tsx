// Lives here rather than under app/ because it has no route of its own.
// /management/parq was a Screen, a BackLink and a heading wrapped around
// this panel, and the Manage screen's Settings tab already rendered the
// same component behind the same capability.

import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Switch, View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { useGymMembership, useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useCan } from '@/lib/useCan';
import { useSavedFlag } from '@/lib/useSavedFlag';

function openUrl(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank');
  } else {
    Linking.openURL(url).catch(() => {});
  }
}

type ActiveWaiver = {
  id: string;
  version: number;
  title: string;
  file_url: string;
  published_at: string;
};

// WaiverPanel — upload a PDF and publish it as the gym's signable
// waiver. The primary health-screening path: most gyms already have a
// liability waiver as a PDF, so this is one upload away from "members
// can sign and book". Publishing a new version re-prompts every member
// to re-sign (their old signature stays tied to the version they saw).
export function WaiverPanel() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const canManage = useCan('can_manage_parq');
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState<{
    path: string;
    url: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const active = useQuery({
    queryKey: ['waiver-active', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<ActiveWaiver | null> => {
      const { data, error } = await supabase
        .from('waiver_documents')
        .select('id, version, title, file_url, published_at')
        .eq('gym_id', membership!.gymId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data as ActiveWaiver | null;
    },
  });

  const sigCount = useQuery({
    queryKey: ['waiver-signature-count', active.data?.id],
    enabled: !!active.data?.id,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('waiver_signatures')
        .select('id', { count: 'exact', head: true })
        .eq('waiver_id', active.data!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const pick = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('Missing context');
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return null;
      const asset = res.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const path = `${membership.gymId}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from('gym-waivers')
        .upload(path, blob, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage
        .from('gym-waivers')
        .getPublicUrl(path);
      return { path, url: pub.publicUrl, name: asset.name ?? 'waiver.pdf' };
    },
    onSuccess: (v) => {
      if (v) {
        setPending(v);
        setError(null);
      }
    },
    onError: (e) => setError(errorMessage(e, 'Could not upload the PDF')),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!membership || !pending) throw new Error('Upload a PDF first');
      const { error } = await supabase.rpc('publish_waiver', {
        p_gym_id: membership.gymId,
        p_title: title.trim() || 'Liability waiver',
        p_file_path: pending.path,
        p_file_url: pending.url,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      setPending(null);
      setTitle('');
      queryClient.invalidateQueries({ queryKey: ['waiver-active'] });
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not publish the waiver')),
  });

  if (canManage === false) {
    return (
      <Text className="text-ink-2 dark:text-ink-2-dk">
        Only owners and admins can manage the waiver.
      </Text>
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
        Upload your liability waiver as a PDF. Members read it and sign
        with their finger or mouse before they can book — their signature
        is stored against the exact version they saw.
      </Text>

      {active.data ? (
        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2 border border-emerald-500/30">
          <View className="flex-row items-center gap-2">
            <Ionicons name="document-text-outline" size={18} color="#10B981" />
            <Text className="flex-1 text-ink dark:text-ink-dk font-medium" numberOfLines={1}>
              {active.data.title}
            </Text>
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
              v{active.data.version}
            </Text>
          </View>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {sigCount.data ?? 0}{' '}
            {sigCount.data === 1 ? 'member has' : 'members have'} signed this
            version.
          </Text>
          <View className="flex-row gap-2 pt-1">
            <ChipButton
              label="View PDF"
              icon="open-outline"
              onPress={() => openUrl(active.data!.file_url)}
            />
          </View>
        </View>
      ) : (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
          No waiver published yet
        </Text>
      )}

      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        <Input
          label="Waiver title (optional)"
          value={title}
          onChangeText={setTitle}
          placeholder="Liability waiver"
          autoCapitalize="sentences"
        />

        {pending ? (
          <View className="flex-row items-center gap-2 bg-emerald-500/10 rounded-lg px-3 py-2">
            <Ionicons name="checkmark-circle" size={16} color="#10B981" />
            <Text
              className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm"
              numberOfLines={1}>
              {pending.name}
            </Text>
            <Pressable
              onPress={() => setPending(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove file">
              <Ionicons name="close" size={16} color={colors.ink3} />
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={() => pick.mutate()}
          disabled={pick.isPending}
          className="flex-row items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-line-strong dark:border-line-strong-dk active:opacity-70">
          <Ionicons name="cloud-upload-outline" size={18} color={colors.ink2} />
          <Text className="text-ink-2 dark:text-ink-2-dk font-medium">
            {pick.isPending
              ? 'Uploading…'
              : pending
                ? 'Choose a different PDF'
                : active.data
                  ? 'Upload a new PDF'
                  : 'Upload waiver PDF'}
          </Text>
        </Pressable>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        <Button
          onPress={() => publish.mutate()}
          loading={publish.isPending}
          disabled={!pending}
          success={saved}>
          {active.data ? 'Publish new version' : 'Publish waiver'}
        </Button>

        {active.data ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Publishing a new version asks every member to re-sign on their
            next visit. Existing signatures stay tied to the version they
            signed.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// HealthScreeningPanel — the waiver (primary) plus the question-by-
// question PAR-Q kept as an optional extra. Both surfaces share the
// can_manage_parq capability. A gym only needs one of the two to let
// members book, but if both are published a member must clear both.
export function HealthScreeningPanel() {
  const colors = useThemeColors();
  const [showParq, setShowParq] = useState(false);
  return (
    <View className="gap-5">
      <WaiverPanel />

      {/* Same card treatment as WaiverPanel so the two halves of the
          health-screening surface read as siblings rather than the
          PAR-Q section feeling orphaned underneath. */}
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
        <Pressable
          onPress={() => setShowParq((v) => !v)}
          className="flex-row items-center gap-2 active:opacity-70">
          <Ionicons
            name={showParq ? 'chevron-down' : 'chevron-forward'}
            size={18}
            color={colors.ink2}
          />
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Question-by-question PAR-Q
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Optional. Adds structured health questions on top of the
              waiver — any "yes" on a flagged question raises a staff
              alert so coaches can follow up.
            </Text>
          </View>
        </Pressable>
        {showParq ? <ParqPanel /> : null}
      </View>
    </View>
  );
}

type Questionnaire = {
  id: string;
  version: number;
  is_active: boolean;
  published_at: string;
};

type Question = {
  id: string;
  sort_order: number;
  prompt: string;
  flag_on_yes: boolean;
};

type DraftQuestion = {
  serverId: string | null;
  localId: string;
  prompt: string;
  flag_on_yes: boolean;
};

function makeDraft(q: Question): DraftQuestion {
  return {
    serverId: q.id,
    localId: q.id,
    prompt: q.prompt,
    flag_on_yes: q.flag_on_yes,
  };
}

function makeBlank(): DraftQuestion {
  return {
    serverId: null,
    localId: `new-${Math.random().toString(36).slice(2, 8)}`,
    prompt: '',
    flag_on_yes: true,
  };
}

export function ParqPanel() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const canManage = useCan('can_manage_parq');
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<DraftQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  const active = useQuery({
    queryKey: ['parq-active', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<Questionnaire | null> => {
      const { data, error } = await supabase
        .from('parq_questionnaires')
        .select('id, version, is_active, published_at')
        .eq('gym_id', membership!.gymId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data as Questionnaire | null;
    },
  });

  const questions = useQuery({
    queryKey: ['parq-questions', active.data?.id],
    enabled: !!active.data?.id,
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from('parq_questions')
        .select('id, sort_order, prompt, flag_on_yes')
        .eq('questionnaire_id', active.data!.id)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Question[];
    },
  });

  useEffect(() => {
    if (questions.data) setRows(questions.data.map(makeDraft));
  }, [questions.data]);

  // Publishing creates a NEW questionnaire version and switches it
  // active. Older versions are preserved so historical responses
  // keep pointing at the wording the member saw.
  const publish = useMutation({
    mutationFn: async () => {
      if (!membership || !session?.user.id) throw new Error('Missing context');
      const cleaned = rows
        .map((r) => ({ ...r, prompt: r.prompt.trim() }))
        .filter((r) => r.prompt.length > 0);
      if (cleaned.length === 0) {
        throw new Error('Add at least one question before publishing');
      }
      const nextVersion = (active.data?.version ?? 0) + 1;

      // Flip prior active off (the partial unique index enforces it
      // but we do it explicitly so the transaction order is obvious).
      if (active.data?.id) {
        const { error: e1 } = await supabase
          .from('parq_questionnaires')
          .update({ is_active: false })
          .eq('id', active.data.id);
        if (e1) throw e1;
      }

      const { data: inserted, error: e2 } = await supabase
        .from('parq_questionnaires')
        .insert({
          gym_id: membership.gymId,
          version: nextVersion,
          is_active: true,
          published_by: session.user.id,
        })
        .select('id')
        .single();
      if (e2) throw e2;

      const newId = (inserted as { id: string }).id;
      const { error: e3 } = await supabase.from('parq_questions').insert(
        cleaned.map((r, i) => ({
          questionnaire_id: newId,
          sort_order: i + 1,
          prompt: r.prompt,
          flag_on_yes: r.flag_on_yes,
        })),
      );
      if (e3) throw e3;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['parq-active'] });
      queryClient.invalidateQueries({ queryKey: ['parq-questions'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not publish')),
  });

  if (canManage === false) {
    return (
      <Text className="text-ink-2 dark:text-ink-2-dk">
        Only owners and admins can edit the PAR-Q.
      </Text>
    );
  }

  function update(idx: number, patch: Partial<DraftQuestion>) {
    setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function add() {
    setRows((r) => [...r, makeBlank()]);
  }
  function remove(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }

  return (
    <View className="gap-4">
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
        Members re-answer every 12 months. Toggle the flag on the
        questions where a "yes" should reach a coach.
      </Text>

      {active.data ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
          Current version: v{active.data.version}
        </Text>
      ) : (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs uppercase tracking-widest">
          No PAR-Q published yet
        </Text>
      )}

      <View className="gap-3">
        {rows.length === 0 ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">
            No questions yet. Add your first one below — they'll appear
            to members in the order you add them.
          </Text>
        ) : null}
        {rows.map((r, idx) => (
          <View
            key={r.localId}
            className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
            <Input
              label={`Question ${idx + 1}`}
              value={r.prompt}
              onChangeText={(v) => update(idx, { prompt: v })}
              placeholder="Do you have a heart condition?"
              multiline
              numberOfLines={2}
              autoCapitalize="sentences"
            />
            <View className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                  Alert coaches on "yes"
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Leave off for non-medical questions like goals or preferences.
                </Text>
              </View>
              <Switch
                accessibilityLabel={'Alert coaches on "yes"'}
                value={r.flag_on_yes}
                onValueChange={(v) => update(idx, { flag_on_yes: v })}
              />
              <Pressable
                onPress={() => remove(idx)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete question"
                className="active:opacity-70">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        onPress={add}
        className="flex-row items-center gap-2 self-start px-3 py-2 rounded-lg border border-dashed border-line-strong dark:border-line-strong-dk">
        <Ionicons name="add" size={16} color={colors.ink2} />
        <Text className="text-ink-2 dark:text-ink-2-dk">Add question</Text>
      </Pressable>

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
      ) : null}

      <Button onPress={() => publish.mutate()} loading={publish.isPending} success={saved}>
        {active.data ? 'Publish new version' : 'Publish PAR-Q'}
      </Button>

      <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
        Publishing creates a new version and asks every member to answer
        again on their next visit. Older responses stay tied to the
        version members saw, so your history is preserved.
      </Text>
    </View>
  );
}

