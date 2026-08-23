import { Ionicons } from '@expo/vector-icons';
import { FieldLabel } from '@/components/SectionLabel';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text, TextInput } from '@/components/Text';

import { staffContentWidth } from '@/lib/breakpoint';
import { useSession } from '@/lib/auth';
import { useThemeColors } from '@/lib/theme';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { BRAND_THEME_LIST, composeThemeWithBrand } from '@/lib/brand-themes';
import { isFieldEditable, parseFieldPath } from '@/lib/email/canvas-sync';
import { renderEmailHtml } from '@/lib/email/render';
import {
  BLOCK_ICONS,
  BLOCK_LABELS,
  appendBlock,
  applyTheme,
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
import { HtmlPreview } from './HtmlPreview';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ADDABLE: EmailBlockType[] = [
  'heading',
  'text',
  'button',
  'image',
  'divider',
  'spacer',
];

// Single-field inspector edits to these coalesce into one undo step while
// the user is typing; every other change is a discrete history entry.
const COALESCE_FIELDS = new Set(['text', 'href', 'alt', 'src']);

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
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      className={`w-8 h-8 rounded-ctl items-center justify-center bg-white dark:bg-raised-dk border border-line dark:border-line-dk active:opacity-60 ${
        disabled ? 'opacity-30' : ''
      }`}>
      <Ionicons
        name={icon}
        size={15}
        color={danger ? '#EF4444' : colors.ink2}
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
    <View className="flex-row bg-raised dark:bg-raised-dk rounded-ctl p-1 gap-1">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            onPress={() => onChange(opt.value)}
            className={`flex-1 flex-row items-center justify-center gap-1 py-1.5 rounded-md ${
              selected ? 'bg-surface dark:bg-surface-dk' : ''
            }`}>
            {opt.icon ? (
              <Ionicons
                name={opt.icon}
                size={14}
                color={selected ? colors.primary : colors.ink3}
              />
            ) : null}
            {opt.label ? (
              <Text
                className={`text-xs font-medium ${
                  selected
                    ? 'text-ink dark:text-ink-dk'
                    : 'text-ink-2 dark:text-ink-2-dk'
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
  const colors = useThemeColors();
  return (
    <View className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={!multiline ? false : undefined}
        className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2.5 text-ink dark:text-ink-dk text-sm"
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
  const colors = useThemeColors();
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
            className="flex-row items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-ctl py-2.5 active:opacity-70">
            <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
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
  brand,
}: {
  document: EmailDocument;
  onChange: (doc: EmailDocument) => void;
  brand: BrandSeed;
}) {
  const s = document.settings;
  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <FieldLabel>Theme</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {BRAND_THEME_LIST.map((theme) => {
            const composed = composeThemeWithBrand(theme, brand.primaryColor);
            const selected = s.themeId === theme.id;
            return (
              <Pressable
                key={theme.id}
                onPress={() => onChange(applyTheme(document, composed))}
                className={`w-20 gap-1 items-center rounded-ctl p-2 border-2 ${
                  selected ? 'border-primary' : 'border-transparent'
                }`}>
                <View
                  className="flex-row w-full h-8 rounded-ctl overflow-hidden"
                  style={{ borderWidth: 1, borderColor: '#00000014' }}>
                  <View className="flex-1" style={{ backgroundColor: composed.palette.background }} />
                  <View className="flex-1" style={{ backgroundColor: composed.palette.accent }} />
                </View>
                <Text className="text-ink-2 dark:text-ink-2-dk text-[11px]">
                  {theme.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
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

// An accordion block list — each
// block is a labelled row that expands an inline inspector — plus an
// "Add a block" palette and an "Email style" card, in a rail. On wide web
// the rail sits beside a live read-only preview; on narrow it stacks and the
// caller offers a Preview toggle.
export function EmailEditor({
  document,
  onChange,
  brand,
  gymId,
}: {
  document: EmailDocument;
  onChange: (doc: EmailDocument, opts?: { coalesceKey?: string }) => void;
  brand: BrandSeed;
  gymId: string;
}) {
  const colors = useThemeColors();
  const session = useSession();
  const { width } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selected = document.blocks.find((b) => b.id === selectedId) ?? null;

  // The editable iframe reloads only when this key changes (see
  // HtmlPreview.web.tsx). Bump it on any document change EXCEPT a canvas
  // keystroke — those already show live in the frame, and reloading would
  // drop the cursor mid-word. Debounced so a burst of inspector edits (or a
  // held-down undo) reloads once. Undo/redo driven from the parent flows
  // through here for free: the document changes with skipReload unset, so
  // the preview refreshes to match.
  const [syncKey, setSyncKey] = useState(0);
  const skipReload = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (skipReload.current) {
      skipReload.current = false;
      return;
    }
    setSyncKey((v) => v + 1);
  }, [document]);
  const debouncedSyncKey = useDebouncedValue(syncKey, 350);
  const previewHtml = renderEmailHtml(document, { unsubscribeUrl: '#', editable: true });

  // Side-panel edits: discrete history entries (add/remove/reorder, theme,
  // colours, settings). The parent's history snapshots the prior document.
  function handleChange(next: EmailDocument) {
    onChange(next);
  }

  // Inspector patches to a single text-ish field carry a coalesce key so a
  // run of keystrokes collapses to one undo step; anything else is discrete.
  function patchBlock(blockId: string, patch: Partial<EmailBlock>) {
    const keys = Object.keys(patch);
    const coalesceKey =
      keys.length === 1 && COALESCE_FIELDS.has(keys[0])
        ? `patch:${blockId}:${keys[0]}`
        : undefined;
    onChange(
      updateBlock<EmailBlock>(document, blockId, patch),
      coalesceKey ? { coalesceKey } : undefined,
    );
  }

  // Canvas keystrokes write straight through without reloading the iframe
  // (see skipReload above) and coalesce per field, so typing is one undo
  // step rather than one-per-character.
  function handleCanvasFieldChange(path: string, value: string) {
    const parsed = parseFieldPath(path);
    if (!parsed) return;
    const block = document.blocks.find((b) => b.id === parsed.blockId);
    if (!block || !isFieldEditable(block.type, parsed.field)) return;
    const patch: Record<string, string> = { [parsed.field]: value };
    skipReload.current = true;
    onChange(updateBlock<EmailBlock>(document, block.id, patch as Partial<EmailBlock>), {
      coalesceKey: `canvas:${parsed.blockId}:${parsed.field}`,
    });
  }

  function addBlock(type: EmailBlockType) {
    // Seed from the document's live settings, not the raw gym-brand
    // prop — otherwise a block added after a manual colour edit (or a
    // theme apply) silently reverts to the gym's original brand colour
    // instead of matching what's actually on the canvas.
    const seed: BrandSeed = {
      primaryColor: document.settings.linkColor,
      secondaryColor: brand.secondaryColor,
      textColor: document.settings.textColor,
    };
    const block = createBlock(type, seed);
    if (block.type === 'button') block.radius = document.settings.buttonRadius;
    handleChange(appendBlock(document, block));
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
      handleChange(updateBlock<ImageBlock>(document, selected.id, { src: pub.publicUrl }));
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

  const blockButtons = ADDABLE.map((type) => (
    <Pressable
      key={type}
      onPress={() => addBlock(type)}
      className="flex-row items-center gap-1.5 px-3 py-2 rounded-ctl bg-raised dark:bg-raised-dk hover:bg-sunken dark:hover:bg-sunken-dk active:opacity-70">
      <Ionicons name={BLOCK_ICONS[type] as IconName} size={15} color={colors.ink2} />
      <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
        {BLOCK_LABELS[type]}
      </Text>
    </Pressable>
  ));

  const paletteCard = (
    <View className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-2">
      <FieldLabel>
        Add a block
      </FieldLabel>
      <View className="flex-row flex-wrap gap-2">{blockButtons}</View>
    </View>
  );

  // The block list: labelled rows that expand an inline inspector, matching
  // the accordion pattern.
  const listCard = (
    <View className="bg-surface dark:bg-surface-dk rounded-ctl p-3 gap-2">
      <FieldLabel>
        Content{document.blocks.length ? ` (${document.blocks.length})` : ''}
      </FieldLabel>
      {document.blocks.length === 0 ? (
        <View className="py-10 items-center px-6">
          <Ionicons name="mail-open-outline" size={30} color={colors.ink3} />
          <Text className="text-ink-3 dark:text-ink-3-dk text-sm mt-2 text-center">
            Your email is empty. Add a block above to start building.
          </Text>
        </View>
      ) : (
        <View className="gap-1.5">
          {document.blocks.map((block, idx) => {
            const isSelected = block.id === selectedId;
            return (
              <View key={block.id}>
                <Pressable
                  onPress={() => setSelectedId(isSelected ? null : block.id)}
                  className={`flex-row items-center gap-2 rounded-ctl px-3 py-2.5 ${
                    isSelected
                      ? 'bg-primary/10 border border-primary'
                      : 'bg-raised dark:bg-raised-dk border border-transparent'
                  }`}>
                  <Ionicons
                    name={BLOCK_ICONS[block.type] as IconName}
                    size={16}
                    color={colors.ink2}
                  />
                  <Text className="flex-1 text-ink-2 dark:text-ink-dk text-sm font-medium">
                    {BLOCK_LABELS[block.type]}
                  </Text>
                  <Ionicons
                    name={isSelected ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.ink3}
                  />
                </Pressable>
                {isSelected ? (
                  <View className="gap-3 p-3 border border-t-0 border-primary/30 rounded-b-lg">
                    <BlockInspector
                      block={block}
                      onPatch={(patch) => patchBlock(block.id, patch)}
                      onUploadImage={uploadImageForSelected}
                      uploading={uploading}
                    />
                    {uploadError ? (
                      <Text className="text-red-500 dark:text-red-400 text-xs">
                        {uploadError}
                      </Text>
                    ) : null}
                    <View className="flex-row items-center justify-end gap-1.5">
                      <IconBtn
                        icon="arrow-up"
                        onPress={() => handleChange(moveBlock(document, block.id, 'up'))}
                        disabled={idx === 0}
                      />
                      <IconBtn
                        icon="arrow-down"
                        onPress={() => handleChange(moveBlock(document, block.id, 'down'))}
                        disabled={idx === document.blocks.length - 1}
                      />
                      <IconBtn
                        icon="copy-outline"
                        onPress={() => handleChange(duplicateBlock(document, block.id))}
                      />
                      <IconBtn
                        icon="trash-outline"
                        danger
                        onPress={() => {
                          handleChange(removeBlock(document, block.id));
                          setSelectedId(null);
                        }}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const styleCard = (
    <View className="bg-surface dark:bg-surface-dk rounded-ctl p-4 gap-3">
      <FieldLabel>
        Email style
      </FieldLabel>
      <SettingsInspector document={document} onChange={handleChange} brand={brand} />
    </View>
  );

  const rail = (
    <>
      {paletteCard}
      {listCard}
      {styleCard}
    </>
  );

  // Wide web pairs the editor rail with a live, click-to-edit preview —
  // a split view — so heading/text/button-label
  // edits can happen straight in the canvas, not just the sidebar; narrow
  // stacks the rail (the caller offers a read-only Preview toggle).
  // The column, not the window.
  if (Platform.OS === 'web' && staffContentWidth(width) >= 1280) {
    return (
      <View className="flex-1 flex-row">
        <View className="w-[420px] shrink-0 border-r border-line dark:border-line-dk">
          <ScrollView className="flex-1" contentContainerClassName="gap-3 p-1 pb-6">
            {rail}
          </ScrollView>
        </View>
        <View className="flex-1 p-3">
          <HtmlPreview
            html={previewHtml}
            height="100%"
            editable
            syncKey={debouncedSyncKey}
            onFieldChange={handleCanvasFieldChange}
            selectedBlockId={selectedId}
            onCanvasSelect={setSelectedId}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-3 pb-6">
      {rail}
    </ScrollView>
  );
}
