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

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { useGymMembership } from '@/lib/auth';
import { joinUrl, leadUrl, normaliseHex, slugify } from '@/lib/brand';
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
  public_signup_enabled: boolean;
  public_lead_capture_enabled: boolean;
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
type CardKey = 'details' | 'signup' | 'lead';

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
          'id, name, slug, public_signup_enabled, public_lead_capture_enabled',
        )
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as GymRow;
    },
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [publicSignup, setPublicSignup] = useState(true);
  const [leadCapture, setLeadCapture] = useState(false);
  const [slugWarn, setSlugWarn] = useState(false);
  const [saveError, setSaveError] = useState<{
    card: CardKey;
    message: string;
  } | null>(null);
  const [saved, markSaved] = useSavedFlag();
  // Which field's inline picker is expanded (one at a time keeps the
  // card height sane).

  // Seed once. Cards save independently, so the refetch after one
  // card's save must not reseed (and wipe) the other cards' edits.
  const seeded = useRef(false);
  useEffect(() => {
    if (!gym.data || seeded.current) return;
    seeded.current = true;
    setName(gym.data.name);
    setSlug(gym.data.slug);
    setPublicSignup(gym.data.public_signup_enabled);
    setLeadCapture(gym.data.public_lead_capture_enabled);
  }, [gym.data]);

  function invalidateBrand() {
    queryClient.invalidateQueries({ queryKey: ['gym-row'] });
    queryClient.invalidateQueries({ queryKey: ['gym-brand'] });
    queryClient.invalidateQueries({ queryKey: ['gym-membership'] });
    queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
  }

  // Only the details card saves this way now — the two public-link
  // switches save on toggle below, and the colour and logo cards this
  // sat beside are gone.
  const save = useMutation({
    mutationFn: async (_card: CardKey) => {
      if (!membership || !gym.data) throw new Error('Missing context');
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
        Only the owner can edit these.
      </Text>
    );
  }


  // For preview / share-link rendering, use a placeholder origin on
  // native; on web read window.location.origin.
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.temple';
  const cleanedSlug = slugify(slug);

  return (
    <View className="gap-5">
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


