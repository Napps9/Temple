import { useMutation, useQuery } from '@tanstack/react-query';
import { Linking, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export const MEMBER_PROGRAMMING_BUCKET = 'member-programming-files';

export type MemberProgrammingFile = {
  id: string;
  title: string;
  file_path: string;
  created_at: string;
};

export type MyProgrammingAccess = {
  entitled: boolean;
  mode: 'free' | 'paid';
  has_programming: boolean;
  product_id: string | null;
  product_name: string | null;
  product_price_cents: number | null;
  product_recurring: boolean;
  product_recurring_interval: string | null;
  product_active: boolean;
  plan_upgrade_available: boolean;
};

export function useMemberProgrammingFiles(
  gymId: string | undefined,
  profileId: string | undefined,
) {
  return useQuery({
    queryKey: ['member-programming-files', gymId, profileId],
    enabled: !!gymId && !!profileId,
    queryFn: async (): Promise<MemberProgrammingFile[]> => {
      const { data, error } = await supabase
        .from('member_programming_files')
        .select('id, title, file_path, created_at')
        .eq('gym_id', gymId!)
        .eq('profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MemberProgrammingFile[];
    },
  });
}

// The member-side summary powering the Programming tab: whether any
// individual programming exists at all (computed server-side, because
// RLS hides the rows from a locked-out member) and what unlocks it.
export function useMyProgrammingAccess(
  gymId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['my-programming-access', gymId],
    enabled: !!gymId && enabled,
    queryFn: async (): Promise<MyProgrammingAccess | null> => {
      const { data, error } = await supabase.rpc('my_programming_access', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as MyProgrammingAccess | null;
    },
  });
}

// Mints a short-lived signed URL for a programme PDF and opens it —
// same shape as useStoreDownload (the bucket is private).
export function useOpenProgrammingFile() {
  return useMutation({
    mutationFn: async (filePath: string) => {
      const { data, error } = await supabase.storage
        .from(MEMBER_PROGRAMMING_BUCKET)
        .createSignedUrl(filePath, 3600);
      if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Could not open the document');
      }
      const url = data.signedUrl;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    },
  });
}
