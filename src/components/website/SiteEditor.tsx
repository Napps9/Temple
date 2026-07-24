import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSession } from '@/lib/auth';
import { BRAND_THEMES, BRAND_THEME_LIST, composeThemeWithBrand, isThemeId } from '@/lib/brand-themes';
import { errorMessage } from '@/lib/errors';
import { DEFAULT_STOCK_QUERIES, SITE_TEMPLATE_LIST, type SiteTemplate } from '@/lib/site-templates';
import { useStockPhotoSave, useStockPhotoSearch, type StockPhoto } from '@/lib/stock-photos';
import { useThemeColors } from '@/lib/theme';
import {
  SITE_BLOCK_ICONS,
  SITE_BLOCK_LABELS,
  appendBlock,
  createBlock,
  duplicateBlock,
  moveBlock,
  newSiteId,
  removeBlock,
  updateBlock,
  updateSettings,
  type AboutBlock,
  type CallBlock,
  type ContactBlock,
  type GalleryBlock,
  type HeroBlock,
  type LocationBlock,
  type PricingBlock,
  type SiteBlock,
  type SiteBlockType,
  type SiteEditorDocument,
  type TeamBlock,
  type TestimonialsBlock,
} from '@/lib/site-blocks';
import { supabase } from '@/lib/supabase';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ADDABLE: SiteBlockType[] = [
  'hero',
  'about',
  'schedule',
  'pricing',
  'team',
  'testimonials',
  'gallery',
  'location',
  'contact',
  'call',
];

// ---------------------------------------------------------------------------
// Small shared controls — local to this editor, matching the email
// builder's own convention of not sharing UI primitives across editors.
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-gray-600 dark:text-gray-300 text-xs font-medium">{children}</Text>
  );
}

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  note,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  // Rendered below the input — used for fields where this plain-text
  // view isn't the whole story (rich-text fields, whose bold/italic/
  // underline formatting only applies on the canvas, not here).
  note?: string;
}) {
  return (
    <View className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        multiline={multiline}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-sm"
        style={multiline ? { minHeight: 88, textAlignVertical: 'top' } : undefined}
      />
      {note ? <Text className="text-gray-400 dark:text-gray-500 text-xs italic">{note}</Text> : null}
    </View>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-1">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 items-center py-1.5 rounded-md ${
              selected ? 'bg-white dark:bg-gray-900' : ''
            }`}>
            <Text
              className={`text-xs font-medium ${
                selected
                  ? 'text-gray-900 dark:text-gray-50'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function IconBtn({
  icon,
  onPress,
  disabled,
  danger,
}: {
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      className={`w-8 h-8 rounded-lg items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 active:opacity-60 ${
        disabled ? 'opacity-30' : ''
      }`}>
      <Ionicons name={icon} size={15} color={danger ? '#EF4444' : colors.iconSecondary} />
    </Pressable>
  );
}

// One upload helper reused by every block that takes an image — hero,
// about, gallery. Same shape as the email builder's uploadImageForSelected.
function useImageUpload(gymId: string) {
  const session = useSession();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAndUpload(): Promise<string | null> {
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Photo library permission denied');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled || result.assets.length === 0) return null;
      setUploading(true);
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'png';
      const path = `${gymId}/${Date.now()}-${session?.user.id ?? 'staff'}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('gym-website-assets')
        .upload(path, blob, { contentType: asset.mimeType ?? `image/${ext}`, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('gym-website-assets').getPublicUrl(path);
      return pub.publicUrl;
    } catch (e) {
      setError(errorMessage(e, 'Could not upload the image'));
      return null;
    } finally {
      setUploading(false);
    }
  }

  return { pickAndUpload, uploading, error };
}

// Same open-in-new-context shape as useStoreDownload — a bare
// Linking.openURL replaces the editor tab on web.
function openExternal(url: string) {
  if (!url) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
  } else {
    Linking.openURL(url).catch(() => {});
  }
}

function StockPhotoPickerModal({
  visible,
  onClose,
  gymId,
  defaultQuery,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  gymId: string;
  defaultQuery: string;
  onPick: (photo: { url: string; alt: string }) => void;
}) {
  const colors = useThemeColors();
  const [query, setQuery] = useState(defaultQuery);
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const search = useStockPhotoSearch(gymId);
  const save = useStockPhotoSave(gymId);
  // Load-more must page through the query that produced the current
  // grid, not whatever is sitting in the input box unsubmitted.
  const submittedQuery = useRef(defaultQuery);
  const wasVisible = useRef(false);

  function runSearch(q: string, nextPage: number) {
    const trimmed = q.trim();
    if (!trimmed) return;
    if (nextPage === 1) submittedQuery.current = trimmed;
    search.mutate(
      { query: trimmed, page: nextPage },
      {
        onSuccess: (r) => {
          setPhotos((prev) => (nextPage === 1 ? r.photos : [...prev, ...r.photos]));
          setPage(r.page);
          setHasMore(r.has_more);
        },
      },
    );
  }

  const searchOnOpen = () => runSearch(defaultQuery, 1);
  const searchOnOpenRef = useRef(searchOnOpen);
  searchOnOpenRef.current = searchOnOpen;
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setQuery(defaultQuery);
      setPhotos([]);
      setSavingId(null);
      searchOnOpenRef.current();
    }
    wasVisible.current = visible;
  }, [visible, defaultQuery]);

  function pick(p: StockPhoto) {
    setSavingId(p.id);
    save.mutate(
      { photoId: p.id },
      {
        onSuccess: (r) => {
          onPick({ url: r.url, alt: r.alt });
          onClose();
        },
        onSettled: () => setSavingId(null),
      },
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md md:max-w-2xl gap-3">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">Stock photos</Text>
          <View className="flex-row gap-2 items-center">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search photos…"
              placeholderTextColor="#9CA3AF"
              returnKeyType="search"
              onSubmitEditing={() => runSearch(query, 1)}
              className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-sm"
            />
            <Pressable
              onPress={() => runSearch(query, 1)}
              disabled={search.isPending}
              className="w-10 h-10 rounded-lg items-center justify-center bg-primary/10 border border-primary/30 active:opacity-70">
              <Ionicons name="search" size={16} color={colors.primary} />
            </Pressable>
          </View>
          {search.error ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{search.error.message}</Text>
          ) : null}
          {save.error ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{save.error.message}</Text>
          ) : null}
          <ScrollView style={{ maxHeight: 420 }}>
            {search.isPending && photos.length === 0 ? (
              <View className="py-10 items-center">
                <ActivityIndicator />
              </View>
            ) : photos.length === 0 && search.isSuccess ? (
              <Text className="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
                No photos found — try a different search.
              </Text>
            ) : (
              <View className="gap-2">
                <View className="flex-row flex-wrap gap-2">
                  {photos.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => pick(p)}
                      disabled={savingId != null}
                      style={{ width: '31%' }}
                      className="gap-1 active:opacity-70">
                      <View
                        className="rounded-lg overflow-hidden"
                        style={{ backgroundColor: p.avg_color, height: 64 }}>
                        <Image
                          source={{ uri: p.thumb }}
                          style={{ width: '100%', height: 64 }}
                          resizeMode="cover"
                          accessibilityLabel={p.alt}
                        />
                        {savingId === p.id ? (
                          <View className="absolute inset-0 items-center justify-center bg-black/40">
                            <ActivityIndicator color="#FFFFFF" />
                          </View>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => openExternal(p.photographer_url)}
                        disabled={savingId != null}
                        hitSlop={4}>
                        <Text
                          numberOfLines={1}
                          className="text-gray-400 dark:text-gray-500 text-[10px]">
                          by {p.photographer}
                        </Text>
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
                {hasMore && photos.length > 0 ? (
                  <Pressable
                    onPress={() => runSearch(submittedQuery.current, page + 1)}
                    disabled={search.isPending || savingId != null}
                    className="flex-row items-center justify-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg py-2.5 active:opacity-70">
                    <Text className="text-gray-700 dark:text-gray-200 font-medium text-sm">
                      {search.isPending ? 'Loading…' : 'Load more'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </ScrollView>
          <Pressable
            onPress={() => openExternal('https://www.pexels.com')}
            hitSlop={4}
            className="items-center pt-1">
            <Text className="text-gray-500 dark:text-gray-400 text-xs underline">
              Photos provided by Pexels
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ImagePickerField({
  label,
  value,
  onChange,
  gymId,
  defaultStockQuery,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  gymId: string;
  defaultStockQuery: string;
}) {
  const colors = useThemeColors();
  const { pickAndUpload, uploading, error } = useImageUpload(gymId);
  const [stockOpen, setStockOpen] = useState(false);
  return (
    <View className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {value ? (
        <Image source={{ uri: value }} style={{ width: '100%', height: 120 }} className="rounded-lg" resizeMode="cover" />
      ) : null}
      <View className="flex-row gap-2">
        <Pressable
          onPress={async () => {
            const url = await pickAndUpload();
            if (url) onChange(url);
          }}
          disabled={uploading}
          className="flex-1 flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-lg py-2.5 active:opacity-70">
          <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
          <Text className="text-primary font-semibold text-sm">
            {uploading ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setStockOpen(true)}
          className="flex-1 flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-lg py-2.5 active:opacity-70">
          <Ionicons name="images-outline" size={16} color={colors.primary} />
          <Text className="text-primary font-semibold text-sm">Stock photos</Text>
        </Pressable>
      </View>
      {error ? <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text> : null}
      <StockPhotoPickerModal
        visible={stockOpen}
        onClose={() => setStockOpen(false)}
        gymId={gymId}
        defaultQuery={defaultStockQuery}
        onPick={({ url }) => onChange(url)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-block field editors
// ---------------------------------------------------------------------------

function HeroInspector({
  block,
  onPatch,
  gymId,
  defaultStockQuery,
}: {
  block: HeroBlock;
  onPatch: (patch: Partial<HeroBlock>) => void;
  gymId: string;
  defaultStockQuery: string;
}) {
  return (
    <View className="gap-3">
      <TextField label="Headline" value={block.headline} onChangeText={(t) => onPatch({ headline: t })} />
      <TextField
        label="Subheadline"
        value={block.subheadline}
        onChangeText={(t) => onPatch({ subheadline: t })}
        multiline
      />
      <TextField label="Button label" value={block.ctaLabel} onChangeText={(t) => onPatch({ ctaLabel: t })} />
      <View className="gap-1.5">
        <FieldLabel>Button links to</FieldLabel>
        <Segmented
          value={block.ctaTarget}
          onChange={(v) => onPatch({ ctaTarget: v })}
          options={[
            { value: 'join', label: 'Join page' },
            { value: 'contact', label: 'Contact section' },
          ]}
        />
      </View>
      <View className="gap-1.5">
        <FieldLabel>Layout</FieldLabel>
        <Segmented
          value={block.layout}
          onChange={(v) => onPatch({ layout: v })}
          options={[
            { value: 'background', label: 'Full-width photo' },
            { value: 'side', label: 'Photo beside text' },
          ]}
        />
      </View>
      <ImagePickerField
        label="Photo"
        value={block.imageUrl}
        onChange={(u) => onPatch({ imageUrl: u })}
        gymId={gymId}
        defaultStockQuery={defaultStockQuery}
      />
      {block.imageUrl ? (
        <TextField
          label="Photo description (alt text)"
          value={block.imageAlt ?? ''}
          onChangeText={(t) => onPatch({ imageAlt: t })}
          placeholder="What's happening in the photo — read aloud by screen readers"
        />
      ) : null}
    </View>
  );
}

function AboutInspector({
  block,
  onPatch,
  gymId,
  defaultStockQuery,
}: {
  block: AboutBlock;
  onPatch: (patch: Partial<AboutBlock>) => void;
  gymId: string;
  defaultStockQuery: string;
}) {
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <TextField
        label="Body"
        value={block.body}
        onChangeText={(t) => onPatch({ body: t })}
        multiline
        note="Formatting applies on the canvas — this field shows plain text."
      />
      <View className="gap-1.5">
        <FieldLabel>Layout</FieldLabel>
        <Segmented
          value={block.layout}
          onChange={(v) => onPatch({ layout: v })}
          options={[
            { value: 'image-left', label: 'Image left' },
            { value: 'image-right', label: 'Image right' },
            { value: 'none', label: 'Text only' },
          ]}
        />
      </View>
      {block.layout !== 'none' ? (
        <ImagePickerField
          label="Photo"
          value={block.imageUrl}
          onChange={(u) => onPatch({ imageUrl: u })}
          gymId={gymId}
          defaultStockQuery={defaultStockQuery}
        />
      ) : null}
      {block.layout !== 'none' && block.imageUrl ? (
        <TextField
          label="Photo description (alt text)"
          value={block.imageAlt ?? ''}
          onChangeText={(t) => onPatch({ imageAlt: t })}
          placeholder="What's happening in the photo — read aloud by screen readers"
        />
      ) : null}
    </View>
  );
}

function ScheduleInspector({
  block,
  onPatch,
}: {
  block: { heading: string };
  onPatch: (patch: { heading?: string }) => void;
}) {
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <Text className="text-gray-400 dark:text-gray-500 text-xs">
        Shows your real weekly schedule automatically — nothing else to edit here.
      </Text>
    </View>
  );
}

function usePlans(gymId: string) {
  return useQuery({
    queryKey: ['website-editor-plans', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<{ plan_id: string; name: string }[]> => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select('plan_id, name')
        .eq('gym_id', gymId)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

function PricingInspector({
  block,
  onPatch,
  gymId,
}: {
  block: PricingBlock;
  onPatch: (patch: Partial<PricingBlock>) => void;
  gymId: string;
}) {
  const colors = useThemeColors();
  const plans = usePlans(gymId);
  const hidden = new Set(block.hiddenPlanIds);
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <View className="gap-1.5">
        <FieldLabel>Plans shown on the page</FieldLabel>
        {plans.isLoading ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs">Loading your plans…</Text>
        ) : (plans.data ?? []).length === 0 ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            No plans yet — add them under Manage → Plans.
          </Text>
        ) : (
          (plans.data ?? []).map((p) => {
            const isHidden = hidden.has(p.plan_id);
            return (
              <Pressable
                key={p.plan_id}
                onPress={() => {
                  const next = new Set(hidden);
                  if (isHidden) next.delete(p.plan_id);
                  else next.add(p.plan_id);
                  onPatch({ hiddenPlanIds: Array.from(next) });
                }}
                className="flex-row items-center gap-2 py-1.5">
                <Ionicons
                  name={isHidden ? 'square-outline' : 'checkbox'}
                  size={18}
                  color={isHidden ? colors.iconTertiary : colors.primary}
                />
                <Text className="text-gray-700 dark:text-gray-200 text-sm">{p.name}</Text>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

function useTeamRoster(gymId: string) {
  return useQuery({
    queryKey: ['website-editor-team', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<{ profile_id: string; full_name: string | null }[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', gymId)
        .in('role', ['owner', 'admin', 'coach', 'staff'])
        .is('left_at', null);
      if (error) throw error;
      const rows = (data ?? []) as unknown as {
        profile_id: string;
        profiles: { full_name: string | null } | null;
      }[];
      return rows.map((r) => ({ profile_id: r.profile_id, full_name: r.profiles?.full_name ?? null }));
    },
  });
}

function TeamInspector({
  block,
  onPatch,
  gymId,
}: {
  block: TeamBlock;
  onPatch: (patch: Partial<TeamBlock>) => void;
  gymId: string;
}) {
  const colors = useThemeColors();
  const roster = useTeamRoster(gymId);
  const hidden = new Set(block.hiddenMemberIds);
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <View className="gap-1.5">
        <FieldLabel>Team members shown on the page</FieldLabel>
        {roster.isLoading ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs">Loading your team…</Text>
        ) : (roster.data ?? []).length === 0 ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            No team members yet — invite staff under Manage → Team.
          </Text>
        ) : (
          (roster.data ?? []).map((m) => {
            const isHidden = hidden.has(m.profile_id);
            return (
              <Pressable
                key={m.profile_id}
                onPress={() => {
                  const next = new Set(hidden);
                  if (isHidden) next.delete(m.profile_id);
                  else next.add(m.profile_id);
                  onPatch({ hiddenMemberIds: Array.from(next) });
                }}
                className="flex-row items-center gap-2 py-1.5">
                <Ionicons
                  name={isHidden ? 'square-outline' : 'checkbox'}
                  size={18}
                  color={isHidden ? colors.iconTertiary : colors.primary}
                />
                <Text className="text-gray-700 dark:text-gray-200 text-sm">
                  {m.full_name ?? 'Team member'}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

function TestimonialsInspector({
  block,
  onPatch,
}: {
  block: TestimonialsBlock;
  onPatch: (patch: Partial<TestimonialsBlock>) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <View className="gap-3">
        {block.quotes.map((q, i) => (
          <View key={q.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 gap-2">
            <View className="flex-row items-center justify-between">
              <FieldLabel>{`Quote ${i + 1}`}</FieldLabel>
              <Pressable
                onPress={() =>
                  onPatch({ quotes: block.quotes.filter((x) => x.id !== q.id) })
                }
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Delete quote">
                <Ionicons name="trash-outline" size={15} color="#EF4444" />
              </Pressable>
            </View>
            <TextField
              label="Quote"
              value={q.quote}
              onChangeText={(t) =>
                onPatch({
                  quotes: block.quotes.map((x) => (x.id === q.id ? { ...x, quote: t } : x)),
                })
              }
              multiline
              note="Formatting applies on the canvas — this field shows plain text."
            />
            <TextField
              label="Name"
              value={q.name}
              onChangeText={(t) =>
                onPatch({
                  quotes: block.quotes.map((x) => (x.id === q.id ? { ...x, name: t } : x)),
                })
              }
            />
          </View>
        ))}
      </View>
      <Pressable
        onPress={() =>
          onPatch({
            quotes: [
              ...block.quotes,
              { id: newSiteId(), quote: '', name: '' },
            ],
          })
        }
        className="flex-row items-center justify-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg py-2.5 active:opacity-70">
        <Ionicons name="add" size={16} color={colors.iconSecondary} />
        <Text className="text-gray-700 dark:text-gray-200 font-medium text-sm">Add a quote</Text>
      </Pressable>
    </View>
  );
}

function GalleryInspector({
  block,
  onPatch,
  gymId,
  defaultStockQuery,
}: {
  block: GalleryBlock;
  onPatch: (patch: Partial<GalleryBlock>) => void;
  gymId: string;
  defaultStockQuery: string;
}) {
  const colors = useThemeColors();
  const { pickAndUpload, uploading, error } = useImageUpload(gymId);
  const [stockOpen, setStockOpen] = useState(false);
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <View className="gap-2">
        {block.images.map((img) => (
          <View key={img.id} className="flex-row items-center gap-2">
            <Image source={{ uri: img.url }} style={{ width: 56, height: 56 }} className="rounded-lg" />
            <View className="flex-1">
              <TextField
                label="Description"
                value={img.alt}
                onChangeText={(t) =>
                  onPatch({
                    images: block.images.map((x) =>
                      x.id === img.id ? { ...x, alt: t } : x,
                    ),
                  })
                }
              />
            </View>
            <Pressable
              onPress={() => onPatch({ images: block.images.filter((x) => x.id !== img.id) })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              className="w-7 h-7 rounded-full bg-red-500 items-center justify-center active:opacity-70">
              <Ionicons name="close" size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
      </View>
      <View className="flex-row gap-2">
        <Pressable
          onPress={async () => {
            const url = await pickAndUpload();
            if (url) {
              onPatch({
                images: [...block.images, { id: newSiteId(), url, alt: '' }],
              });
            }
          }}
          disabled={uploading}
          className="flex-1 flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-lg py-2.5 active:opacity-70">
          <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
          <Text className="text-primary font-semibold text-sm">{uploading ? 'Uploading…' : 'Add a photo'}</Text>
        </Pressable>
        <Pressable
          onPress={() => setStockOpen(true)}
          className="flex-1 flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-lg py-2.5 active:opacity-70">
          <Ionicons name="images-outline" size={16} color={colors.primary} />
          <Text className="text-primary font-semibold text-sm">Stock photos</Text>
        </Pressable>
      </View>
      {error ? <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text> : null}
      <StockPhotoPickerModal
        visible={stockOpen}
        onClose={() => setStockOpen(false)}
        gymId={gymId}
        defaultQuery={defaultStockQuery}
        onPick={({ url, alt }) =>
          onPatch({
            images: [...block.images, { id: newSiteId(), url, alt }],
          })
        }
      />
    </View>
  );
}

function LocationInspector({
  block,
  onPatch,
}: {
  block: LocationBlock;
  onPatch: (patch: Partial<LocationBlock>) => void;
}) {
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <TextField label="Address" value={block.address} onChangeText={(t) => onPatch({ address: t })} multiline />
      <TextField label="Hours" value={block.hours} onChangeText={(t) => onPatch({ hours: t })} multiline placeholder={'Mon-Fri 6am-8pm\nSat-Sun 8am-1pm'} />
      <View className="gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        <FieldLabel>Structured address (helps Google Maps &amp; local search)</FieldLabel>
        <TextField label="Street" value={block.street ?? ''} onChangeText={(t) => onPatch({ street: t })} placeholder="1 Gym St" />
        <View className="flex-row gap-2">
          <View className="flex-1">
            <TextField label="City" value={block.city ?? ''} onChangeText={(t) => onPatch({ city: t })} />
          </View>
          <View className="flex-1">
            <TextField
              label="Region / state"
              value={block.region ?? ''}
              onChangeText={(t) => onPatch({ region: t })}
            />
          </View>
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <TextField
              label="Postal code"
              value={block.postalCode ?? ''}
              onChangeText={(t) => onPatch({ postalCode: t })}
            />
          </View>
          <View className="flex-1">
            <TextField
              label="Country"
              value={block.country ?? ''}
              onChangeText={(t) => onPatch({ country: t })}
              placeholder="GB"
            />
          </View>
        </View>
        <Text className="text-gray-400 dark:text-gray-500 text-[11px] leading-4">
          Optional — fill these in and search engines can show your address and hours directly in
          results. Your Address text above still controls what visitors see on the page.
        </Text>
      </View>
    </View>
  );
}

function ContactInspector({
  block,
  onPatch,
}: {
  block: ContactBlock;
  onPatch: (patch: Partial<ContactBlock>) => void;
}) {
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <TextField label="Subheading" value={block.subheading} onChangeText={(t) => onPatch({ subheading: t })} multiline />
      <Text className="text-gray-400 dark:text-gray-500 text-xs">
        Submissions land in Manage → AI Front Desk, same as your existing enquiry page.
      </Text>
    </View>
  );
}

function CallInspector({
  block,
  onPatch,
}: {
  block: CallBlock;
  onPatch: (patch: Partial<CallBlock>) => void;
}) {
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <TextField label="Subheading" value={block.subheading} onChangeText={(t) => onPatch({ subheading: t })} multiline />
      <Text className="text-gray-400 dark:text-gray-500 text-xs">
        The number itself comes from Manage → AI Front Desk, not from here — this block only shows
        up on the live site once that's fully set up (a number assigned, and phone answering
        switched on).
      </Text>
    </View>
  );
}

function BlockInspector({
  block,
  onPatch,
  gymId,
  defaultStockQuery,
}: {
  block: SiteBlock;
  onPatch: (patch: Partial<SiteBlock>) => void;
  gymId: string;
  defaultStockQuery: string;
}) {
  switch (block.type) {
    case 'hero':
      return (
        <HeroInspector
          block={block}
          onPatch={onPatch}
          gymId={gymId}
          defaultStockQuery={defaultStockQuery}
        />
      );
    case 'about':
      return (
        <AboutInspector
          block={block}
          onPatch={onPatch}
          gymId={gymId}
          defaultStockQuery={defaultStockQuery}
        />
      );
    case 'schedule':
      return <ScheduleInspector block={block} onPatch={onPatch} />;
    case 'pricing':
      return <PricingInspector block={block} onPatch={onPatch} gymId={gymId} />;
    case 'team':
      return <TeamInspector block={block} onPatch={onPatch} gymId={gymId} />;
    case 'testimonials':
      return <TestimonialsInspector block={block} onPatch={onPatch} />;
    case 'gallery':
      return (
        <GalleryInspector
          block={block}
          onPatch={onPatch}
          gymId={gymId}
          defaultStockQuery={defaultStockQuery}
        />
      );
    case 'location':
      return <LocationInspector block={block} onPatch={onPatch} />;
    case 'contact':
      return <ContactInspector block={block} onPatch={onPatch} />;
    case 'call':
      return <CallInspector block={block} onPatch={onPatch} />;
  }
}

// ---------------------------------------------------------------------------
// Theme picker
// ---------------------------------------------------------------------------

function ThemePicker({
  document,
  onChange,
  brandPrimaryColor,
}: {
  document: SiteEditorDocument;
  onChange: (doc: SiteEditorDocument) => void;
  brandPrimaryColor: string;
}) {
  return (
    <View className="gap-1.5">
      <FieldLabel>Theme</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {BRAND_THEME_LIST.map((theme) => {
          const composed = composeThemeWithBrand(theme, brandPrimaryColor);
          const selected = document.settings.themeId === theme.id;
          return (
            <Pressable
              key={theme.id}
              onPress={() => onChange(updateSettings(document, { themeId: theme.id }))}
              className={`w-20 gap-1 items-center rounded-xl p-2 border-2 ${
                selected ? 'border-primary' : 'border-transparent'
              }`}>
              <View
                className="flex-row w-full h-8 rounded-lg overflow-hidden"
                style={{ borderWidth: 1, borderColor: '#00000014' }}>
                <View className="flex-1" style={{ backgroundColor: composed.palette.background }} />
                <View className="flex-1" style={{ backgroundColor: composed.palette.accent }} />
              </View>
              <Text className="text-gray-600 dark:text-gray-300 text-[11px]">{theme.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View className="gap-1.5 mt-2">
        <FieldLabel>Coach names on the public schedule</FieldLabel>
        <Segmented
          value={document.settings.showCoachNames === false ? 'hide' : 'show'}
          options={[
            { value: 'show', label: 'Show' },
            { value: 'hide', label: 'Hide' },
          ]}
          onChange={(v) => onChange(updateSettings(document, { showCoachNames: v === 'show' }))}
        />
      </View>
      <View className="gap-1.5 mt-2">
        <TextField
          label="Search Console verification code"
          value={document.settings.searchConsoleVerification ?? ''}
          onChangeText={(t) => onChange(updateSettings(document, { searchConsoleVerification: t }))}
          placeholder="Paste the content= value from the HTML tag method"
          note="Lets Google Search Console confirm you own this site, so you can submit your sitemap and see search performance."
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Compact-mode pieces — only rendered when SiteEditor's `compact` prop is
// true (narrow web / split-view rail), replacing the static "Add a
// block" column and the always-open Theme/Ownership column with a
// trigger + modal and a collapsed-by-default section, to leave room
// for the live canvas alongside the rail.
// ---------------------------------------------------------------------------

// Same collapsible shape as management/index.tsx's SettingsSection —
// replicated locally, not shared, matching this editor's existing
// convention of not sharing UI primitives across editors.
function CollapsibleSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-2.5 active:opacity-70">
        <Ionicons name={icon} size={16} color={colors.iconSecondary} />
        <Text className="flex-1 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
          {title}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.iconTertiary} />
      </Pressable>
      {open ? <View className="gap-3 pt-3">{children}</View> : null}
    </View>
  );
}

// Same Modal/backdrop/rounded-panel shell as ConfirmDialog, not
// ConfirmDialog itself — that component is shaped for a single
// destructive confirm action, not a list of choices.
function AddBlockModal({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (type: SiteBlockType) => void;
}) {
  const colors = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md md:max-w-lg gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">Add a block</Text>
          <View className="gap-2">
            {ADDABLE.map((type) => (
              <Pressable
                key={type}
                onPress={() => onPick(type)}
                className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 active:opacity-70">
                <Ionicons name={SITE_BLOCK_ICONS[type] as IconName} size={16} color={colors.iconSecondary} />
                <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                  {SITE_BLOCK_LABELS[type]}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TemplatePickerModal({
  visible,
  onClose,
  onPick,
  brandPrimaryColor,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (template: SiteTemplate) => void;
  brandPrimaryColor: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md md:max-w-lg gap-4">
          <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
            Apply a template
          </Text>
          <View className="gap-2">
            {SITE_TEMPLATE_LIST.map((t) => {
              const composed = composeThemeWithBrand(BRAND_THEMES[t.themeId], brandPrimaryColor);
              return (
                <Pressable
                  key={t.id}
                  onPress={() => onPick(t)}
                  className="flex-row items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 active:opacity-70">
                  <View
                    className="w-12 h-9 rounded-md overflow-hidden flex-row"
                    style={{ borderWidth: 1, borderColor: '#00000014' }}>
                    <View className="flex-1" style={{ backgroundColor: composed.palette.background }} />
                    <View className="w-3" style={{ backgroundColor: composed.palette.accent }} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">{t.name}</Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-xs">{t.description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

// Module-scope on purpose — SiteEditor's own `document` prop is a
// SiteEditorDocument, not the DOM, so a helper defined inside the
// component would shadow window.document right when it's needed.
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred: a synchronous revoke races the browser's own fetch of the
  // blob URL — the download can silently produce nothing on WebKit/Gecko.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SiteEditor({
  document,
  onChange,
  gymId,
  gymName,
  brandPrimaryColor,
  compact = false,
  selectedId,
  onSelectBlock,
}: {
  document: SiteEditorDocument;
  onChange: (doc: SiteEditorDocument) => void;
  gymId: string;
  // Seeds a template's hero headline when one is applied here.
  gymName: string;
  brandPrimaryColor: string;
  // Narrows the palette/theme columns to a trigger + modal and a
  // collapsed section, leaving room for a canvas alongside the rail.
  compact?: boolean;
  // Owned by the parent (website.tsx), which is the only place that
  // can see both this block list and the live canvas, so selection
  // can sync both ways between them.
  selectedId: string | null;
  onSelectBlock: (id: string | null) => void;
}) {
  const colors = useThemeColors();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const blockPendingDelete = document.blocks.find((b) => b.id === confirmDeleteId) ?? null;
  // Same themeId normalization website.tsx applies before persisting.
  const defaultStockQuery =
    DEFAULT_STOCK_QUERIES[isThemeId(document.settings.themeId) ? document.settings.themeId : 'forged'];
  const [addBlockModalOpen, setAddBlockModalOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<SiteTemplate | null>(null);

  function confirmDelete() {
    if (!confirmDeleteId) return;
    onChange(removeBlock(document, confirmDeleteId));
    onSelectBlock(null);
    setConfirmDeleteId(null);
  }

  function applyTemplate() {
    if (!pendingTemplate) return;
    // A template's build() returns a full multi-page SiteDocument
    // (Home/Schedule/Team/Pricing); this deliberately takes only
    // pages[0] (Home) and replaces the ACTIVE page's blocks with it,
    // matching the confirm dialog's "replaces every block... on this
    // page" wording — SiteEditor has no multi-page concept, and
    // resetting the other pages the owner may have already customised
    // out from under them here would be a much bigger, more surprising
    // action than what this button promises. Flows through website.tsx's
    // handlePanelChange: structural bump → canvas reload; autosave
    // persists both design and the theme column (persist() writes theme
    // from settings.themeId). Doesn't re-run the image auto-population
    // createSite does — the owner can still use "Search stock photos"
    // on this page afterward.
    const built = pendingTemplate.build(gymName);
    onChange({ settings: built.settings, blocks: built.pages[0].blocks });
    // The old selection points at block ids that no longer exist.
    onSelectBlock(null);
    setPendingTemplate(null);
  }

  function addBlock(type: SiteBlockType) {
    const block = createBlock(type);
    onChange(appendBlock(document, block));
    onSelectBlock(block.id);
    setAddBlockModalOpen(false);
  }

  const blockButtons = ADDABLE.map((type) => (
    <Pressable
      key={type}
      onPress={() => addBlock(type)}
      className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 active:opacity-70">
      <Ionicons name={SITE_BLOCK_ICONS[type] as IconName} size={15} color={colors.iconSecondary} />
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {SITE_BLOCK_LABELS[type]}
      </Text>
    </Pressable>
  ));

  const themeAndOwnership = (
    <>
      <ThemePicker document={document} onChange={onChange} brandPrimaryColor={brandPrimaryColor} />
      <View className="gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
          Templates
        </Text>
        <ChipButton
          label="Apply a template"
          icon="color-wand-outline"
          tone="neutral"
          onPress={() => setTemplateModalOpen(true)}
        />
        <Text className="text-gray-400 dark:text-gray-500 text-[11px] leading-4">
          Replaces everything on the page with a fresh starting point.
        </Text>
      </View>
      {Platform.OS === 'web' ? (
        <View className="gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
          <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
            Ownership
          </Text>
          <ChipButton
            label="Download design (JSON)"
            icon="download-outline"
            tone="neutral"
            onPress={() => downloadJson('site-design.json', document)}
          />
          <Text className="text-gray-400 dark:text-gray-500 text-[11px] leading-4">
            A snapshot of your page content — not a working website file.
          </Text>
        </View>
      ) : null}
    </>
  );

  return (
    <View className={compact ? 'gap-3' : 'lg:flex-row gap-3'}>
      {compact ? (
        <Pressable
          onPress={() => setAddBlockModalOpen(true)}
          className="flex-row items-center justify-center gap-2 bg-white dark:bg-gray-900 rounded-xl p-3 active:opacity-70">
          <Ionicons name="add" size={16} color={colors.iconSecondary} />
          <Text className="text-gray-700 dark:text-gray-200 font-medium text-sm">Add block</Text>
        </Pressable>
      ) : (
        <View className="lg:w-48 lg:shrink-0 bg-white dark:bg-gray-900 rounded-xl p-3 gap-2">
          <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
            Add a block
          </Text>
          <View className="gap-2">{blockButtons}</View>
        </View>
      )}

      <View className="flex-1 bg-white dark:bg-gray-900 rounded-xl p-3 gap-2">
        <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
          Page ({document.blocks.length} block{document.blocks.length === 1 ? '' : 's'})
        </Text>
        {document.blocks.length === 0 ? (
          <View className="py-12 items-center px-6">
            <Ionicons name="globe-outline" size={32} color={colors.iconTertiary} />
            <Text className="text-gray-400 dark:text-gray-500 text-sm mt-2 text-center">
              Your page is empty. Add blocks from the left to start building.
            </Text>
          </View>
        ) : (
          document.blocks.map((block, idx) => {
            const isSelected = block.id === selectedId;
            return (
              <View key={block.id}>
                <Pressable
                  onPress={() => onSelectBlock(isSelected ? null : block.id)}
                  className={`flex-row items-center gap-2 rounded-lg px-3 py-2.5 ${
                    isSelected
                      ? 'bg-primary/10 border border-primary'
                      : 'bg-gray-50 dark:bg-gray-800 border border-transparent'
                  }`}>
                  <Ionicons
                    name={SITE_BLOCK_ICONS[block.type] as IconName}
                    size={16}
                    color={colors.iconSecondary}
                  />
                  <Text className="flex-1 text-gray-800 dark:text-gray-100 text-sm font-medium">
                    {SITE_BLOCK_LABELS[block.type]}
                  </Text>
                  <Ionicons
                    name={isSelected ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.iconTertiary}
                  />
                </Pressable>
                {isSelected ? (
                  <View className="gap-3 p-3 border border-t-0 border-primary/30 rounded-b-lg">
                    <BlockInspector
                      block={block}
                      onPatch={(patch) => onChange(updateBlock(document, block.id, patch))}
                      gymId={gymId}
                      defaultStockQuery={defaultStockQuery}
                    />
                    <View className="flex-row items-center justify-end gap-1.5">
                      <IconBtn
                        icon="arrow-up"
                        onPress={() => onChange(moveBlock(document, block.id, 'up'))}
                        disabled={idx === 0}
                      />
                      <IconBtn
                        icon="arrow-down"
                        onPress={() => onChange(moveBlock(document, block.id, 'down'))}
                        disabled={idx === document.blocks.length - 1}
                      />
                      <IconBtn
                        icon="copy-outline"
                        onPress={() => onChange(duplicateBlock(document, block.id))}
                      />
                      <IconBtn
                        icon="trash-outline"
                        danger
                        onPress={() => setConfirmDeleteId(block.id)}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {compact ? (
        <View className="bg-white dark:bg-gray-900 rounded-xl p-4">
          <CollapsibleSection title="Theme & ownership" icon="color-palette-outline">
            {themeAndOwnership}
          </CollapsibleSection>
        </View>
      ) : (
        <View className="lg:w-64 lg:shrink-0 bg-white dark:bg-gray-900 rounded-xl p-4 gap-4">
          {themeAndOwnership}
        </View>
      )}

      <AddBlockModal
        visible={addBlockModalOpen}
        onClose={() => setAddBlockModalOpen(false)}
        onPick={addBlock}
      />

      <TemplatePickerModal
        visible={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onPick={(t) => {
          setTemplateModalOpen(false);
          setPendingTemplate(t);
        }}
        brandPrimaryColor={brandPrimaryColor}
      />

      <ConfirmDialog
        visible={blockPendingDelete != null}
        title={
          blockPendingDelete
            ? `Delete this ${SITE_BLOCK_LABELS[blockPendingDelete.type]} block?`
            : 'Delete this block?'
        }
        body="This removes it from the page for good — there's no undo. Your other blocks are unaffected."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        visible={pendingTemplate != null}
        title={
          pendingTemplate ? `Apply the ${pendingTemplate.name} template?` : 'Apply this template?'
        }
        body={
          pendingTemplate
            ? `This replaces every block and all written copy on this page with the template's starting content, and switches the theme to ${BRAND_THEMES[pendingTemplate.themeId].name}. Your schedule, pricing and team blocks will still show your real data. There's no undo — and if your site is live, the new content goes live once it saves.`
            : ''
        }
        confirmLabel="Apply template"
        onConfirm={applyTemplate}
        onCancel={() => setPendingTemplate(null)}
      />
    </View>
  );
}
