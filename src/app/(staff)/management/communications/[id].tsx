import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { AudienceBuilder } from '@/components/email/AudienceBuilder';
import { HtmlPreview } from '@/components/email/HtmlPreview';
import { EmailEditor } from '@/components/email/EmailEditor';
import { StatusBadge } from '@/components/email/CampaignList';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { StatTile } from '@/components/StatTile';
import { useGymMembership } from '@/lib/auth';
import {
  formatDateTime,
  useAudienceCount,
  useCommsSettings,
  useSendCampaign,
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
  type EmailDocument,
} from '@/lib/email/blocks';
import { renderEmailHtml } from '@/lib/email/render';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
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

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl lg:max-w-6xl md:mx-auto md:w-full">
        <BackLink label="Communications" />
        {canManageComms === false ? (
          <Text className="text-gray-500 dark:text-gray-400">
            You don't have permission to manage communications.
          </Text>
        ) : campaign.isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator />
          </View>
        ) : campaign.isError || !campaign.data ? (
          <Text className="text-red-500 dark:text-red-400">
            {errorMessage(campaign.error, 'Could not load this campaign')}
          </Text>
        ) : campaign.data.status === 'draft' || campaign.data.status === 'scheduled' ? (
          <EditorView campaign={campaign.data} />
        ) : (
          <ReportView campaign={campaign.data} />
        )}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function EditorView({ campaign }: { campaign: Campaign }) {
  const { data: membership } = useGymMembership();
  const brand = useGymBrand();
  const settings = useCommsSettings();
  const send = useSendCampaign();

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
  const [preheader, setPreheader] = useState(campaign.preheader);
  const [fromName, setFromName] = useState(campaign.from_name ?? '');
  const [document, setDocument] = useState<EmailDocument>(() =>
    coerceDocument(campaign.design, brandSeed),
  );
  const [audience, setAudience] = useState<AudienceDefinition>(() =>
    normalizeAudience(campaign.audience),
  );
  const [topicId, setTopicId] = useState<string | null>(campaign.topic_id ?? null);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [confirming, setConfirming] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialized = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate once from the loaded row.
  useEffect(() => {
    if (initialized.current) return;
    setTitle(campaign.title);
    setSubject(campaign.subject);
    setPreheader(campaign.preheader);
    setFromName(campaign.from_name ?? '');
    setDocument(coerceDocument(campaign.design, brandSeed));
    setAudience(normalizeAudience(campaign.audience));
    setTopicId(campaign.topic_id ?? null);
    initialized.current = true;
  }, [campaign, brandSeed]);

  const persist = useMemo(
    () =>
      async function persist() {
        setSaveState('saving');
        const { error: upErr } = await supabase
          .from('email_campaigns')
          .update({
            title: title.trim() || 'Untitled campaign',
            subject,
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
        }
      },
    [title, subject, preheader, fromName, document, audience, topicId, campaign.id],
  );

  // Debounced autosave on any edit.
  useEffect(() => {
    if (!initialized.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [persist]);

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

  return (
    <View className="gap-5">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold flex-1">
            Edit campaign
          </Text>
          <SaveIndicator state={saveState} />
        </View>
        <Text className="text-gray-500 dark:text-gray-400">
          Build your email, choose who gets it, then send.
        </Text>
      </View>

      {/* On desktop: settings (details/topic/audience) in a left column,
          the email canvas in a wide right column. Send + warnings sit
          full-width below both, so mobile keeps compose-before-send. */}
      <View className="lg:flex-row lg:items-start gap-5">
      <View className="gap-5 lg:w-[360px] lg:shrink-0">
      {/* Details */}
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
        <Input
          label="Campaign name (internal)"
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          placeholder="June newsletter"
        />
        <Input
          label="Subject line"
          value={subject}
          onChangeText={setSubject}
          autoCapitalize="sentences"
          placeholder="What members see in their inbox"
        />
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

      {/* Topic */}
      <View className="gap-2">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          Topic
        </Text>
        <TopicPicker
          gymId={membership?.gymId ?? null}
          value={topicId}
          onChange={setTopicId}
        />
      </View>

      {/* Audience */}
      <View className="gap-2">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          Audience
        </Text>
        <AudienceBuilder value={audience} onChange={setAudience} />
      </View>
      </View>

      <View className="lg:flex-1">
      {/* Content */}
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
            Content
          </Text>
          {Platform.OS === 'web' ? (
            <Pressable
              onPress={() => setShowPreview((v) => !v)}
              hitSlop={6}
              className="flex-row items-center gap-1.5 active:opacity-70">
              <Ionicons
                name={showPreview ? 'create-outline' : 'eye-outline'}
                size={15}
                color="#6B7280"
              />
              <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
                {showPreview ? 'Back to editor' : 'Preview email'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {showPreview && Platform.OS === 'web' ? (
          <HtmlPreview html={previewHtml} />
        ) : (
          <EmailEditor
            document={document}
            onChange={setDocument}
            brand={brandSeed}
            gymId={membership?.gymId ?? ''}
          />
        )}
      </View>
      </View>
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
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-primary/30">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Send to {count} {count === 1 ? 'member' : 'members'}?
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
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
          {noSubject ? (
            <Text className="text-gray-400 dark:text-gray-500 text-xs text-center">
              Add a subject line to enable sending.
            </Text>
          ) : audienceEmpty || count === 0 ? (
            <Text className="text-gray-400 dark:text-gray-500 text-xs text-center">
              Choose an audience with at least one reachable member.
            </Text>
          ) : null}
          <DeleteCampaignButton campaignId={campaign.id} />
        </View>
      )}
    </View>
  );
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'saving') {
    return (
      <View className="flex-row items-center gap-1">
        <ActivityIndicator size="small" />
        <Text className="text-gray-400 dark:text-gray-500 text-xs">Saving…</Text>
      </View>
    );
  }
  if (state === 'saved') {
    return (
      <View className="flex-row items-center gap-1">
        <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
        <Text className="text-gray-400 dark:text-gray-500 text-xs">Saved</Text>
      </View>
    );
  }
  return null;
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
        simulated: number;
        failed: number;
        bounced: number;
        opened: number;
        clicked: number;
        unsubscribed: number;
      }[];
      return rows[0] ?? null;
    },
  });

  const s = stats.data;
  const reached = s?.sent ?? 0;
  const openRate = reached > 0 ? Math.round(((s?.opened ?? 0) / reached) * 100) : 0;
  const clickRate = reached > 0 ? Math.round(((s?.clicked ?? 0) / reached) * 100) : 0;
  const fullySimulated = !!s && s.sent > 0 && s.simulated === s.sent;

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
    <View className="gap-5">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold flex-1">
            {campaign.title || 'Campaign'}
          </Text>
          <StatusBadge status={campaign.status} />
        </View>
        <Text className="text-gray-500 dark:text-gray-400">
          {campaign.subject || 'No subject'}
          {campaign.sent_at ? ` · sent ${formatDateTime(campaign.sent_at)}` : ''}
        </Text>
      </View>

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

      {/* Funnel */}
      <View className="flex-row gap-3 flex-wrap">
        <StatTile title="Recipients" value={s?.recipients ?? '—'} minWidth={100} />
        <StatTile title="Delivered" value={reached} minWidth={100} />
        <StatTile
          title="Opened"
          value={fullySimulated ? '—' : `${openRate}%`}
          subtitle={fullySimulated ? undefined : `${s?.opened ?? 0} opens`}
          minWidth={100}
        />
        <StatTile
          title="Clicked"
          value={fullySimulated ? '—' : `${clickRate}%`}
          subtitle={fullySimulated ? undefined : `${s?.clicked ?? 0} clicks`}
          minWidth={100}
        />
        <StatTile
          title="Unsubscribed"
          value={s?.unsubscribed ?? 0}
          minWidth={100}
          tone={(s?.unsubscribed ?? 0) > 0 ? 'red' : 'muted'}
        />
        {(s?.failed ?? 0) + (s?.bounced ?? 0) > 0 ? (
          <StatTile
            title="Failed / bounced"
            value={(s?.failed ?? 0) + (s?.bounced ?? 0)}
            tone="red"
            minWidth={100}
          />
        ) : null}
      </View>

      <View className="gap-2">
        <Text className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest">
          What you sent
        </Text>
        <HtmlPreview html={previewHtml} height={420} />
      </View>
    </View>
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
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        Members who unsubscribed from this topic won't receive this send.
        Leave on "No topic" to suppress only members who hit the master "stop
        all" toggle.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={() => onChange(null)}
          className={`px-3 py-1.5 rounded-full border ${
            value === null
              ? 'border-primary bg-primary/10'
              : 'border-gray-200 dark:border-gray-700'
          }`}>
          <Text
            className={`text-xs font-medium ${
              value === null
                ? 'text-primary'
                : 'text-gray-700 dark:text-gray-200'
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
                  ? 'border-primary bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
              <Text
                className={`text-xs font-medium ${
                  sel ? 'text-primary' : 'text-gray-700 dark:text-gray-200'
                }`}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {rows.length === 0 ? (
        <Text className="text-gray-400 dark:text-gray-500 text-xs">
          No topics set up yet. Go to Communications → Email topics to add
          some.
        </Text>
      ) : null}
    </View>
  );
}
