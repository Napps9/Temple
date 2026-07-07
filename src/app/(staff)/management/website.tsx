import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
        .select(
          'id, starts_at, duration_minutes, class_types(name, color), profiles!coach_id(full_name)',
        )
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

// Collapsed by default — a standing amber banner cost real vertical
// space in the editor column for something most owners only need to
// read once, right before they try to publish.
function WarningsChip({
  warnings,
  expanded,
  onToggle,
}: {
  warnings: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <View className="gap-2">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center gap-1.5 self-start bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-full pl-1.5 pr-2.5 py-1 active:opacity-70">
        <View className="w-4 h-4 rounded-full bg-amber-500 items-center justify-center">
          <Text className="text-white text-[9px] font-bold">{warnings.length}</Text>
        </View>
        <Text className="text-amber-700 dark:text-amber-400 text-xs font-medium">
          {warnings.length === 1 ? 'thing' : 'things'} to fix before publishing
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color="#B45309" />
      </Pressable>
      {expanded ? (
        <View className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 gap-1">
          {warnings.map((w) => (
            <Text key={w} className="text-amber-700 dark:text-amber-400 text-xs">
              {w}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
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
  const [warningsExpanded, setWarningsExpanded] = useState(false);
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

  // Takes the document explicitly rather than closing over state, and is
  // only ever called from the two real-edit paths (handlePanelChange /
  // handleCanvasFieldChange) below — never from a useEffect reacting to
  // `document` itself. That distinction matters: the initial load also
  // changes `document` (emptyDocument() -> the loaded design), and an
  // effect keyed on that change would schedule a save carrying whatever
  // `document` a stale closure captured at that instant — a real race
  // that depends on the next render happening before the 1200ms timer
  // fires to avoid overwriting the loaded design with a blank one.
  async function persistDocument(doc: SiteDocument) {
    if (!site.data) return;
    setSaveState('saving');
    const { error: upErr } = await supabase
      .from('gym_websites')
      .update({
        design: doc as unknown as Json,
        theme: doc.settings.themeId,
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
  }

  function scheduleSave(next: SiteDocument) {
    unsavedRef.current = true;
    setSaveState('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistDocument(next), 1200);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // The staff preview's schedule/plans/team queries resolve after the
  // first paint, but the editable iframe only reloads on structuralVersion
  // changing (see SiteHtmlPreview.web.tsx — deliberately never on `html`
  // itself, so a canvas keystroke can't trigger a reload mid-word). Left
  // alone, that means a page load that finishes those queries a moment
  // after the first render never gets shown — the schedule block stays on
  // whatever it rendered (usually empty) forever. Bump structuralVersion
  // once, the first time all three have settled, to pick up the real data.
  const previewDataSynced = useRef(false);
  useEffect(() => {
    if (previewDataSynced.current) return;
    // data !== undefined (not !isLoading) — a query that's still enabled:
    // false while brand.gymId resolves reads isLoading: false too in v5,
    // which would mark this synced before anything actually loaded.
    const settled = (d: unknown, isError: boolean) => d !== undefined || isError;
    if (
      !settled(preview.schedule.data, preview.schedule.isError) ||
      !settled(preview.plans.data, preview.plans.isError) ||
      !settled(preview.team.data, preview.team.isError)
    ) {
      return;
    }
    previewDataSynced.current = true;
    setStructuralVersion((v) => v + 1);
  }, [
    preview.schedule.data,
    preview.schedule.isError,
    preview.plans.data,
    preview.plans.isError,
    preview.team.data,
    preview.team.isError,
  ]);

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
    scheduleSave(next);
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
      let next: SiteDocument;
      if (parsed.kind === 'array-item') {
        if (block.type !== 'testimonials') return prev;
        const quotes = block.quotes.map((q) =>
          q.id === parsed.itemId ? { ...q, [parsed.field]: value } : q,
        );
        next = updateBlock<TestimonialsBlock>(prev, block.id, { quotes });
      } else {
        const patch: Record<string, string> = { [parsed.field]: value };
        next = updateBlock<SiteBlock>(prev, block.id, patch as Partial<SiteBlock>);
      }
      scheduleSave(next);
      return next;
    });
  }

  const themeId = isThemeId(document.settings.themeId) ? document.settings.themeId : 'forged';
  const composedTheme = composeThemeWithBrand(BRAND_THEMES[themeId], brand.primaryColor);
  const siteRenderCtx = {
    slug: brand.slug ?? '',
    gymName: brand.gymName,
    gymLogoUrl: brand.logoUrl,
    gymCurrency: settings.data?.currency ?? 'GBP',
    theme: composedTheme,
    schedule: preview.schedule.data ?? [],
    plans: preview.plans.data ?? [],
    team: preview.team.data ?? [],
    now: new Date().toISOString(),
    platformOrigin: 'https://app.jointemple.io',
    supabaseUrl: '',
    supabaseAnonKey: '',
  };
  const previewHtml = renderSiteHtml(document, { ...siteRenderCtx, editable: true });
  // Preview mode renders this instead — no contentEditable, no canvas-sync
  // script, byte-identical to what /api/site/[slug] actually ships. Only
  // computed while previewing, since it's not needed on every keystroke.
  const trueDocumentHtml = showPreview
    ? renderSiteHtml(document, { ...siteRenderCtx, editable: false })
    : null;
  const warnings = documentWarnings(document);
  // Only blocks the *publish* direction — an already-live site must
  // always be unpublishable regardless of what the document looks like
  // now. Mirrors the email builder's canSend: a hard gate, no override.
  const blockedByWarnings = !site.data.published && warnings.length > 0;

  // Save state, "Live at" and publish warnings used to sit in a shared
  // row above the split view, permanently costing height the preview
  // could otherwise use. They live in the editor column now — same
  // information, read right next to the blocks that caused it — while
  // Domain/Publish stay in the top bar since they're reachable from
  // every view mode, including the mobile preview-only screen where
  // the editor column isn't rendered at all.
  const statusBlock = (
    <View className="gap-2">
      <View className="flex-row items-center gap-2 flex-wrap">
        <SaveIndicator state={saveState} />
        {site.data.published ? (
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Live at{' '}
            {customDomain.data?.status === 'verified'
              ? customDomain.data.domain
              : `/site/${brand.slug}`}
          </Text>
        ) : null}
      </View>
      {error ? <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text> : null}
      {warnings.length > 0 ? (
        <WarningsChip
          warnings={warnings}
          expanded={warningsExpanded}
          onToggle={() => setWarningsExpanded((v) => !v)}
        />
      ) : null}
    </View>
  );

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="flex-1">
        <View className="flex-row items-center gap-3 py-3 px-4 md:px-6 border-b border-gray-100 dark:border-gray-800">
          <BackLink inline label="Manage" fallbackHref="/management" />
          <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">Website</Text>
          {Platform.OS === 'web' ? (
            <Button
              variant={showPreview ? 'primary' : 'secondary'}
              icon={showPreview ? 'create-outline' : 'eye-outline'}
              onPress={() => setShowPreview((v) => !v)}>
              {showPreview ? 'Back to editor' : 'Preview'}
            </Button>
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

        {showPreview && Platform.OS === 'web' ? (
          <View className="flex-1">
            <SiteHtmlPreview html={trueDocumentHtml ?? ''} height="100%" />
          </View>
        ) : isSplitView ? (
          <View className="flex-1 flex-row">
            <View className="w-[460px] shrink-0 border-r border-gray-100 dark:border-gray-800">
              <ScrollView className="flex-1" contentContainerClassName="p-4 md:p-6 gap-4">
                {statusBlock}
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
        ) : (
          <ScrollView className="flex-1" contentContainerClassName="p-4 md:p-6 gap-4">
            {statusBlock}
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
