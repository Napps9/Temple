import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { BrandPreview } from '@/components/BrandPreview';
import { Button } from '@/components/Button';
import { GymLogo } from '@/components/GymLogo';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { DEFAULT_BRAND, joinUrl, normaliseHex, slugify } from '@/lib/brand';
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
};

export default function BrandingPage() {
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
          'id, name, slug, logo_url, primary_color, secondary_color, text_color, public_signup_enabled',
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
  const [publicSignup, setPublicSignup] = useState(true);
  const [slugWarn, setSlugWarn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (gym.data) {
      setName(gym.data.name);
      setSlug(gym.data.slug);
      setPrimary(gym.data.primary_color);
      setSecondary(gym.data.secondary_color);
      setTextColor(gym.data.text_color);
      setLogoUrl(gym.data.logo_url);
      setPublicSignup(gym.data.public_signup_enabled);
    }
  }, [gym.data]);

  const upload = useMutation({
    mutationFn: async () => {
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
      const path = `${membership.gymId}/${Date.now()}.${ext}`;
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
    onSuccess: (url) => {
      if (url) setLogoUrl(url);
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
      const { error: e3 } = await supabase.rpc('set_gym_branding', {
        p_gym_id: membership.gymId,
        p_logo_url: logoUrl,
        p_primary_color: p,
        p_secondary_color: s,
        p_text_color: t,
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
      <Screen>
        <Text className="text-gray-500 dark:text-gray-400 mt-8">
          Only the owner can edit branding.
        </Text>
      </Screen>
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

        <BrandPreview
          gymName={name || 'Your gym name'}
          logoUrl={logoUrl}
          primaryColor={previewPrimary}
          secondaryColor={previewSecondary}
          textColor={previewText}
        />

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
              <Pressable
                onPress={() => upload.mutate()}
                disabled={upload.isPending}
                className="self-start px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 active:opacity-70">
                <Text className="text-gray-700 dark:text-gray-200 text-xs uppercase tracking-widest">
                  {upload.isPending
                    ? 'Uploading…'
                    : logoUrl
                      ? 'Replace logo'
                      : 'Upload logo'}
                </Text>
              </Pressable>
              {logoUrl ? (
                <Pressable
                  onPress={() => setLogoUrl(null)}
                  className="self-start px-3 py-1.5 active:opacity-70">
                  <Text className="text-red-500 dark:text-red-400 text-xs">
                    Remove
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Colours
          </Text>
          <Input
            label="Primary"
            value={primary}
            onChangeText={setPrimary}
            autoCapitalize="characters"
            placeholder="#2563EB"
          />
          <Input
            label="Secondary"
            value={secondary}
            onChangeText={setSecondary}
            autoCapitalize="characters"
            placeholder="#0F172A"
          />
          <Input
            label="Text"
            value={textColor}
            onChangeText={setTextColor}
            autoCapitalize="characters"
            placeholder="#0F172A"
          />
        </View>

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
      </ScrollView>
    </Screen>
  );
}

function copyToClipboard(text: string) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(text);
  }
}
