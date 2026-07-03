import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen } from '@/components/Screen';
import { SiteEditor } from '@/components/website/SiteEditor';
import { SiteHtmlPreview } from '@/components/website/SiteHtmlPreview';
import { BRAND_THEMES, composeThemeWithBrand, isThemeId } from '@/lib/brand-themes';
import { useCustomDomain } from '@/lib/custom-domain';
import { errorMessage } from '@/lib/errors';
import { isFieldEditable, parseFieldPath } from '@/lib/site-canvas-sync';
import {
  renderSiteHtml,
  type PublicPlan,
  type ScheduleSession,
  type TeamMember,
} from '@/lib/site-render';
import {
  coerceDocument,
  documentWarnings,
  emptyDocument,
  updateBlock,
  type SiteBlock,
  type SiteDocument,
  type TestimonialsBlock,
} from '@/lib/site-blocks';
import { SITE_TEMPLATES, SITE_TEMPLATE_LIST, type SiteTemplateId } from '@/lib/site-templates';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useGymBrand } from '@/lib/useGymBrand';
import { useGymWebsite } from '@/lib/use-gym-website';
import type { Json } from '@/types/database';

type GymWebsiteSettings = { websiteBuilderEnabled: boolean; currency: string };

function useGymWebsiteSettings(gymId: string | null | undefined) {
  return useQuery({
    queryKey: ['website-builder-settings', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<GymWebsiteSettings> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('website_builder_enabled, currency')
        .eq('id', gymId!)
        .single();
      if (error) throw error;
      return { websiteBuilderEnabled: data.website_builder_enabled, currency: data.currency };
    },
  });
}

// The staff-side preview reads schedule/pricing directly under the
// signed-in staff member's own RLS, not the anon public RPCs — those
// only ever return data for an already-published site, which would
// leave a draft's preview looking empty right when an owner most needs
// to see it.
type StaffScheduleRow = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  class_types: { name: string; color: string } | null;
  profiles: { full_name: string | null } | null;
};

type StaffTeamRow = {
  profile_id: string;
  role: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function useStaffPreviewData(gymId: string | null | undefined) {
  const schedule = useQuery({
    queryKey: ['website-preview-schedule', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<ScheduleSession[]> => {
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from('class_sessions')
        .select('id, starts_at, duration_minutes, class_types(name, color), profiles(full_name)')
        .eq('gym_id', gymId!)
        .gte('starts_at', now.toISOString())
        .lt('starts_at', in7Days.toISOString())
        .order('starts_at')
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as unknown as StaffScheduleRow[];
      return rows.map((s) => ({
        sessionId: s.id,
        startsAt: s.starts_at,
        durationMinutes: s.duration_minutes,
        classTypeName: s.class_types?.name ?? null,
        classTypeColor: s.class_types?.color ?? null,
        coachName: s.profiles?.full_name ?? null,
      }));
    },
  });

  const plans = useQuery({
    queryKey: ['website-preview-plans', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<PublicPlan[]> => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('plan_id, name, kind, credit_count, monthly_price_cents')
        .eq('gym_id', gymId!)
        .is('archived_at', null)
        .order('monthly_price_cents', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        planId: p.plan_id,
        name: p.name,
        kind: p.kind,
        creditCount: p.credit_count,
        monthlyPriceCents: p.monthly_price_cents,
      }));
    },
  });

  const team = useQuery({
    queryKey: ['website-preview-team', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, role, profiles!profile_id(full_name, avatar_url)')
        .eq('gym_id', gymId!)
        .in('role', ['owner', 'admin', 'coach', 'staff'])
        .is('left_at', null);
      if (error) throw error;
      const rows = (data ?? []) as unknown as StaffTeamRow[];
      // Mirrors gym_public_team's own ordering (0100) so the preview
      // matches what a visitor will actually see.
      const rolePriority: Record<string, number> = { owner: 0, admin: 1, coach: 2, staff: 3 };
      return rows
        .map((r) => ({
          profileId: r.profile_id,
          role: r.role,
          fullName: r.profiles?.full_name ?? 'Team member',
          avatarUrl: r.profiles?.avatar_url ?? null,
        }))
        .sort((a, b) => {
          const roleDiff = (rolePriority[a.role] ?? 9) - (rolePriority[b.role] ?? 9);
          return roleDiff !== 0 ? roleDiff : a.fullName.localeCompare(b.fullName);
        })
        .map(({ profileId, fullName, avatarUrl }) => ({ profileId, fullName, avatarUrl }));
    },
  });

  return { schedule, plans, team };
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'saving') {
    return <Text className="text-gray-400 dark:text-gray-500 text-xs">Saving…</Text>;
  }
  if (state === 'saved') {
    return <Text className="text-green-600 dark:text-green-400 text-xs">Saved</Text>;
  }
  return null;
}

export default function WebsiteManageScreen() {
  const canManageWebsite = useCan('can_manage_website');
  const brand = useGymBrand();
  const settings = useGymWebsiteSettings(brand.gymId);
  const site = useGymWebsite(brand.gymId);
  // Only relevant to the "Live at" label on a published site — skip the
  // fetch entirely for drafts and not-yet-created sites.
  const customDomain = useCustomDomain(site.data?.published ? brand.gymId : undefined);
  const queryClient = useQueryClient();
  const preview = useStaffPreviewData(brand.gymId);

  // Pre-load placeholder only — always overwritten by coerceDocument
  // (site load) or createSite before the editor is ever shown.
  const [document, setDocument] = useState<SiteDocument>(() => emptyDocument());
  const [showPreview, setShowPreview] = useState(false);
  const [creatingId, setCreatingId] = useState<SiteTemplateId | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [publishState, setPublishState] = useState<'idle' | 'working'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<unknown>(null);
  // Bumped only by side-panel/structural edits (block add/remove/reorder,
  // theme changes) — never by canvas keystrokes — so the debounced,
  // syncKey-keyed effect in SiteHtmlPreview.web.tsx can never reload the
  // iframe mid-keystroke. See handlePanelChange/handleCanvasFieldChange.
  const [structuralVersion, setStructuralVersion] = useState(0);
  const debouncedSyncKey = useDebouncedValue(structuralVersion, 350);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isSplitView = Platform.OS === 'web' && width >= 1280;

  const initialized = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True whenever an edit hasn't finished round-tripping to the server —
  // read by the nav-guard and beforeunload listeners below, not state,
  // so an edit doesn't force those listener effects to re-run.
  const unsavedRef = useRef(false);
  const navigation = useNavigation();

  useEffect(() => {
    if (initialized.current || !site.data) return;
    setDocument(coerceDocument(site.data.design));
    initialized.current = true;
  }, [site.data]);

  const persist = useMemo(
    () =>
      async function persist() {
        if (!site.data) return;
        setSaveState('saving');
        const { error: upErr } = await supabase
          .from('gym_websites')
          .update({
            design: document as unknown as Json,
            theme: document.settings.themeId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', site.data.id);
        if (upErr) {
          setSaveState('idle');
          setError(errorMessage(upErr, 'Could not save'));
        } else {
          setSaveState('saved');
          unsavedRef.current = false;
        }
      },
    [document, site.data],
  );

  useEffect(() => {
    if (!initialized.current) return;
    unsavedRef.current = true;
    setSaveState('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [persist]);

  // In-app navigation (BackLink, the Domain link, tab/gesture back) goes
  // through this listener; a real browser tab close/reload doesn't, so
  // it's covered separately by beforeunload below.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (!unsavedRef.current) return;
      e.preventDefault();
      setPendingLeaveAction(e.data.action);
    });
  }, [navigation]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function handler(e: BeforeUnloadEvent) {
      if (!unsavedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  if (canManageWebsite === false) return <Redirect href="/management" />;

  if (settings.isLoading || site.isLoading) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (settings.data?.websiteBuilderEnabled === false) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink label="Manage" fallbackHref="/management" />
          <View className="gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Website
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              A public site for {brand.gymName}, built from your own schedule and pricing.
            </Text>
          </View>
          <View className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 gap-2">
            <Text className="text-gray-700 dark:text-gray-200 text-sm">
              The site builder isn't turned on for your gym yet — get in touch with Temple
              to add it.
            </Text>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  async function createSite(templateId: SiteTemplateId) {
    if (!brand.gymId) return;
    setCreatingId(templateId);
    const design = SITE_TEMPLATES[templateId].build(brand.gymName);
    const { data, error: insErr } = await supabase
      .from('gym_websites')
      .insert({
        gym_id: brand.gymId,
        // The column defaults to 'forged' and the public route reads
        // the column, not design.settings — a light-theme site created
        // and published untouched must not wait for the first autosave
        // to correct it.
        theme: design.settings.themeId,
        design: design as unknown as Json,
      })
      .select('*')
      .single();
    setCreatingId(null);
    if (insErr) {
      setError(errorMessage(insErr, 'Could not create the site'));
      return;
    }
    initialized.current = true;
    setDocument(coerceDocument(data.design));
    queryClient.setQueryData(['gym-website', brand.gymId], data);
  }

  if (!site.data) {
    return (
      <Screen edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
          <BackLink label="Manage" fallbackHref="/management" />
          <View className="gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Website
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Pick a starting point — every word, block and theme can be changed later.
            </Text>
          </View>
          {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}
          <View className="gap-3">
            {SITE_TEMPLATE_LIST.map((t) => {
              const composed = composeThemeWithBrand(BRAND_THEMES[t.themeId], brand.primaryColor);
              return (
                <Pressable
                  key={t.id}
                  onPress={() => void createSite(t.id)}
                  disabled={creatingId != null}
                  className="flex-row items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 active:opacity-70 hover:border-primary">
                  <View
                    className="w-16 h-12 rounded-lg overflow-hidden flex-row"
                    style={{ borderWidth: 1, borderColor: '#00000014' }}>
                    <View className="flex-1" style={{ backgroundColor: composed.palette.background }} />
                    <View className="w-4" style={{ backgroundColor: composed.palette.accent }} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-gray-900 dark:text-gray-50 font-semibold">{t.name}</Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">{t.description}</Text>
                  </View>
                  {creatingId === t.id ? (
                    <ActivityIndicator />
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Screen>
    );
  }

  async function togglePublish() {
    if (!site.data) return;
    const next = !site.data.published;
    // Defense in depth — the Publish button's own `disabled` prop should
    // already prevent reaching this, but never trust the client-only gate.
    if (next && documentWarnings(document).length > 0) return;
    setPublishState('working');
    const { error: pubErr } = await supabase
      .from('gym_websites')
      .update({ published: next, updated_at: new Date().toISOString() })
      .eq('id', site.data!.id);
    setPublishState('idle');
    if (pubErr) {
      setError(errorMessage(pubErr, 'Could not update publish state'));
      return;
    }
    queryClient.setQueryData(['gym-website', brand.gymId], {
      ...site.data!,
      published: next,
    });
  }

  // Side-panel/structural edits: always reload the canvas (debounced via
  // structuralVersion → debouncedSyncKey), since these genuinely change
  // the rendered DOM shape (a block was added/removed/reordered, the
  // theme changed).
  function handlePanelChange(next: SiteDocument) {
    setDocument(next);
    setStructuralVersion((v) => v + 1);
  }

  // Canvas keystrokes: write straight into document state without ever
  // touching structuralVersion, so they can never trigger an iframe
  // reload — see SiteHtmlPreview.web.tsx's syncKey-keyed effect.
  function handleCanvasFieldChange(path: string, value: string) {
    const parsed = parseFieldPath(path);
    if (!parsed) return;
    setDocument((prev) => {
      const block = prev.blocks.find((b) => b.id === parsed.blockId);
      if (!block || !isFieldEditable(block.type, parsed)) return prev;
      if (parsed.kind === 'array-item') {
        if (block.type !== 'testimonials') return prev;
        const quotes = block.quotes.map((q) =>
          q.id === parsed.itemId ? { ...q, [parsed.field]: value } : q,
        );
        return updateBlock<TestimonialsBlock>(prev, block.id, { quotes });
      }
      const patch: Record<string, string> = { [parsed.field]: value };
      return updateBlock<SiteBlock>(prev, block.id, patch as Partial<SiteBlock>);
    });
  }

  const themeId = isThemeId(document.settings.themeId) ? document.settings.themeId : 'forged';
  const composedTheme = composeThemeWithBrand(BRAND_THEMES[themeId], brand.primaryColor);
  const previewHtml = renderSiteHtml(document, {
    slug: brand.slug ?? '',
    gymName: brand.gymName,
    gymLogoUrl: brand.logoUrl,
    gymCurrency: settings.data?.currency ?? 'GBP',
    theme: composedTheme,
    schedule: preview.schedule.data ?? [],
    plans: preview.plans.data ?? [],
    team: preview.team.data ?? [],
    platformOrigin: 'https://app.jointemple.io',
    supabaseUrl: '',
    supabaseAnonKey: '',
    editable: true,
  });
  const warnings = documentWarnings(document);
  // Only blocks the *publish* direction — an already-live site must
  // always be unpublishable regardless of what the document looks like
  // now. Mirrors the email builder's canSend: a hard gate, no override.
  const blockedByWarnings = !site.data.published && warnings.length > 0;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="flex-1 gap-4 py-4 px-4 md:px-6">
        <View className="flex-row items-center gap-3 flex-wrap">
          <BackLink inline label="Manage" fallbackHref="/management" />
          <View className="flex-1 min-w-[160px]">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">Website</Text>
            <SaveIndicator state={saveState} />
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
            ) : null}
          </View>
          {Platform.OS === 'web' && !isSplitView ? (
            <Pressable
              onPress={() => setShowPreview((v) => !v)}
              hitSlop={6}
              className="flex-row items-center gap-1.5 active:opacity-70 hover:opacity-80">
              <Ionicons name={showPreview ? 'create-outline' : 'eye-outline'} size={15} color="#6B7280" />
              <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">
                {showPreview ? 'Back to editor' : 'Preview'}
              </Text>
            </Pressable>
          ) : null}
          <Link href="/management/website/domain" asChild>
            <Pressable hitSlop={6} className="flex-row items-center gap-1.5 active:opacity-70 hover:opacity-80">
              <Ionicons name="globe-outline" size={15} color="#6B7280" />
              <Text className="text-gray-600 dark:text-gray-300 text-sm font-medium">Domain</Text>
            </Pressable>
          </Link>
          <Button
            variant={site.data.published ? 'secondary' : 'primary'}
            loading={publishState === 'working'}
            disabled={blockedByWarnings}
            onPress={togglePublish}>
            {site.data.published ? 'Unpublish' : 'Publish'}
          </Button>
        </View>

        {site.data.published ? (
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Live at{' '}
            {customDomain.data?.status === 'verified'
              ? customDomain.data.domain
              : `/site/${brand.slug}`}
          </Text>
        ) : null}

        {warnings.length > 0 ? (
          <View className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 gap-1">
            {warnings.map((w) => (
              <Text key={w} className="text-amber-700 dark:text-amber-400 text-xs">
                {w}
              </Text>
            ))}
          </View>
        ) : null}

        {isSplitView ? (
          <View className="flex-1 flex-row gap-4">
            <View className="w-[460px] shrink-0">
              <ScrollView className="flex-1" contentContainerClassName="pb-4">
                <SiteEditor
                  document={document}
                  onChange={handlePanelChange}
                  gymId={brand.gymId ?? ''}
                  gymName={brand.gymName}
                  brandPrimaryColor={brand.primaryColor}
                  compact
                  selectedId={selectedId}
                  onSelectBlock={setSelectedId}
                />
              </ScrollView>
            </View>
            <View className="flex-1">
              <SiteHtmlPreview
                html={previewHtml}
                editable
                syncKey={debouncedSyncKey}
                onFieldChange={handleCanvasFieldChange}
                selectedBlockId={selectedId}
                onCanvasSelect={setSelectedId}
                height="100%"
              />
            </View>
          </View>
        ) : showPreview && Platform.OS === 'web' ? (
          <ScrollView className="flex-1" contentContainerClassName="pb-4">
            <SiteHtmlPreview
              html={previewHtml}
              editable
              syncKey={debouncedSyncKey}
              onFieldChange={handleCanvasFieldChange}
              selectedBlockId={selectedId}
              onCanvasSelect={setSelectedId}
            />
          </ScrollView>
        ) : (
          <ScrollView className="flex-1" contentContainerClassName="pb-4">
            <SiteEditor
              document={document}
              onChange={handlePanelChange}
              gymId={brand.gymId ?? ''}
              gymName={brand.gymName}
              brandPrimaryColor={brand.primaryColor}
              selectedId={selectedId}
              onSelectBlock={setSelectedId}
            />
          </ScrollView>
        )}
      </View>

      <ConfirmDialog
        visible={pendingLeaveAction != null}
        title="Leave without saving?"
        body="Your latest changes haven't finished saving. If you leave now they'll be lost."
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
        onConfirm={() => {
          unsavedRef.current = false;
          const action = pendingLeaveAction;
          setPendingLeaveAction(null);
          if (action) navigation.dispatch(action as never);
        }}
        onCancel={() => setPendingLeaveAction(null)}
      />
    </Screen>
  );
}
