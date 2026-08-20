// Lives here rather than under app/ because it has no route of its own.
// /management/branding was a Screen, a BackLink and a heading wrapped
// around this panel, and the Manage screen's Settings tab already rendered
// the same component behind the same capability.

import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import { Text } from './Text';

import { BrandPreview } from '@/components/BrandPreview';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ColourField } from '@/components/ColourField';
import { GymLogo } from '@/components/GymLogo';
import { Input } from '@/components/Input';
import { useGymMembership } from '@/lib/auth';
import { DEFAULT_BRAND, joinUrl, leadUrl, normaliseHex, slugify } from '@/lib/brand';
import { contrastRatio, deriveDarkColour } from '@/lib/brand-derivation';
import { copyToClipboard } from '@/lib/clipboard';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useSavedFlag } from '@/lib/useSavedFlag';
import { useThemeColors } from '@/lib/theme';

type GymRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  text_color: string;
  public_signup_enabled: boolean;
  public_lead_capture_enabled: boolean;
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

// Each card saves independently. Colours, logo and the dark set share
// the set_gym_branding RPC, so a card's save sends the server's values
// for the other cards' fields — it can only commit its own edits. The
// two public-link switches save on toggle.
type CardKey = 'colours' | 'logo' | 'dark' | 'details' | 'signup' | 'lead';

export function BrandingPanel() {
  const colors = useThemeColors();
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
          'id, name, slug, logo_url, primary_color, secondary_color, text_color, public_signup_enabled, public_lead_capture_enabled, logo_url_dark, primary_color_dark, secondary_color_dark, text_color_dark',
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
  const [leadCapture, setLeadCapture] = useState(false);
  const [slugWarn, setSlugWarn] = useState(false);
  const [saveError, setSaveError] = useState<{
    card: CardKey;
    message: string;
  } | null>(null);
  const [saved, markSaved] = useSavedFlag();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Which field's inline picker is expanded (one at a time keeps the
  // card height sane).
  const [pickerFor, setPickerFor] = useState<ColourPickerTarget | null>(null);

  // Seed once. Cards save independently, so the refetch after one
  // card's save must not reseed (and wipe) the other cards' edits.
  const seeded = useRef(false);
  useEffect(() => {
    if (!gym.data || seeded.current) return;
    seeded.current = true;
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
    setLeadCapture(gym.data.public_lead_capture_enabled);
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
    onError: (e, vars) =>
      setSaveError({
        card: vars.variant === 'dark' ? 'dark' : 'logo',
        message: errorMessage(e, 'Could not upload the logo'),
      }),
  });

  function invalidateBrand() {
    queryClient.invalidateQueries({ queryKey: ['gym-row'] });
    queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
    queryClient.invalidateQueries({ queryKey: ['gym-membership'] });
    queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
  }

  const save = useMutation({
    mutationFn: async (card: CardKey) => {
      if (!membership || !gym.data) throw new Error('Missing context');

      if (card === 'details') {
        if (!name.trim()) throw new Error('Gym name is required');
        const cleanedSlug = slugify(slug);
        if (!cleanedSlug) {
          throw new Error('Slug must contain at least one letter or digit');
        }
        // Name first, then slug, so failures are localised.
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
        return;
      }

      const payload = {
        p_gym_id: membership.gymId,
        p_logo_url: gym.data.logo_url,
        p_primary_color: gym.data.primary_color,
        p_secondary_color: gym.data.secondary_color,
        p_text_color: gym.data.text_color,
        p_logo_url_dark: gym.data.logo_url_dark,
        p_primary_color_dark: gym.data.primary_color_dark,
        p_secondary_color_dark: gym.data.secondary_color_dark,
        p_text_color_dark: gym.data.text_color_dark,
      };
      if (card === 'colours') {
        const p = normaliseHex(primary);
        const s = normaliseHex(secondary);
        const t = normaliseHex(textColor);
        if (!p || !s || !t) {
          throw new Error('Each colour needs to be a valid 6-character hex');
        }
        payload.p_primary_color = p;
        payload.p_secondary_color = s;
        payload.p_text_color = t;
      } else if (card === 'logo') {
        payload.p_logo_url = logoUrl;
      } else {
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
        payload.p_logo_url_dark = logoUrlDark;
        payload.p_primary_color_dark = pd;
        payload.p_secondary_color_dark = sd;
        payload.p_text_color_dark = td;
      }
      const { error: e3 } = await supabase.rpc('set_gym_branding', payload);
      if (e3) throw e3;
    },
    onSuccess: () => {
      setSaveError(null);
      markSaved();
      invalidateBrand();
    },
    onError: (e, card) =>
      setSaveError({ card, message: errorMessage(e, 'Could not save') }),
  });

  // The two public-link switches save on toggle — the flip is the
  // action. On failure the switch reverts to the server state.
  const setSignup = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!membership) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_gym_public_signup', {
        p_gym_id: membership.gymId,
        p_enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSaveError(null);
      invalidateBrand();
    },
    onError: (e) => {
      setPublicSignup(gym.data?.public_signup_enabled ?? true);
      setSaveError({
        card: 'signup',
        message: errorMessage(e, 'Could not update public signup'),
      });
    },
  });

  const setLead = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!membership) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_gym_public_lead_capture', {
        p_gym_id: membership.gymId,
        p_enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSaveError(null);
      invalidateBrand();
    },
    onError: (e) => {
      setLeadCapture(gym.data?.public_lead_capture_enabled ?? false);
      setSaveError({
        card: 'lead',
        message: errorMessage(e, 'Could not update the lead capture form'),
      });
    },
  });

  function cardSaveProps(card: CardKey) {
    return {
      onPress: () => save.mutate(card),
      loading: save.isPending && save.variables === card,
      success: saved && save.variables === card,
    };
  }

  function cardError(card: CardKey) {
    return saveError?.card === card ? (
      <Text className="text-red-500 dark:text-red-400 text-sm">
        {saveError.message}
      </Text>
    ) : null;
  }

  if (canManageStaff === false) {
    return (
      <Text className="text-ink-2 dark:text-ink-2-dk">
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
          <View className="flex-1 bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Colours
            </Text>
            <ColourField
              label="Primary"
              hint="Buttons, active state and icons."
              value={primary}
              onChange={setPrimary}
              pickerOpen={pickerFor === 'primary'}
              onPick={() => setPickerFor(pickerFor === 'primary' ? null : 'primary')}
            />
            <PrimaryContrastNote colour={primary} />
            <ColourField
              label="Secondary"
              hint="Accent chips and tints."
              value={secondary}
              onChange={setSecondary}
              pickerOpen={pickerFor === 'secondary'}
              onPick={() =>
                setPickerFor(pickerFor === 'secondary' ? null : 'secondary')
              }
            />
            <ColourField
              label="Text"
              hint="Links and CTA text (the gym name stays neutral)."
              value={textColor}
              onChange={setTextColor}
              pickerOpen={pickerFor === 'text'}
              onPick={() => setPickerFor(pickerFor === 'text' ? null : 'text')}
            />
            {cardError('colours')}
            <Button {...cardSaveProps('colours')}>Save</Button>
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

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Text className="text-ink dark:text-ink-dk font-semibold">
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
          {cardError('logo')}
          <Button {...cardSaveProps('logo')}>Save</Button>
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
          error={saveError?.card === 'dark' ? saveError.message : null}
          saveProps={cardSaveProps('dark')}
        />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Text className="text-ink dark:text-ink-dk font-semibold">
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
          {cardError('details')}
          <Button {...cardSaveProps('details')}>Save</Button>
        </View>

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk font-semibold">
                Public signup
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                When on, anyone with your join link can sign up as a member.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Public signup"
              value={publicSignup}
              onValueChange={(v) => {
                setPublicSignup(v);
                setSignup.mutate(v);
              }}
            />
          </View>
          {cardError('signup')}
          {publicSignup && cleanedSlug ? (
            <View className="gap-1">
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Share this link
              </Text>
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm font-mono" numberOfLines={1}>
                  {joinUrl(origin, cleanedSlug)}
                </Text>
                <Pressable
                  onPress={() => copyToClipboard(joinUrl(origin, cleanedSlug))}
                  hitSlop={6}
                  className="active:opacity-70">
                  <Ionicons name="copy-outline" size={18} color={colors.ink3} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-ink dark:text-ink-dk font-semibold">
                Lead capture form
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                When on, anyone with your enquiry link can leave their
                details — they land in Manage → AI Front Desk as a cold lead.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Lead capture form"
              value={leadCapture}
              onValueChange={(v) => {
                setLeadCapture(v);
                setLead.mutate(v);
              }}
            />
          </View>
          {cardError('lead')}
          {leadCapture && cleanedSlug ? (
            <View className="gap-1">
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                Share this enquiry link
              </Text>
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm font-mono" numberOfLines={1}>
                  {leadUrl(origin, cleanedSlug)}
                </Text>
                <Pressable
                  onPress={() => copyToClipboard(leadUrl(origin, cleanedSlug))}
                  hitSlop={6}
                  className="active:opacity-70">
                  <Ionicons name="copy-outline" size={18} color={colors.ink3} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
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
  error,
  saveProps,
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
  error: string | null;
  saveProps: { onPress: () => void; loading: boolean; success: boolean };
}) {
  const colors = useThemeColors();
  // Resolve what the dark-mode logo row shows. Same fallback logic
  // the read path runs at useGymBrand, so what the owner sees here
  // is what members will get.
  const previewPrimaryDark =
    normaliseHex(primaryDark) ?? deriveDarkColour(lightPrimary);
  const previewLogoDark = logoUrlDark ?? lightLogoUrl;

  // CTA always derives the dark fields from the light ones. The
  // earlier mode-flip variant wrote into the light fields when in
  // dark scheme — those live in a different card, so the button
  // appeared to do nothing from the Advanced card. Keep the effect
  // visible next to the controls that change.
  function autoGenerate() {
    onChangePrimaryDark(deriveDarkColour(lightPrimary));
    onChangeSecondaryDark(deriveDarkColour(lightSecondary));
    onChangeTextColorDark(deriveDarkColour(lightText));
  }

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center gap-3 p-4 active:opacity-70">
        <View className="w-9 h-9 rounded-lg bg-primary/10 items-center justify-center">
          <Ionicons name="contrast-outline" size={18} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Advanced branding
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            Set a different logo and palette for dark mode. Anything you leave
            blank is auto-generated from your light-mode colours.
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.ink3}
        />
      </Pressable>

      {open ? (
        <View className="border-t border-line dark:border-line-dk p-4 gap-5">
          {/* Dark logo */}
          <View className="gap-2">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Dark-mode logo
            </Text>
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              Upload an inverted version of your mark if your logo
              doesn't read on a dark background. Leave blank to reuse
              the light-mode logo.
            </Text>
            <View className="flex-row items-center gap-3">
              <View className="bg-ink p-2 rounded-lg">
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
              <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
                Dark-mode colours
              </Text>
              <ChipButton
                tone="inverse"
                label="Auto-generate from light"
                icon="sparkles"
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

          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Toggle the app to dark mode (top-right) after saving to see the
            full chrome render with these colours.
          </Text>

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}
          <Button {...saveProps}>Save</Button>
        </View>
      ) : null}
    </View>
  );
}

// Buttons pick white or near-black ink for their label depending on
// which reads better on the primary fill (Button.tsx). Warn when even
// the better option misses WCAG AA (4.5:1) — a mid-luminance brand
// colour leaves button labels hard to read for low-vision members.
function PrimaryContrastNote({ colour }: { colour: string }) {
  const hex = normaliseHex(colour);
  if (!hex) return null;
  const best = Math.max(contrastRatio(hex, '#FFFFFF'), contrastRatio(hex, '#111827'));
  if (best >= 4.5) return null;
  return (
    <View className="flex-row items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
      <Ionicons name="warning-outline" size={14} color="#D97706" />
      <Text className="flex-1 text-amber-700 dark:text-amber-400 text-xs">
        Button text on this colour reaches only {best.toFixed(1)}:1 contrast
        (WCAG AA needs 4.5:1). A darker or lighter shade will be easier to
        read.
      </Text>
    </View>
  );
}
