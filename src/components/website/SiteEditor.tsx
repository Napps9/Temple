import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState, type ComponentProps } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useSession } from '@/lib/auth';
import { BRAND_THEME_LIST, composeThemeWithBrand } from '@/lib/brand-themes';
import { errorMessage } from '@/lib/errors';
import {
  SITE_BLOCK_ICONS,
  SITE_BLOCK_LABELS,
  appendBlock,
  createBlock,
  duplicateBlock,
  moveBlock,
  removeBlock,
  updateBlock,
  updateSettings,
  type AboutBlock,
  type ContactBlock,
  type GalleryBlock,
  type HeroBlock,
  type LocationBlock,
  type PricingBlock,
  type SiteBlock,
  type SiteBlockType,
  type SiteDocument,
  type TestimonialsBlock,
} from '@/lib/site-blocks';
import { supabase } from '@/lib/supabase';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ADDABLE: SiteBlockType[] = [
  'hero',
  'about',
  'schedule',
  'pricing',
  'testimonials',
  'gallery',
  'location',
  'contact',
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
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      className={`w-8 h-8 rounded-lg items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 active:opacity-60 ${
        disabled ? 'opacity-30' : ''
      }`}>
      <Ionicons name={icon} size={15} color={danger ? '#EF4444' : '#6B7280'} />
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

function ImagePickerField({
  label,
  value,
  onChange,
  gymId,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  gymId: string;
}) {
  const { pickAndUpload, uploading, error } = useImageUpload(gymId);
  return (
    <View className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {value ? (
        <Image source={{ uri: value }} style={{ width: '100%', height: 120 }} className="rounded-lg" resizeMode="cover" />
      ) : null}
      <Pressable
        onPress={async () => {
          const url = await pickAndUpload();
          if (url) onChange(url);
        }}
        disabled={uploading}
        className="flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-lg py-2.5 active:opacity-70">
        <Ionicons name="cloud-upload-outline" size={16} color="#2563EB" />
        <Text className="text-primary font-semibold text-sm">
          {uploading ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
        </Text>
      </Pressable>
      {error ? <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text> : null}
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
}: {
  block: HeroBlock;
  onPatch: (patch: Partial<HeroBlock>) => void;
  gymId: string;
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
      <ImagePickerField label="Photo" value={block.imageUrl} onChange={(u) => onPatch({ imageUrl: u })} gymId={gymId} />
    </View>
  );
}

function AboutInspector({
  block,
  onPatch,
  gymId,
}: {
  block: AboutBlock;
  onPatch: (patch: Partial<AboutBlock>) => void;
  gymId: string;
}) {
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <TextField label="Body" value={block.body} onChangeText={(t) => onPatch({ body: t })} multiline />
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
        <ImagePickerField label="Photo" value={block.imageUrl} onChange={(u) => onPatch({ imageUrl: u })} gymId={gymId} />
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
                  color={isHidden ? '#9CA3AF' : '#2563EB'}
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

function TestimonialsInspector({
  block,
  onPatch,
}: {
  block: TestimonialsBlock;
  onPatch: (patch: Partial<TestimonialsBlock>) => void;
}) {
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
                hitSlop={6}>
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
              { id: `q_${Date.now().toString(36)}`, quote: '', name: '' },
            ],
          })
        }
        className="flex-row items-center justify-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg py-2.5 active:opacity-70">
        <Ionicons name="add" size={16} color="#6B7280" />
        <Text className="text-gray-700 dark:text-gray-200 font-medium text-sm">Add a quote</Text>
      </Pressable>
    </View>
  );
}

function GalleryInspector({
  block,
  onPatch,
  gymId,
}: {
  block: GalleryBlock;
  onPatch: (patch: Partial<GalleryBlock>) => void;
  gymId: string;
}) {
  const { pickAndUpload, uploading, error } = useImageUpload(gymId);
  return (
    <View className="gap-3">
      <TextField label="Heading" value={block.heading} onChangeText={(t) => onPatch({ heading: t })} />
      <View className="flex-row flex-wrap gap-2">
        {block.images.map((img) => (
          <View key={img.id} className="relative">
            <Image source={{ uri: img.url }} style={{ width: 84, height: 84 }} className="rounded-lg" />
            <Pressable
              onPress={() => onPatch({ images: block.images.filter((x) => x.id !== img.id) })}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 items-center justify-center">
              <Ionicons name="close" size={12} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
      </View>
      <Pressable
        onPress={async () => {
          const url = await pickAndUpload();
          if (url) {
            onPatch({
              images: [...block.images, { id: `g_${Date.now().toString(36)}`, url, alt: '' }],
            });
          }
        }}
        disabled={uploading}
        className="flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-lg py-2.5 active:opacity-70">
        <Ionicons name="cloud-upload-outline" size={16} color="#2563EB" />
        <Text className="text-primary font-semibold text-sm">{uploading ? 'Uploading…' : 'Add a photo'}</Text>
      </Pressable>
      {error ? <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text> : null}
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
        Submissions land in Manage → Leads, same as your existing enquiry page.
      </Text>
    </View>
  );
}

function BlockInspector({
  block,
  onPatch,
  gymId,
}: {
  block: SiteBlock;
  onPatch: (patch: Partial<SiteBlock>) => void;
  gymId: string;
}) {
  switch (block.type) {
    case 'hero':
      return <HeroInspector block={block} onPatch={onPatch} gymId={gymId} />;
    case 'about':
      return <AboutInspector block={block} onPatch={onPatch} gymId={gymId} />;
    case 'schedule':
      return <ScheduleInspector block={block} onPatch={onPatch} />;
    case 'pricing':
      return <PricingInspector block={block} onPatch={onPatch} gymId={gymId} />;
    case 'testimonials':
      return <TestimonialsInspector block={block} onPatch={onPatch} />;
    case 'gallery':
      return <GalleryInspector block={block} onPatch={onPatch} gymId={gymId} />;
    case 'location':
      return <LocationInspector block={block} onPatch={onPatch} />;
    case 'contact':
      return <ContactInspector block={block} onPatch={onPatch} />;
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
  document: SiteDocument;
  onChange: (doc: SiteDocument) => void;
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
    </View>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function SiteEditor({
  document,
  onChange,
  gymId,
  brandPrimaryColor,
}: {
  document: SiteDocument;
  onChange: (doc: SiteDocument) => void;
  gymId: string;
  brandPrimaryColor: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = document.blocks.find((b) => b.id === selectedId) ?? null;

  function addBlock(type: SiteBlockType) {
    const block = createBlock(type);
    onChange(appendBlock(document, block));
    setSelectedId(block.id);
  }

  const blockButtons = ADDABLE.map((type) => (
    <Pressable
      key={type}
      onPress={() => addBlock(type)}
      className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 active:opacity-70">
      <Ionicons name={SITE_BLOCK_ICONS[type] as IconName} size={15} color="#6B7280" />
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {SITE_BLOCK_LABELS[type]}
      </Text>
    </Pressable>
  ));

  return (
    <View className="lg:flex-row gap-3">
      <View className="lg:w-48 lg:shrink-0 bg-white dark:bg-gray-900 rounded-xl p-3 gap-2">
        <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
          Add a block
        </Text>
        <View className="gap-2">{blockButtons}</View>
      </View>

      <View className="flex-1 bg-white dark:bg-gray-900 rounded-xl p-3 gap-2">
        <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
          Page ({document.blocks.length} block{document.blocks.length === 1 ? '' : 's'})
        </Text>
        {document.blocks.length === 0 ? (
          <View className="py-12 items-center px-6">
            <Ionicons name="globe-outline" size={32} color="#CBD5E1" />
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
                  onPress={() => setSelectedId(isSelected ? null : block.id)}
                  className={`flex-row items-center gap-2 rounded-lg px-3 py-2.5 ${
                    isSelected
                      ? 'bg-primary/10 border border-primary'
                      : 'bg-gray-50 dark:bg-gray-800 border border-transparent'
                  }`}>
                  <Ionicons
                    name={SITE_BLOCK_ICONS[block.type] as IconName}
                    size={16}
                    color="#6B7280"
                  />
                  <Text className="flex-1 text-gray-800 dark:text-gray-100 text-sm font-medium">
                    {SITE_BLOCK_LABELS[block.type]}
                  </Text>
                  <Ionicons
                    name={isSelected ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#9CA3AF"
                  />
                </Pressable>
                {isSelected ? (
                  <View className="gap-3 p-3 border border-t-0 border-primary/30 rounded-b-lg">
                    <BlockInspector
                      block={block}
                      onPatch={(patch) => onChange(updateBlock(document, block.id, patch))}
                      gymId={gymId}
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
                        onPress={() => {
                          onChange(removeBlock(document, block.id));
                          setSelectedId(null);
                        }}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <View className="lg:w-64 lg:shrink-0 bg-white dark:bg-gray-900 rounded-xl p-4">
        <ThemePicker document={document} onChange={onChange} brandPrimaryColor={brandPrimaryColor} />
      </View>
    </View>
  );
}
