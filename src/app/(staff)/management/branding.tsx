import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BrandPreview } from '@/components/BrandPreview';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ColorSwatchPicker } from '@/components/ColorSwatchPicker';
import { ColourArea } from '@/components/ColourArea';
import { GymLogo } from '@/components/GymLogo';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { DEFAULT_BRAND, joinUrl, normaliseHex, slugify } from '@/lib/brand';
import { deriveDarkColour } from '@/lib/brand-derivation';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type GymRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  text_color: string;
  public_signup_enabled: boolean;
  logo_url_dark: string | null;
  primary_color_dark: string | null;
  secondary_color_dark: string | null;
  text_color_dark: string | null;
};

type ColourPickerTarget =
  | 'primary'
  | 'secondary'
  | 'text'
  | 'primaryDark'
  | 'secondaryDark'
  | 'textDark';

export function BrandingPanel() {
  const { data: membership } = useGymMembership();
  const canManageStaff = useCan('can_manage_staff');
  const queryClient = useQueryClient();

  const gym = useQuery({
    queryKey: ['gym-row', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<GymRow> => {
      const { data, error } = await supabase
        .from('gyms')
        .select(
          'id, name, slug, logo_url, primary_color, secondary_color, text_color, public_signup_enabled, logo_url_dark, primary_color_dark, secondary_color_dark, text_color_dark',
        )
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as GymRow;
    },
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [primary, setPrimary] = useState<string>(DEFAULT_BRAND.primaryColor);
  const [secondary, setSecondary] = useState<string>(DEFAULT_BRAND.secondaryColor);
  const [textColor, setTextColor] = useState<string>(DEFAULT_BRAND.textColor);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // Dark mode. Each colour is held as a string so the user can type a
  // partial hex without immediately failing validation — the save
  // mutation normalises before writing. Empty string = "auto-derive on
  // read" (stored as null).
  const [primaryDark, setPrimaryDark] = useState<string>('');
  const [secondaryDark, setSecondaryDark] = useState<string>('');
  const [textColorDark, setTextColorDark] = useState<string>('');
  const [logoUrlDark, setLogoUrlDark] = useState<string | null>(null);
  const [publicSignup, setPublicSignup] = useState(true);
  const [slugWarn, setSlugWarn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Which field's inline picker is expanded (one at a time keeps the
  // card height sane).
  const [pickerFor, setPickerFor] = useState<ColourPickerTarget | null>(null);

  useEffect(() => {
    if (gym.data) {
      setName(gym.data.name);
      setSlug(gym.data.slug);
      setPrimary(gym.data.primary_color);
      setSecondary(gym.data.secondary_color);
      setTextColor(gym.data.text_color);
      setLogoUrl(gym.data.logo_url);
      setPrimaryDark(gym.data.primary_color_dark ?? '');
      setSecondaryDark(gym.data.secondary_color_dark ?? '');
      setTextColorDark(gym.data.text_color_dark ?? '');
      setLogoUrlDark(gym.data.logo_url_dark);
      setPublicSignup(gym.data.public_signup_enabled);
    }
  }, [gym.data]);

  // Parameterised so the same picker + upload path serves both the
  // light-mode logo and the dark-mode logo. Variant is threaded
  // through `meta` since react-query passes the same context object
  // into onSuccess.
  const upload = useMutation<
    string | null,
    Error,
    { variant: 'light' | 'dark' }
  >({
    mutationFn: async ({ variant }) => {
      if (!membership) throw new Error('Missing context');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Photo library permission denied');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || result.assets.length === 0) return null;
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'png';
      const path = `${membership.gymId}/${variant}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('gym-logos')
        .upload(path, blob, {
          contentType: asset.mimeType ?? `image/${ext}`,
          upsert: false,
        });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('gym-logos').getPublicUrl(path);
      return pub.publicUrl;
    },
    onSuccess: (url, vars) => {
      if (!url) return;
      if (vars.variant === 'dark') setLogoUrlDark(url);
      else setLogoUrl(url);
    },
    onError: (e) => setError(errorMessage(e, 'Could not upload the logo')),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!membership || !gym.data) throw new Error('Missing context');
      const p = normaliseHex(primary);
      const s = normaliseHex(secondary);
      const t = normaliseHex(textColor);
      if (!p || !s || !t) {
        throw new Error('Each colour needs to be a valid 6-character hex');
      }
      if (!name.trim()) throw new Error('Gym name is required');
      const cleanedSlug = slugify(slug);
      if (!cleanedSlug) throw new Error('Slug must contain at least one letter or digit');

      // Order: name, then slug (so failures are localised), then
      // branding bundle, then public signup.
      if (name.trim() !== gym.data.name) {
        const { error: e1 } = await supabase.rpc('set_gym_name', {
          p_gym_id: membership.gymId,
          p_name: name.trim(),
        });
        if (e1) throw e1;
      }
      if (cleanedSlug !== gym.data.slug) {
        const { error: e2 } = await supabase.rpc('set_gym_slug', {
          p_gym_id: membership.gymId,
          p_slug: cleanedSlug,
        });
        if (e2) throw e2;
      }
      // Dark fields are nullable on the server — an empty input
      // means "auto-derive from light at read time" and is stored as
      // null. A partial-but-invalid hex blocks the save so the gym
      // can't end up with a colour the server would reject.
      const pd = primaryDark.trim() === '' ? null : normaliseHex(primaryDark);
      const sd = secondaryDark.trim() === '' ? null : normaliseHex(secondaryDark);
      const td = textColorDark.trim() === '' ? null : normaliseHex(textColorDark);
      if (
        (primaryDark.trim() !== '' && !pd) ||
        (secondaryDark.trim() !== '' && !sd) ||
        (textColorDark.trim() !== '' && !td)
      ) {
        throw new Error(
          'Each dark-mode colour needs to be a valid 6-character hex (or left blank)',
        );
      }

      const { error: e3 } = await supabase.rpc('set_gym_branding', {
        p_gym_id: membership.gymId,
        p_logo_url: logoUrl,
        p_primary_color: p,
        p_secondary_color: s,
        p_text_color: t,
        p_logo_url_dark: logoUrlDark,
        p_primary_color_dark: pd,
        p_secondary_color_dark: sd,
        p_text_color_dark: td,
      });
      if (e3) throw e3;
      if (publicSignup !== gym.data.public_signup_enabled) {
        const { error: e4 } = await supabase.rpc('set_gym_public_signup', {
          p_gym_id: membership.gymId,
          p_enabled: publicSignup,
        });
        if (e4) throw e4;
      }
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['gym-row'] });
      queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
      queryClient.invalidateQueries({ queryKey: ['gym-membership'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save')),
  });

  if (canManageStaff === false) {
    return (
      <Text className="text-gray-500 dark:text-gray-400">
        Only the owner can edit branding.
      </Text>
    );
  }

  const previewPrimary = normaliseHex(primary) ?? DEFAULT_BRAND.primaryColor;
  const previewSecondary = normaliseHex(secondary) ?? DEFAULT_BRAND.secondaryColor;
  const previewText = normaliseHex(textColor) ?? DEFAULT_BRAND.textColor;

  // For preview / share-link rendering, use a placeholder origin on
  // native; on web read window.location.origin.
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.temple';
  const cleanedSlug = slugify(slug);

  return (
    <View className="gap-5">
        {/* Colours sit beside the live preview so each edit is visible
            the moment it's typed or picked. Stacks on small screens. */}
        <View className="md:flex-row gap-4 items-stretch">
          <View className="flex-1 bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Colours
            </Text>
            <ColourField
              label="Primary"
              value={primary}
              onChange={setPrimary}
              pickerOpen={pickerFor === 'primary'}
              onPick={() => setPickerFor(pickerFor === 'primary' ? null : 'primary')}
            />
            <ColourField
              label="Secondary"
              value={secondary}
              onChange={setSecondary}
              pickerOpen={pickerFor === 'secondary'}
              onPick={() =>
                setPickerFor(pickerFor === 'secondary' ? null : 'secondary')
              }
            />
            <ColourField
              label="Text"
              value={textColor}
              onChange={setTextColor}
              pickerOpen={pickerFor === 'text'}
              onPick={() => setPickerFor(pickerFor === 'text' ? null : 'text')}
            />
          </View>
          <View className="flex-1 mt-4 md:mt-0">
            <BrandPreview
              gymName={name || 'Your gym name'}
              logoUrl={logoUrl}
              primaryColor={previewPrimary}
              secondaryColor={previewSecondary}
              textColor={previewText}
            />
          </View>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Logo
          </Text>
          <View className="flex-row items-center gap-3">
            <GymLogo
              size={64}
              logoUrl={logoUrl}
              name={name}
              primaryColor={previewPrimary}
            />
            <View className="flex-1 gap-2">
              <ChipButton
                tone="neutral"
                className="self-start"
                label={
                  upload.isPending
                    ? 'Uploading…'
                    : logoUrl
                      ? 'Replace logo'
                      : 'Upload logo'
                }
                icon="image-outline"
                onPress={() => upload.mutate({ variant: 'light' })}
                disabled={upload.isPending}
              />
              {logoUrl ? (
                <ChipButton
                  tone="red"
                  className="self-start"
                  label="Remove"
                  icon="trash-outline"
                  onPress={() => setLogoUrl(null)}
                />
              ) : null}
            </View>
          </View>
        </View>

        <AdvancedBrandingCard
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          gymName={name}
          // Live values for the auto-derive button + the dark preview.
          lightPrimary={previewPrimary}
          lightSecondary={previewSecondary}
          lightText={previewText}
          lightLogoUrl={logoUrl}
          // Editable dark state.
          primaryDark={primaryDark}
          secondaryDark={secondaryDark}
          textColorDark={textColorDark}
          logoUrlDark={logoUrlDark}
          onChangePrimaryDark={setPrimaryDark}
          onChangeSecondaryDark={setSecondaryDark}
          onChangeTextColorDark={setTextColorDark}
          onUploadDark={() => upload.mutate({ variant: 'dark' })}
          onRemoveDarkLogo={() => setLogoUrlDark(null)}
          uploadPending={upload.isPending}
          pickerFor={pickerFor}
          onSetPicker={setPickerFor}
        />

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Gym details
          </Text>
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Input
            label="Slug"
            value={slug}
            onChangeText={(v) => {
              const next = slugify(v);
              if (gym.data && next !== gym.data.slug) setSlugWarn(true);
              setSlug(next);
            }}
            autoCapitalize="none"
            placeholder="iron-temple"
          />
          {slugWarn ? (
            <Text className="text-amber-600 dark:text-amber-400 text-xs">
              Changing the slug will break previously shared join links.
            </Text>
          ) : null}
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-gray-900 dark:text-gray-50 font-semibold">
                Public signup
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                When on, anyone with your join link can sign up as a member.
              </Text>
            </View>
            <Switch value={publicSignup} onValueChange={setPublicSignup} />
          </View>
          {publicSignup && cleanedSlug ? (
            <View className="gap-1">
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                Share this link
              </Text>
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-gray-700 dark:text-gray-200 text-sm font-mono">
                  {joinUrl(origin, cleanedSlug)}
                </Text>
                <Pressable
                  onPress={() => copyToClipboard(joinUrl(origin, cleanedSlug))}
                  hitSlop={6}
                  className="active:opacity-70">
                  <Ionicons name="copy-outline" size={18} color="#9CA3AF" />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        <Button onPress={() => save.mutate()} loading={save.isPending}>
          Save changes
        </Button>
    </View>
  );
}

// Hex field + live swatch + picker toggle. When open, the full
// saturation/hue picker renders inline directly beneath — no modal, so
// the live preview beside the card stays visible during every drag.
function ColourField({
  label,
  value,
  onChange,
  onPick,
  pickerOpen,
  placeholderHex,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
  pickerOpen: boolean;
  // When supplied, the swatch shows the placeholder colour faded so
  // an empty input visibly previews what the auto-derived value
  // would be. Used by the dark-mode fields under Advanced branding.
  placeholderHex?: string;
}) {
  const valid = normaliseHex(value);
  const swatchColour = valid ?? placeholderHex ?? '#00000000';
  const swatchFaded = !valid && !!placeholderHex;
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
        {label}
      </Text>
      <View className="flex-row items-center gap-2">
        <View
          style={{ backgroundColor: swatchColour, opacity: swatchFaded ? 0.5 : 1 }}
          className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700"
        />
        <View className="flex-1">
          <TextInput
            value={value}
            onChangeText={onChange}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={placeholderHex ?? '#2563EB'}
            placeholderTextColor="#9CA3AF"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-50 text-base"
          />
        </View>
        <ChipButton
          tone={pickerOpen ? 'primary' : 'neutral'}
          label={pickerOpen ? 'Done' : 'Pick'}
          icon={pickerOpen ? 'checkmark' : 'color-palette-outline'}
          onPress={onPick}
        />
      </View>
      {pickerOpen ? (
        <View className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 gap-3 mt-1">
          <ColourArea
            value={valid ?? placeholderHex ?? '#2563EB'}
            onChange={onChange}
          />
          <ColorSwatchPicker value={valid ?? ''} onChange={onChange} />
        </View>
      ) : null}
    </View>
  );
}

// Advanced branding — collapsible card holding the dark-mode logo +
// colours. Closed by default so the basic flow stays unchanged; the
// "Auto-generate from light" button takes the gym's current light
// palette through deriveDarkColour() so an owner who doesn't want to
// hand-pick a dark theme can get a contrast-safe one in one tap and
// then nudge anything they don't like. Leaving a dark colour blank
// stores null and the read path auto-derives on demand, so the
// member never sees an unbranded chrome.
function AdvancedBrandingCard({
  open,
  onToggle,
  gymName,
  lightPrimary,
  lightSecondary,
  lightText,
  lightLogoUrl,
  primaryDark,
  secondaryDark,
  textColorDark,
  logoUrlDark,
  onChangePrimaryDark,
  onChangeSecondaryDark,
  onChangeTextColorDark,
  onUploadDark,
  onRemoveDarkLogo,
  uploadPending,
  pickerFor,
  onSetPicker,
}: {
  open: boolean;
  onToggle: () => void;
  gymName: string;
  lightPrimary: string;
  lightSecondary: string;
  lightText: string;
  lightLogoUrl: string | null;
  primaryDark: string;
  secondaryDark: string;
  textColorDark: string;
  logoUrlDark: string | null;
  onChangePrimaryDark: (v: string) => void;
  onChangeSecondaryDark: (v: string) => void;
  onChangeTextColorDark: (v: string) => void;
  onUploadDark: () => void;
  onRemoveDarkLogo: () => void;
  uploadPending: boolean;
  pickerFor: ColourPickerTarget | null;
  onSetPicker: (v: ColourPickerTarget | null) => void;
}) {
  // Resolve what the dark-mode logo row shows. Same fallback logic
  // the read path runs at useGymBrand, so what the owner sees here
  // is what members will get.
  const previewPrimaryDark =
    normaliseHex(primaryDark) ?? deriveDarkColour(lightPrimary);
  const previewLogoDark = logoUrlDark ?? lightLogoUrl;

  function autoGenerate() {
    onChangePrimaryDark(deriveDarkColour(lightPrimary));
    onChangeSecondaryDark(deriveDarkColour(lightSecondary));
    onChangeTextColorDark(deriveDarkColour(lightText));
  }

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center gap-3 p-4 active:opacity-70">
        <View className="w-9 h-9 rounded-lg bg-primary/10 items-center justify-center">
          <Ionicons name="contrast-outline" size={18} color="#2563EB" />
        </View>
        <View className="flex-1">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Advanced branding
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-xs">
            Set a different logo and palette for dark mode. Anything you leave
            blank is auto-generated from your light-mode colours.
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#9CA3AF"
        />
      </Pressable>

      {open ? (
        <View className="border-t border-gray-100 dark:border-gray-800 p-4 gap-5">
          {/* Dark logo */}
          <View className="gap-2">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              Dark-mode logo
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              Upload an inverted version of your mark if your logo
              doesn't read on a dark background. Leave blank to reuse
              the light-mode logo.
            </Text>
            <View className="flex-row items-center gap-3">
              <View className="bg-gray-900 p-2 rounded-lg">
                <GymLogo
                  size={56}
                  logoUrl={previewLogoDark}
                  name={gymName}
                  primaryColor={previewPrimaryDark}
                />
              </View>
              <View className="flex-1 gap-2">
                <ChipButton
                  tone="neutral"
                  className="self-start"
                  label={
                    uploadPending
                      ? 'Uploading…'
                      : logoUrlDark
                        ? 'Replace dark logo'
                        : 'Upload dark logo'
                  }
                  icon="image-outline"
                  onPress={onUploadDark}
                  disabled={uploadPending}
                />
                {logoUrlDark ? (
                  <ChipButton
                    tone="red"
                    className="self-start"
                    label="Remove"
                    icon="trash-outline"
                    onPress={onRemoveDarkLogo}
                  />
                ) : null}
              </View>
            </View>
          </View>

          {/* Dark colours */}
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
                Dark-mode colours
              </Text>
              <ChipButton
                tone="primary"
                label="Auto-generate from light"
                icon="sparkles-outline"
                onPress={autoGenerate}
              />
            </View>
            <ColourField
              label="Primary"
              value={primaryDark}
              onChange={onChangePrimaryDark}
              pickerOpen={pickerFor === 'primaryDark'}
              onPick={() =>
                onSetPicker(
                  pickerFor === 'primaryDark' ? null : 'primaryDark',
                )
              }
              placeholderHex={deriveDarkColour(lightPrimary)}
            />
            <ColourField
              label="Secondary"
              value={secondaryDark}
              onChange={onChangeSecondaryDark}
              pickerOpen={pickerFor === 'secondaryDark'}
              onPick={() =>
                onSetPicker(
                  pickerFor === 'secondaryDark' ? null : 'secondaryDark',
                )
              }
              placeholderHex={deriveDarkColour(lightSecondary)}
            />
            <ColourField
              label="Text"
              value={textColorDark}
              onChange={onChangeTextColorDark}
              pickerOpen={pickerFor === 'textDark'}
              onPick={() =>
                onSetPicker(pickerFor === 'textDark' ? null : 'textDark')
              }
              placeholderHex={deriveDarkColour(lightText)}
            />
          </View>

          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Toggle the app to dark mode (top-right) after saving to see the
            full chrome render with these colours.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function BrandingPage() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Branding
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Customize how the gym looks to members.
          </Text>
        </View>
        <BrandingPanel />
      </ScrollView>
    </Screen>
  );
}

function copyToClipboard(text: string) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(text);
  }
}
