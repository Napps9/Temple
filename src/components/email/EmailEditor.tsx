import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState, type ComponentProps } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSession } from '@/lib/auth';
import { useThemeColors } from '@/lib/theme';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import {
  BLOCK_ICONS,
  BLOCK_LABELS,
  appendBlock,
  createBlock,
  duplicateBlock,
  moveBlock,
  removeBlock,
  updateBlock,
  updateSettings,
  type BlockAlign,
  type BrandSeed,
  type ButtonBlock,
  type DividerBlock,
  type EmailBlock,
  type EmailBlockType,
  type EmailDocument,
  type HeadingBlock,
  type ImageBlock,
  type SpacerBlock,
  type TextBlock,
} from '@/lib/email/blocks';

import { ColorField } from './ColorField';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ADDABLE: EmailBlockType[] = [
  'heading',
  'text',
  'button',
  'image',
  'divider',
  'spacer',
];

function alignItemsFor(align: BlockAlign): 'flex-start' | 'center' | 'flex-end' {
  return align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
}

// ---------------------------------------------------------------------------
// WYSIWYG block rendering — a React Native echo of what the HTML renderer
// emits, so the canvas previews the email as it's built.
// ---------------------------------------------------------------------------

function BlockView({ block }: { block: EmailBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <Text
          style={{
            fontSize: block.level === 1 ? 28 : block.level === 2 ? 22 : 18,
            fontWeight: '700',
            color: block.color,
            textAlign: block.align,
          }}>
          {block.text || 'Heading'}
        </Text>
      );
    case 'text':
      return (
        <Text style={{ fontSize: 16, lineHeight: 24, color: block.color, textAlign: block.align }}>
          {block.text || 'Text'}
        </Text>
      );
    case 'button':
      return (
        <View style={{ alignItems: alignItemsFor(block.align) }}>
          <View
            style={{
              backgroundColor: block.backgroundColor,
              borderRadius: block.radius,
              paddingVertical: 12,
              paddingHorizontal: 24,
            }}>
            <Text style={{ color: block.textColor, fontWeight: '600' }}>
              {block.text || 'Button'}
            </Text>
          </View>
        </View>
      );
    case 'image':
      return (
        <View style={{ alignItems: alignItemsFor(block.align) }}>
          {block.src ? (
            <View style={{ width: `${block.widthPct}%` }}>
              <Image
                source={{ uri: block.src }}
                style={{ width: '100%', height: 180 }}
                resizeMode="contain"
              />
            </View>
          ) : (
            <View className="w-full h-28 rounded-lg bg-gray-100 dark:bg-gray-800 items-center justify-center">
              <Ionicons name="image-outline" size={28} color="#9CA3AF" />
              <Text className="text-gray-400 text-xs mt-1">No image yet</Text>
            </View>
          )}
        </View>
      );
    case 'divider':
      return <View style={{ borderTopWidth: 1, borderTopColor: block.color }} />;
    case 'spacer':
      return (
        <View
          style={{ height: block.height }}
          className="items-center justify-center">
          <Text className="text-gray-300 dark:text-gray-700 text-[10px]">
            {block.height}px space
          </Text>
        </View>
      );
  }
}

// ---------------------------------------------------------------------------
// Small shared controls
// ---------------------------------------------------------------------------

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
      <Ionicons
        name={icon}
        size={15}
        color={danger ? '#EF4444' : '#6B7280'}
      />
    </Pressable>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row bg-gray-100 dark:bg-gray-800 rounded-lg p-1 gap-1">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            onPress={() => onChange(opt.value)}
            className={`flex-1 flex-row items-center justify-center gap-1 py-1.5 rounded-md ${
              selected ? 'bg-white dark:bg-gray-900' : ''
            }`}>
            {opt.icon ? (
              <Ionicons
                name={opt.icon}
                size={14}
                color={selected ? colors.primary : '#9CA3AF'}
              />
            ) : null}
            {opt.label ? (
              <Text
                className={`text-xs font-medium ${
                  selected
                    ? 'text-gray-900 dark:text-gray-50'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                {opt.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function AlignToggle({
  value,
  onChange,
}: {
  value: BlockAlign;
  onChange: (a: BlockAlign) => void;
}) {
  return (
    <Segmented<BlockAlign>
      value={value}
      onChange={onChange}
      options={[
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ]}
    />
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-gray-600 dark:text-gray-300 text-xs font-medium">
      {children}
    </Text>
  );
}

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
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
        autoCapitalize={autoCapitalize}
        autoCorrect={!multiline ? false : undefined}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-sm"
        style={multiline ? { minHeight: 88, textAlignVertical: 'top' } : undefined}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-block inspector
// ---------------------------------------------------------------------------

function BlockInspector({
  block,
  onPatch,
  onUploadImage,
  uploading,
}: {
  block: EmailBlock;
  onPatch: (patch: Partial<EmailBlock>) => void;
  onUploadImage: () => void;
  uploading: boolean;
}) {
  switch (block.type) {
    case 'heading': {
      const b = block as HeadingBlock;
      return (
        <View className="gap-3">
          <TextField label="Text" value={b.text} onChangeText={(t) => onPatch({ text: t })} multiline />
          <View className="gap-1.5">
            <FieldLabel>Size</FieldLabel>
            <Segmented<number>
              value={b.level}
              onChange={(v) => onPatch({ level: v as 1 | 2 | 3 })}
              options={[
                { value: 1, label: 'H1' },
                { value: 2, label: 'H2' },
                { value: 3, label: 'H3' },
              ]}
            />
          </View>
          <View className="gap-1.5">
            <FieldLabel>Alignment</FieldLabel>
            <AlignToggle value={b.align} onChange={(a) => onPatch({ align: a })} />
          </View>
          <ColorField label="Colour" value={b.color} onChange={(c) => onPatch({ color: c })} />
        </View>
      );
    }
    case 'text': {
      const b = block as TextBlock;
      return (
        <View className="gap-3">
          <TextField label="Text" value={b.text} onChangeText={(t) => onPatch({ text: t })} multiline />
          <View className="gap-1.5">
            <FieldLabel>Alignment</FieldLabel>
            <AlignToggle value={b.align} onChange={(a) => onPatch({ align: a })} />
          </View>
          <ColorField label="Colour" value={b.color} onChange={(c) => onPatch({ color: c })} />
        </View>
      );
    }
    case 'button': {
      const b = block as ButtonBlock;
      return (
        <View className="gap-3">
          <TextField label="Label" value={b.text} onChangeText={(t) => onPatch({ text: t })} />
          <TextField
            label="Link (https://…)"
            value={b.href}
            onChangeText={(t) => onPatch({ href: t })}
            autoCapitalize="none"
            placeholder="https://"
          />
          <View className="gap-1.5">
            <FieldLabel>Alignment</FieldLabel>
            <AlignToggle value={b.align} onChange={(a) => onPatch({ align: a })} />
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <ColorField
                label="Background"
                value={b.backgroundColor}
                onChange={(c) => onPatch({ backgroundColor: c })}
              />
            </View>
            <View className="flex-1">
              <ColorField
                label="Text"
                value={b.textColor}
                onChange={(c) => onPatch({ textColor: c })}
              />
            </View>
          </View>
          <View className="gap-1.5">
            <FieldLabel>Corners</FieldLabel>
            <Segmented<number>
              value={b.radius}
              onChange={(v) => onPatch({ radius: v })}
              options={[
                { value: 0, label: 'Square' },
                { value: 8, label: 'Rounded' },
                { value: 24, label: 'Pill' },
              ]}
            />
          </View>
        </View>
      );
    }
    case 'image': {
      const b = block as ImageBlock;
      return (
        <View className="gap-3">
          <Pressable
            onPress={onUploadImage}
            disabled={uploading}
            className="flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-lg py-2.5 active:opacity-70">
            <Ionicons name="cloud-upload-outline" size={16} color="#2563EB" />
            <Text className="text-primary font-semibold text-sm">
              {uploading ? 'Uploading…' : b.src ? 'Replace image' : 'Upload image'}
            </Text>
          </Pressable>
          <TextField
            label="Or paste an image URL"
            value={b.src}
            onChangeText={(t) => onPatch({ src: t })}
            autoCapitalize="none"
            placeholder="https://"
          />
          <TextField
            label="Alt text"
            value={b.alt}
            onChangeText={(t) => onPatch({ alt: t })}
            placeholder="Describe the image"
          />
          <TextField
            label="Link (optional)"
            value={b.href}
            onChangeText={(t) => onPatch({ href: t })}
            autoCapitalize="none"
            placeholder="https://"
          />
          <View className="gap-1.5">
            <FieldLabel>Width</FieldLabel>
            <Segmented<number>
              value={b.widthPct}
              onChange={(v) => onPatch({ widthPct: v })}
              options={[
                { value: 25, label: '25%' },
                { value: 50, label: '50%' },
                { value: 75, label: '75%' },
                { value: 100, label: '100%' },
              ]}
            />
          </View>
          <View className="gap-1.5">
            <FieldLabel>Alignment</FieldLabel>
            <AlignToggle value={b.align} onChange={(a) => onPatch({ align: a })} />
          </View>
        </View>
      );
    }
    case 'divider': {
      const b = block as DividerBlock;
      return <ColorField label="Colour" value={b.color} onChange={(c) => onPatch({ color: c })} />;
    }
    case 'spacer': {
      const b = block as SpacerBlock;
      return (
        <View className="gap-1.5">
          <FieldLabel>Height</FieldLabel>
          <Segmented<number>
            value={b.height}
            onChange={(v) => onPatch({ height: v })}
            options={[
              { value: 8, label: 'S' },
              { value: 24, label: 'M' },
              { value: 40, label: 'L' },
              { value: 64, label: 'XL' },
            ]}
          />
        </View>
      );
    }
  }
}

function SettingsInspector({
  document,
  onChange,
}: {
  document: EmailDocument;
  onChange: (doc: EmailDocument) => void;
}) {
  const s = document.settings;
  return (
    <View className="gap-3">
      <ColorField
        label="Page background"
        value={s.backgroundColor}
        onChange={(c) => onChange(updateSettings(document, { backgroundColor: c }))}
      />
      <ColorField
        label="Email background"
        value={s.contentBackgroundColor}
        onChange={(c) => onChange(updateSettings(document, { contentBackgroundColor: c }))}
      />
      <ColorField
        label="Link / accent"
        value={s.linkColor}
        onChange={(c) => onChange(updateSettings(document, { linkColor: c }))}
      />
      <View className="gap-1.5">
        <FieldLabel>Width</FieldLabel>
        <Segmented<number>
          value={s.contentWidth}
          onChange={(v) => onChange(updateSettings(document, { contentWidth: v }))}
          options={[
            { value: 480, label: 'Narrow' },
            { value: 600, label: 'Standard' },
            { value: 700, label: 'Wide' },
          ]}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function EmailEditor({
  document,
  onChange,
  brand,
  gymId,
}: {
  document: EmailDocument;
  onChange: (doc: EmailDocument) => void;
  brand: BrandSeed;
  gymId: string;
}) {
  const session = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selected = document.blocks.find((b) => b.id === selectedId) ?? null;

  function addBlock(type: EmailBlockType) {
    const block = createBlock(type, brand);
    onChange(appendBlock(document, block));
    setSelectedId(block.id);
  }

  async function uploadImageForSelected() {
    if (!selected || selected.type !== 'image') return;
    setUploadError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Photo library permission denied');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled || result.assets.length === 0) return;
      setUploading(true);
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'png';
      const path = `${gymId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('email-assets')
        .upload(path, blob, {
          contentType: asset.mimeType ?? `image/${ext}`,
          upsert: false,
        });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('email-assets').getPublicUrl(path);
      // Set the image first — it's uploaded and public now, so a failure
      // to write the (best-effort) library row must not lose it.
      onChange(updateBlock<ImageBlock>(document, selected.id, { src: pub.publicUrl }));
      // Track the asset so a future library view can list / reuse it.
      await supabase
        .from('email_assets')
        .insert({
          gym_id: gymId,
          uploaded_by: session?.user.id ?? null,
          path,
          url: pub.publicUrl,
          file_name: asset.fileName ?? null,
          byte_size: asset.fileSize ?? null,
        })
        .then(({ error }) => {
          if (error) console.warn('email asset row insert failed', error.message);
        });
    } catch (e) {
      setUploadError(errorMessage(e, 'Could not upload the image'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <View className="gap-3">
      {/* Add-block toolbar */}
      <View className="bg-white dark:bg-gray-900 rounded-xl p-3 gap-2">
        <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest">
          Add a block
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {ADDABLE.map((type) => (
            <Pressable
              key={type}
              onPress={() => addBlock(type)}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 active:opacity-70">
              <Ionicons name={BLOCK_ICONS[type] as IconName} size={15} color="#6B7280" />
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                {BLOCK_LABELS[type]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Canvas */}
      <View style={{ backgroundColor: document.settings.backgroundColor }} className="rounded-xl p-3">
        <View
          style={{
            backgroundColor: document.settings.contentBackgroundColor,
            maxWidth: document.settings.contentWidth,
            width: '100%',
            alignSelf: 'center',
          }}
          className="rounded-xl overflow-hidden">
          {document.blocks.length === 0 ? (
            <View className="py-12 items-center px-6">
              <Ionicons name="mail-open-outline" size={32} color="#CBD5E1" />
              <Text className="text-gray-400 dark:text-gray-500 text-sm mt-2 text-center">
                Your email is empty. Add blocks from the toolbar above to start
                building.
              </Text>
            </View>
          ) : (
            document.blocks.map((block, idx) => {
              const isSelected = block.id === selectedId;
              return (
                <View key={block.id}>
                  <Pressable
                    onPress={() => setSelectedId(isSelected ? null : block.id)}
                    style={{
                      paddingVertical: block.type === 'spacer' ? 0 : 12,
                      paddingHorizontal: 20,
                    }}
                    className={
                      isSelected
                        ? 'border-2 border-primary'
                        : 'border-2 border-transparent'
                    }>
                    <BlockView block={block} />
                  </Pressable>
                  {isSelected ? (
                    <View className="flex-row items-center justify-end gap-1.5 px-3 pb-2">
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
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </View>

      {/* Inspector */}
      <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {selected ? `Edit ${BLOCK_LABELS[selected.type]}` : 'Email style'}
          </Text>
          {selected ? (
            <Pressable onPress={() => setSelectedId(null)} hitSlop={6} className="active:opacity-70">
              <Text className="text-primary text-sm font-medium">Done</Text>
            </Pressable>
          ) : null}
        </View>
        {selected ? (
          <>
            <BlockInspector
              block={selected}
              onPatch={(patch) => onChange(updateBlock(document, selected.id, patch))}
              onUploadImage={uploadImageForSelected}
              uploading={uploading}
            />
            {uploadError ? (
              <Text className="text-red-500 dark:text-red-400 text-xs">{uploadError}</Text>
            ) : null}
          </>
        ) : (
          <SettingsInspector document={document} onChange={onChange} />
        )}
      </View>
    </View>
  );
}
