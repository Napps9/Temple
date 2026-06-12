import { useQuery } from '@tanstack/react-query';
import { useColorScheme } from 'nativewind';
import { useMemo } from 'react';

import { useGymMembership } from './auth';
import {
  FALLBACK_BRAND,
  type BrandMode,
  type GymBrand,
} from './brand';
import { deriveDarkColour, deriveLightColour } from './brand-derivation';
import { supabase } from './supabase';

// Storage row shape — both modes' colours, both logos, plus the
// metadata the chrome reads. Dark columns are nullable and treated as
// "auto-derive from light" when absent.
type GymBrandRow = {
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

// Build the dark mode set: use explicit values where they exist, fall
// back to the contrast-aware derivation otherwise. The dark logo
// falls back to the light logo if no dark variant was uploaded — a
// transparent-PNG mark usually reads on both backgrounds.
function buildDarkMode(row: GymBrandRow): BrandMode {
  return {
    logoUrl: row.logo_url_dark ?? row.logo_url,
    primaryColor: row.primary_color_dark ?? deriveDarkColour(row.primary_color),
    secondaryColor:
      row.secondary_color_dark ?? deriveDarkColour(row.secondary_color),
    textColor: row.text_color_dark ?? deriveDarkColour(row.text_color),
  };
}

// Symmetric helper: derive a sensible light mode from the dark fields.
// Currently unused at read time (the light mode is the always-present
// canonical set), but exported so the Advanced editor can render the
// "auto-generated from dark" preview when a gym is being authored
// dark-first.
export function deriveLightModeFromDark(dark: BrandMode): BrandMode {
  return {
    logoUrl: dark.logoUrl,
    primaryColor: deriveLightColour(dark.primaryColor),
    secondaryColor: deriveLightColour(dark.secondaryColor),
    textColor: deriveLightColour(dark.textColor),
  };
}

// Symmetric helper for the editor's "auto-generate from light" button.
export function deriveDarkModeFromLight(light: BrandMode): BrandMode {
  return {
    logoUrl: light.logoUrl,
    primaryColor: deriveDarkColour(light.primaryColor),
    secondaryColor: deriveDarkColour(light.secondaryColor),
    textColor: deriveDarkColour(light.textColor),
  };
}

// Read the brand for the signed-in member's gym, with both light and
// dark modes resolved + the active-scheme set lifted to the top
// level so every chrome consumer (TopNav, Button, the QR cards…)
// keeps reading `brand.primaryColor` without caring which mode is on.
export function useGymBrand(): GymBrand {
  const { data: membership } = useGymMembership();
  const { colorScheme } = useColorScheme();
  const query = useQuery({
    queryKey: ['gym-brand', membership?.gymId],
    enabled: !!membership?.gymId,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<GymBrandRow> => {
      const { data, error } = await supabase
        .from('gyms')
        .select(
          'id, name, slug, logo_url, primary_color, secondary_color, text_color, public_signup_enabled, logo_url_dark, primary_color_dark, secondary_color_dark, text_color_dark',
        )
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as GymBrandRow;
    },
  });

  return useMemo<GymBrand>(() => {
    if (!query.data) return FALLBACK_BRAND;
    const row = query.data;
    const light: BrandMode = {
      logoUrl: row.logo_url,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      textColor: row.text_color,
    };
    const dark = buildDarkMode(row);
    const resolved = colorScheme === 'dark' ? dark : light;
    return {
      gymId: row.id,
      gymName: row.name,
      slug: row.slug,
      publicSignupEnabled: row.public_signup_enabled,
      ...resolved,
      modes: { light, dark },
    };
  }, [query.data, colorScheme]);
}
