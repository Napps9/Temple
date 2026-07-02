import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { SiteEditor } from '@/components/website/SiteEditor';
import { SiteHtmlPreview } from '@/components/website/SiteHtmlPreview';
import { BRAND_THEMES, composeThemeWithBrand, isThemeId } from '@/lib/brand-themes';
import { useCustomDomain } from '@/lib/custom-domain';
import { errorMessage } from '@/lib/errors';
import { renderSiteHtml, type PublicPlan, type ScheduleSession } from '@/lib/site-render';
import {
  coerceDocument,
  documentWarnings,
  starterDocument,
  type SiteDocument,
} from '@/lib/site-blocks';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useGymBrand } from '@/lib/useGymBrand';
import type { Json } from '@/types/database';

type SiteRow = {
  id: string;
  gym_id: string;
  theme: string;
  design: Json;
  published: boolean;
  created_at: string;
  updated_at: string;
};

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

function useSite(gymId: string | null | undefined) {
  return useQuery({
    queryKey: ['gym-website', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<SiteRow | null> => {
      const { data, error } = await supabase
        .from('gym_websites')
        .select('*')
        .eq('gym_id', gymId!)
        .maybeSingle();
      if (error) throw error;
      return data as SiteRow | null;
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

  return { schedule, plans };
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
  const site = useSite(brand.gymId);
  const customDomain = useCustomDomain(brand.gymId);
  const queryClient = useQueryClient();
  const preview = useStaffPreviewData(brand.gymId);

  const [document, setDocument] = useState<SiteDocument>(() => starterDocument());
  const [showPreview, setShowPreview] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [publishState, setPublishState] = useState<'idle' | 'working'>('idle');
  const [error, setError] = useState<string | null>(null);

  const initialized = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        }
      },
    [document, site.data],
  );

  useEffect(() => {
    if (!initialized.current) return;
    setSaveState('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [persist]);

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

  async function createSite() {
    if (!brand.gymId) return;
    const { data, error: insErr } = await supabase
      .from('gym_websites')
      .insert({ gym_id: brand.gymId, design: starterDocument() as unknown as Json })
      .select('*')
      .single();
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
              Build a public page from your own schedule, pricing and brand.
            </Text>
          </View>
          {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}
          <Button onPress={createSite}>Start building</Button>
        </ScrollView>
      </Screen>
    );
  }

  async function togglePublish() {
    if (!site.data) return;
    setPublishState('working');
    const next = !site.data.published;
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
    supabaseUrl: '',
    supabaseAnonKey: '',
  });
  const warnings = documentWarnings(document);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <View className="flex-1 gap-4 py-4 px-4 md:px-6">
        <View className="flex-row items-center gap-3 flex-wrap">
          <BackLink inline label="Manage" fallbackHref="/management" />
          <View className="flex-1 min-w-[160px]">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">Website</Text>
            <SaveIndicator state={saveState} />
          </View>
          {Platform.OS === 'web' ? (
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
        {error ? <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text> : null}

        {showPreview && Platform.OS === 'web' ? (
          <ScrollView className="flex-1" contentContainerClassName="pb-4">
            <SiteHtmlPreview html={previewHtml} />
          </ScrollView>
        ) : (
          <ScrollView className="flex-1" contentContainerClassName="pb-4">
            <SiteEditor
              document={document}
              onChange={setDocument}
              gymId={brand.gymId ?? ''}
              brandPrimaryColor={brand.primaryColor}
            />
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}
