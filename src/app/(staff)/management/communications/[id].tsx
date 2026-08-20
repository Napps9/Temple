import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { Spinner } from '@/components/EmptyState';
import { Text } from '@/components/Text';

import { AudienceBuilder } from '@/components/email/AudienceBuilder';
import { ChipButton } from '@/components/ChipButton';
import { HtmlPreview } from '@/components/email/HtmlPreview';
import { EmailEditor } from '@/components/email/EmailEditor';
import { StatusBadge } from '@/components/email/CampaignList';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { PageHead } from '@/components/PageHead';
import { FieldLabel, SectionLabel } from '@/components/SectionLabel';
import { campaignReport } from '@/lib/campaign-report';
import { StatTile } from '@/components/StatTile';
import { useGymMembership } from '@/lib/auth';
import {
  formatDateTime,
  useAudienceCount,
  useCommsSettings,
  useScheduleCampaign,
  useSendCampaign,
  useUnscheduleCampaign,
} from '@/lib/comms';
import {
  describeAudience,
  isAudienceEmptyByConstruction,
  normalizeAudience,
  type AudienceDefinition,
} from '@/lib/email/audience';
import {
  coerceDocument,
  documentWarnings,
  type BrandSeed,
} from '@/lib/email/blocks';
import { useEmailHistory } from '@/lib/email/history';
import { renderEmailHtml } from '@/lib/email/render';
import { errorMessage } from '@/lib/errors';
import {
  parseTypedWallTime,
  sendAtEpoch,
  sendAtLabel,
} from '@/lib/send-time';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymOperatingDefaults } from '@/lib/useGymOperatingDefaults';
import { useThemeColors } from '@/lib/theme';
import type { Database, Json } from '@/types/database';

type Campaign = Database['public']['Tables']['email_campaigns']['Row'];

function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ['comms-campaign', id],
    enabled: !!id,
    queryFn: async (): Promise<Campaign> => {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as Campaign;
    },
  });
}

export default function CampaignDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;
  const canManageComms = useCan('can_manage_comms');
  const campaign = useCampaign(id);

  if (canManageComms === false) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink fallbackHref="/management/communications" />
          <Text className="text-ink-2 dark:text-ink-2-dk">
            You don't have permission to manage communications.
          </Text>
        </ScrollView>
      </Screen>
    );
  }
  if (campaign.isLoading) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
      </Screen>
    );
  }
  if (campaign.isError || !campaign.data) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink fallbackHref="/management/communications" />
          <Text className="text-red-500 dark:text-red-400">
            {errorMessage(campaign.error, 'Could not load this campaign')}
          </Text>
        </ScrollView>
      </Screen>
    );
  }
  return campaign.data.status === 'draft' ||
    campaign.data.status === 'scheduled' ? (
    <EditorView campaign={campaign.data} />
  ) : (
    <ReportView campaign={campaign.data} />
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function EditorView({ campaign }: { campaign: Campaign }) {
  const { data: membership } = useGymMembership();
  const brand = useGymBrand();
  const colors = useThemeColors();
  const settings = useCommsSettings();
  const send = useSendCampaign();
  const schedule = useScheduleCampaign();
  const unschedule = useUnscheduleCampaign();
  const [scheduleAt, setScheduleAt] = useState<string>('');
  // The gym's timezone, not the device's. A coach scheduling next week's
  // newsletter from a beach should book the hour the members will read
  // it at, which is the same rule the timetable and the cutoffs follow.
  const tz = useGymOperatingDefaults().data?.timezone ?? 'Europe/London';
  const scheduledEpoch = (() => {
    const w = parseTypedWallTime(scheduleAt);
    return w ? sendAtEpoch(w, tz, Date.now()) : null;
  })();
  const queryClient = useQueryClient();

  const brandSeed: BrandSeed = useMemo(
    () => ({
      primaryColor: brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      textColor: brand.textColor,
    }),
    [brand.primaryColor, brand.secondaryColor, brand.textColor],
  );

  const [title, setTitle] = useState(campaign.title);
  const [subject, setSubject] = useState(campaign.subject);
  const [variants, setVariants] = useState<string[]>(
    (campaign.subject_variants as string[] | null) ?? [],
  );
  const [preheader, setPreheader] = useState(campaign.preheader);
  const [fromName, setFromName] = useState(campaign.from_name ?? '');
  const history = useEmailHistory(() =>
    coerceDocument(campaign.design, brandSeed),
  );
  const {
    document,
    set: setDocument,
    reset: resetDocument,
    undo,
    redo,
    canUndo,
    canRedo,
  } = history;
  const [audience, setAudience] = useState<AudienceDefinition>(() =>
    normalizeAudience(campaign.audience),
  );
  const [topicId, setTopicId] = useState<string | null>(campaign.topic_id ?? null);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [confirming, setConfirming] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 'setup' = the campaign form (name, audience, send); 'design' = the
  // full-screen email builder. Same component owns the document so there's
  // no cross-route state to sync.
  const [mode, setMode] = useState<'setup' | 'design'>('setup');

  const initialized = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate once from the loaded row.
  useEffect(() => {
    if (initialized.current) return;
    setTitle(campaign.title);
    setSubject(campaign.subject);
    setPreheader(campaign.preheader);
    setFromName(campaign.from_name ?? '');
    resetDocument(coerceDocument(campaign.design, brandSeed));
    setAudience(normalizeAudience(campaign.audience));
    setTopicId(campaign.topic_id ?? null);
    initialized.current = true;
  }, [campaign, brandSeed, resetDocument]);

  const persist = useMemo(
    () =>
      async function persist() {
        setSaveState('saving');
        const { error: upErr } = await supabase
          .from('email_campaigns')
          .update({
            title: title.trim() || 'Untitled campaign',
            subject,
            subject_variants: variants.filter((v) => v.trim().length > 0),
            preheader,
            from_name: fromName.trim() || null,
            design: document as unknown as Json,
            audience: audience as unknown as Json,
            topic_id: topicId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaign.id);
        if (upErr) {
          setSaveState('idle');
          setError(errorMessage(upErr, 'Could not save'));
        } else {
          setSaveState('saved');
          // Keep the campaign list fresh so a saved draft shows up without
          // a hard refresh, even when the list stayed mounted underneath.
          void queryClient.invalidateQueries({ queryKey: ['comms-campaigns'] });
        }
      },
    [
      title,
      subject,
      variants,
      preheader,
      fromName,
      document,
      audience,
      topicId,
      campaign.id,
      queryClient,
    ],
  );

  // Save immediately (used by the explicit Save buttons), cancelling any
  // pending debounced write so we don't double-save.
  const saveNow = useMemo(
    () =>
      function saveNow() {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void persist();
      },
    [persist],
  );

  // Debounced autosave on any edit. Marking 'idle' first makes the Save
  // button reflect that there are unsaved changes until the write lands.
  useEffect(() => {
    if (!initialized.current) return;
    setSaveState('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [persist]);

  // Cmd/Ctrl+Z / Shift+Z / Ctrl+Y drive the document history while the
  // builder is open. Skip when the caret is in a form field so the browser's
  // native text undo still works there; the canvas is an iframe, so its own
  // keystrokes never reach this listener.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (mode !== 'design') return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      } else if (key === 'z') {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, undo, redo]);

  const footer = {
    businessName: settings.data?.footer_business_name || brand.gymName,
    address: settings.data?.footer_address ?? '',
  };

  const previewHtml = useMemo(
    () => renderEmailHtml(document, { preheader, footer, unsubscribeUrl: '#' }),
    [document, preheader, footer.businessName, footer.address],
  );

  const audienceCount = useAudienceCount(audience, topicId);
  const warnings = documentWarnings(document);
  const audienceEmpty = isAudienceEmptyByConstruction(audience);
  const noSubject = subject.trim().length === 0;
  const count = audienceCount.data ?? 0;
  const canSend =
    !audienceEmpty && !noSubject && warnings.length === 0 && count > 0 && !send.isPending;

  async function doSend() {
    setError(null);
    try {
      await persist();
      await send.mutateAsync({
        campaignId: campaign.id,
        document,
        preheader,
        footer,
      });
      // The campaign query invalidates → this screen re-renders as the
      // report once the status flips to 'sent'.
    } catch (e) {
      setError(errorMessage(e, 'Could not send the campaign'));
      setConfirming(false);
    }
  }

  async function doSchedule() {
    setError(null);
    try {
      await persist();
      await schedule.mutateAsync({
        campaignId: campaign.id,
        sendAt: new Date(scheduledEpoch!).toISOString(),
        document,
        preheader,
        footer,
      });
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not schedule the campaign'));
    }
  }

  if (mode === 'design') {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="flex-1 gap-3 py-4">
          <View className="flex-row items-center gap-3">
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
              Design email
            </Text>
            <View className="flex-row items-center gap-1">
              <HistoryButton
                icon="arrow-undo-outline"
                label="Undo"
                onPress={undo}
                disabled={!canUndo}
              />
              <HistoryButton
                icon="arrow-redo-outline"
                label="Redo"
                onPress={redo}
                disabled={!canRedo}
              />
            </View>
            <SaveButton state={saveState} onPress={saveNow} />
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
            <ScrollView className="flex-1" contentContainerClassName="pb-4">
              <HtmlPreview html={previewHtml} />
            </ScrollView>
          ) : (
            <EmailEditor
              document={document}
              onChange={setDocument}
              brand={brandSeed}
              gymId={membership?.gymId ?? ''}
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
          title="Edit campaign"
          subtitle="Build your email, choose who gets it, then send."
          action={<SaveButton state={saveState} onPress={saveNow} />}
        />

        {/* Details */}
        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Input
            label="Campaign name (internal)"
            value={title}
            onChangeText={setTitle}
            autoCapitalize="sentences"
            placeholder="June newsletter"
          />
          <Input
            label={variants.length > 0 ? 'Subject line A' : 'Subject line'}
            value={subject}
            onChangeText={setSubject}
            autoCapitalize="sentences"
            placeholder="What members see in their inbox"
          />
          {/* A/B subject test. Recipients are split evenly and
              deterministically at snapshot time, so a retry cannot put two
              different subjects in front of the same person. */}
          {variants.map((v, i) => (
            <View key={`variant-${i}`} className="flex-row items-end gap-2">
              <View className="flex-1">
                <Input
                  label={`Subject line ${String.fromCharCode(66 + i)}`}
                  value={v}
                  onChangeText={(next) =>
                    setVariants((prev) =>
                      prev.map((p, j) => (j === i ? next : p)),
                    )
                  }
                  autoCapitalize="sentences"
                  placeholder="A different way of saying it"
                />
              </View>
              <ChipButton
                tone="neutral"
                icon="close-outline"
                label="Remove"
                onPress={() =>
                  setVariants((prev) => prev.filter((_, j) => j !== i))
                }
              />
            </View>
          ))}
          {variants.length < 3 ? (
            <ChipButton
              className="self-start"
              tone="neutral"
              icon="git-branch-outline"
              label={
                variants.length === 0
                  ? 'Test another subject line'
                  : 'Add another'
              }
              onPress={() => setVariants((prev) => [...prev, ''])}
            />
          ) : null}
          <Input
            label="Preview text (optional)"
            value={preheader}
            onChangeText={setPreheader}
            autoCapitalize="sentences"
            placeholder="The snippet shown after the subject"
          />
          <Input
            label="From name (optional)"
            value={fromName}
            onChangeText={setFromName}
            autoCapitalize="words"
            placeholder={brand.gymName}
          />
        </View>

        {/* Design entry — opens the full-screen builder */}
        <Pressable
          onPress={() => setMode('design')}
          className="bg-surface dark:bg-surface-dk rounded-xl p-4 flex-row items-center gap-3 border border-primary/30 hover:border-primary/60 active:opacity-80">
          <View className="w-11 h-11 rounded-full bg-primary/15 items-center justify-center">
            <Ionicons name="brush-outline" size={22} color={brand.primaryColor} />
          </View>
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Design your email
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {document.blocks.length === 0
                ? 'Empty — open the builder to add content.'
                : `${document.blocks.length} block${
                    document.blocks.length === 1 ? '' : 's'
                  } · open the builder`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink3} />
        </Pressable>

        {/* Topic */}
        <View className="gap-2">
          <FieldLabel>
            Topic
          </FieldLabel>
          <TopicPicker
            gymId={membership?.gymId ?? null}
            value={topicId}
            onChange={setTopicId}
          />
        </View>

        {/* Audience */}
        <View className="gap-2">
          <FieldLabel>
            Audience
          </FieldLabel>
          <AudienceBuilder value={audience} onChange={setAudience} />
        </View>

        {/* Warnings */}
        {warnings.length > 0 ? (
          <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 gap-1">
            {warnings.map((w) => (
              <Text key={w} className="text-amber-700 dark:text-amber-400 text-xs">
                • {w}
              </Text>
            ))}
          </View>
        ) : null}

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        {/* Send / confirm */}
        {confirming ? (
          <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 border border-primary/30">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Send to {count} {count === 1 ? 'member' : 'members'}?
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              {describeAudience(audience)}. This can't be undone.
            </Text>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={() => setConfirming(false)}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button onPress={doSend} loading={send.isPending}>
                  Send now
                </Button>
              </View>
            </View>
          </View>
        ) : (
          <View className="gap-3">
            <Button onPress={() => setConfirming(true)} disabled={!canSend}>
              Send campaign
            </Button>

            {/* Schedule. scheduled_for and the amber Scheduled badge have
                existed since 0044 with nothing ever writing the column. */}
            {campaign.status === 'scheduled' && campaign.scheduled_for ? (
              <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 gap-2">
                <Text className="text-amber-800 dark:text-amber-300 text-sm">
                  Scheduled to send{' '}
                  {sendAtLabel(new Date(campaign.scheduled_for).getTime(), tz)}
                  . Edits after this point will not go out — the version you
                  scheduled is the version that sends.
                </Text>
                <ChipButton
                  className="self-start"
                  tone="amber"
                  icon="close-circle-outline"
                  label="Cancel schedule"
                  onPress={() =>
                    unschedule.mutate(campaign.id, {
                      // The dispatcher closes this window by flipping the
                      // row to 'sending', and the RPC then raises rather
                      // than no-opping. Swallowing that told somebody
                      // their email was cancelled while it was going out.
                      onError: (e) =>
                        setError(
                          errorMessage(
                            e,
                            'Could not cancel — it may already have gone out.',
                          ),
                        ),
                      onSuccess: () => setError(null),
                    })
                  }
                />
              </View>
            ) : (
              <View className="bg-surface dark:bg-surface-dk rounded-xl p-3 gap-2 border border-line dark:border-line-dk">
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Or send it later. Times are the gym's own ({tz}), wherever
                  you happen to be; delivery starts within about fifteen
                  minutes of the slot.
                </Text>
                <Input
                  label="Send at"
                  value={scheduleAt}
                  onChangeText={setScheduleAt}
                  placeholder="2026-08-01 18:30"
                  autoCapitalize="none"
                />
                <ChipButton
                  className="self-start"
                  tone="primary"
                  icon="time-outline"
                  label="Schedule"
                  disabled={!canSend || scheduledEpoch === null}
                  onPress={doSchedule}
                />
              </View>
            )}
            {noSubject ? (
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center">
                Add a subject line to enable sending.
              </Text>
            ) : audienceEmpty || count === 0 ? (
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center">
                Choose an audience with at least one reachable member.
              </Text>
            ) : null}
            <DeleteCampaignButton campaignId={campaign.id} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

// Undo/redo controls for the builder header. Icon-only to sit quietly next
// to Save; disabled (dimmed) when there's nothing to step to.
function HistoryButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`w-8 h-8 rounded-lg items-center justify-center active:opacity-70 ${
        disabled ? 'opacity-30' : 'hover:bg-raised dark:hover:bg-raised-dk'
      }`}>
      <Ionicons name={icon} size={18} color={colors.ink2} />
    </Pressable>
  );
}

// Explicit Save control: autosave still runs, but a visible button plus a
// "Saved" confirmation removes the guesswork about whether edits landed.
function SaveButton({
  state,
  onPress,
}: {
  state: 'idle' | 'saving' | 'saved';
  onPress: () => void;
}) {
  const saved = state === 'saved';
  return (
    <Pressable
      onPress={onPress}
      disabled={state === 'saving'}
      hitSlop={6}
      className={`flex-row items-center gap-1.5 rounded-lg px-3 py-1.5 active:opacity-80 hover:opacity-90 ${
        saved
          ? 'bg-green-500/10'
          : 'bg-primary disabled:opacity-70'
      }`}>
      {state === 'saving' ? (
        <ActivityIndicator size="small" color={saved ? '#16A34A' : '#FFFFFF'} />
      ) : (
        <Ionicons
          name={saved ? 'checkmark-circle' : 'save-outline'}
          size={15}
          color={saved ? '#16A34A' : '#FFFFFF'}
        />
      )}
      <Text
        className={`text-sm font-semibold ${
          saved ? 'text-green-700 dark:text-green-400' : 'text-white'
        }`}>
        {state === 'saving' ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </Text>
    </Pressable>
  );
}

function DeleteCampaignButton({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('email_campaigns')
        .delete()
        .eq('id', campaignId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comms-campaigns'] });
      router.replace('/management/communications');
    },
  });
  if (!confirming) {
    return (
      <Button variant="ghost" onPress={() => setConfirming(true)}>
        Delete draft
      </Button>
    );
  }
  return (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <Button variant="ghost" onPress={() => setConfirming(false)}>
          Keep
        </Button>
      </View>
      <View className="flex-1">
        <Button variant="destructive" onPress={() => del.mutate()} loading={del.isPending}>
          Delete
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Report (sent / sending / failed)
// ---------------------------------------------------------------------------

function ReportView({ campaign }: { campaign: Campaign }) {
  const brand = useGymBrand();
  const settings = useCommsSettings();
  const queryClient = useQueryClient();

  const stats = useQuery({
    queryKey: ['comms-campaign-stats', campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('comms_campaign_stats', {
        p_campaign_id: campaign.id,
      });
      if (error) throw error;
      const rows = data as {
        recipients: number;
        sent: number;
        delivered: number;
        successful: number;
        simulated: number;
        failed: number;
        bounced: number;
        complained: number;
        opened: number;
        clicked: number;
        unsubscribed: number;
        skipped: number;
        tracked: boolean;
      }[];
      return rows[0] ?? null;
    },
    // Delivery reports land over the minutes after a send finishes, so a
    // report opened straight away is watching numbers that are still
    // moving.
    refetchInterval: 30_000,
  });

  const trouble = useQuery({
    queryKey: ['comms-campaign-trouble', campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_campaign_recipients')
        .select('id, email, full_name, status, error, complained_at')
        .eq('campaign_id', campaign.id)
        .or('status.eq.bounced,complained_at.not.is.null')
        .order('email')
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const variantStats = useQuery({
    queryKey: ['comms-variant-stats', campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('comms_variant_stats', {
        p_campaign_id: campaign.id,
      });
      if (error) throw error;
      return (data ?? []) as {
        variant: number;
        subject: string | null;
        recipients: number;
        delivered: number;
        opened: number;
      }[];
    },
  });

  const s = stats.data;
  const sent = s?.sent ?? 0;
  const fullySimulated = !!s && s.sent > 0 && s.simulated === s.sent;
  // The shape of the report — which number leads, which tiles earn a
  // place, when a percentage is worth printing — is decided in
  // src/lib/campaign-report.ts, so it is testable without a screen and
  // says the same thing wherever it is read.
  const tracked = !!s?.tracked;
  const report = campaignReport({
    recipients: s?.recipients ?? 0,
    sent,
    successful: s?.successful ?? 0,
    simulated: s?.simulated ?? 0,
    failed: s?.failed ?? 0,
    skipped: s?.skipped ?? 0,
    bounced: s?.bounced ?? 0,
    complained: s?.complained ?? 0,
    opened: s?.opened ?? 0,
    clicked: s?.clicked ?? 0,
    unsubscribed: s?.unsubscribed ?? 0,
    tracked,
  });
  const unmeasured =
    !!s && !tracked && !fullySimulated && s.sent > 0 && campaign.status !== 'sending';
  const troubleRows = trouble.data ?? [];

  const previewHtml = useMemo(() => {
    const doc = coerceDocument(campaign.design, {
      primaryColor: brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      textColor: brand.textColor,
    });
    return renderEmailHtml(doc, {
      preheader: campaign.preheader,
      footer: {
        businessName: settings.data?.footer_business_name || brand.gymName,
        address: settings.data?.footer_address ?? '',
      },
      unsubscribeUrl: '#',
    });
  }, [campaign.design, campaign.preheader, brand, settings.data]);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-3xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/communications" />
      <PageHead
        title={campaign.title || 'Campaign'}
        subtitle={`${campaign.subject || 'No subject'}${
          campaign.sent_at ? ` · sent ${formatDateTime(campaign.sent_at)}` : ''
        }`}
        action={<StatusBadge status={campaign.status} />}
      />

      {campaign.status === 'sending' ? (
        <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex-row items-center gap-3">
          <ActivityIndicator />
          <View className="flex-1">
            <Text className="text-amber-700 dark:text-amber-400 font-semibold text-sm">
              Sending in progress
            </Text>
            <Pressable
              onPress={() =>
                queryClient.invalidateQueries({ queryKey: ['comms-campaign', campaign.id] })
              }>
              <Text className="text-amber-700/80 dark:text-amber-300/80 text-xs underline">
                Refresh
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {fullySimulated ? (
        <View className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 gap-1">
          <Text className="text-blue-700 dark:text-blue-400 font-semibold text-sm">
            Simulated send
          </Text>
          <Text className="text-blue-700/90 dark:text-blue-300/90 text-xs">
            This campaign was recorded as sent to {s?.simulated} members, but no
            email actually left the building — connect a sending domain to
            deliver for real and unlock open / click analytics.
          </Text>
        </View>
      ) : null}

      {/* Subject A/B result. Open rate only: a click-rate difference
          between two subject lines is a difference in who opened,
          measured twice. */}
      {(variantStats.data ?? []).length > 1 ? (
        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Subject line test
          </Text>
          {(variantStats.data ?? []).map((v, i) => {
            const rate =
              v.delivered > 0 ? Math.round((v.opened / v.delivered) * 100) : 0;
            const best = Math.max(
              ...(variantStats.data ?? []).map((x) =>
                x.delivered > 0 ? x.opened / x.delivered : 0,
              ),
            );
            const won = v.delivered > 0 && v.opened / v.delivered === best;
            return (
              <View
                key={v.variant}
                className="flex-row items-center gap-3 border-t border-line dark:border-line-dk pt-2">
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs w-4">
                  {String.fromCharCode(65 + i)}
                </Text>
                <Text
                  className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm"
                  numberOfLines={2}>
                  {v.subject ?? '(no subject)'}
                </Text>
                <Text
                  className={`text-sm font-semibold ${
                    won
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-ink-2 dark:text-ink-2-dk'
                  }`}>
                  {fullySimulated ? '—' : `${rate}%`}
                </Text>
              </View>
            );
          })}
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Open rate per subject, from an even split of the audience.
          </Text>
        </View>
      ) : null}

      {unmeasured ? (
        <View className="bg-ink-3/10 border border-ink-3/30 rounded-xl p-4 gap-1">
          <Text className="text-ink-2 dark:text-ink-2-dk font-semibold text-sm">
            Not measured
          </Text>
          <Text className="text-ink-2 dark:text-ink-3 text-xs">
            No delivery reports came back for this send, so we know it went out
            and nothing more. Sends from before delivery reporting was switched
            on will always read this way — an unmeasured zero and a real zero
            are different things, so this shows a dash rather than 0%.
          </Text>
        </View>
      ) : null}

      {/* What left, what arrived, what came of it — one hero number and
          only the tiles with something to say (src/lib/campaign-report). */}
      <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-5 gap-0.5">
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs font-semibold">
          {report.hero.label}
        </Text>
        <Text className="text-ink dark:text-ink-dk text-5xl font-semibold">
          {report.hero.value}
        </Text>
        {report.hero.detail ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            {report.hero.detail}
          </Text>
        ) : null}
      </View>

      {report.tiles.length > 0 ? (
        <View className="flex-row gap-3 flex-wrap">
          {report.tiles.map((t) => (
            <StatTile
              key={t.label}
              title={t.label}
              value={t.value}
              subtitle={t.detail}
              tone={t.tone}
              minWidth={150}
            />
          ))}
        </View>
      ) : null}

      {troubleRows.length > 0 ? (
        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Addresses we can no longer reach
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            These are held back from future sends. If one was a typo that has
            since been fixed, clear it from Communications → Settings and the
            next send will include them again.
          </Text>
          {troubleRows.map((r) => (
            <View
              key={r.id}
              className="border-t border-line dark:border-line-dk pt-2 gap-0.5">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                {r.full_name ? `${r.full_name} · ` : ''}
                {r.email}
              </Text>
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                {r.complained_at
                  ? 'Marked it as spam'
                  : (r.error ?? 'The address bounced')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-2">
        <SectionLabel>
          What you sent
        </SectionLabel>
        <HtmlPreview html={previewHtml} height={420} />
      </View>
      </ScrollView>
    </Screen>
  );
}

function TopicPicker({
  gymId,
  value,
  onChange,
}: {
  gymId: string | null;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const topics = useQuery({
    queryKey: ['gym-email-topics', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<{ id: string; label: string }[]> => {
      const { data, error } = await supabase
        .from('gym_email_topics')
        .select('id, label')
        .eq('gym_id', gymId!)
        .is('archived_at', null)
        .order('sort_order')
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = topics.data ?? [];

  return (
    <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-2">
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        Members who unsubscribed from this topic won't receive this send.
        Leave on "No topic" to suppress only members who hit the master "stop
        all" toggle.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={() => onChange(null)}
          className={`px-3 py-1.5 rounded-full border ${
            value === null
              ? 'border-transparent bg-raised dark:bg-raised-dk'
              : 'border-line dark:border-line-dk'
          }`}>
          <Text
            className={`text-xs font-medium ${
              value === null
                ? 'text-ink dark:text-ink-dk font-semibold'
                : 'text-ink-2 dark:text-ink-2-dk'
            }`}>
            No topic
          </Text>
        </Pressable>
        {rows.map((t) => {
          const sel = value === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => onChange(t.id)}
              className={`px-3 py-1.5 rounded-full border ${
                sel
                  ? 'border-transparent bg-raised dark:bg-raised-dk'
                  : 'border-line dark:border-line-dk'
              }`}>
              <Text
                className={`text-xs font-medium ${
                  sel ? 'text-ink dark:text-ink-dk font-semibold' : 'text-ink-2 dark:text-ink-2-dk'
                }`}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {rows.length === 0 ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
          No topics set up yet. Go to Communications → Email topics to add
          some.
        </Text>
      ) : null}
    </View>
  );
}
