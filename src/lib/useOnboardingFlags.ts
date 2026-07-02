import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

// Local, per-device "I've done this" flags for onboarding steps that
// leave no server-side trace to detect completion from — peeking at the
// week's programming, or answering the injury question with "nothing to
// report". Modelled as a React Query (like useGroupViewed) so the
// checklist re-renders the instant a flag is set from another screen.

export type OnboardingFlag =
  | 'programming_peeked'
  | 'injury_answered'
  | 'getstarted_dismissed';

type FlagMap = Partial<Record<OnboardingFlag, boolean>>;

const STORAGE_KEY = 'member_onboarding_flags';
const QUERY_KEY = ['member-onboarding-flags'] as const;

async function readMap(): Promise<FlagMap> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as FlagMap;
  } catch {
    // Stored garbage; treat as empty.
  }
  return {};
}

async function writeMap(map: FlagMap): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function useOnboardingFlags() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: readMap,
    staleTime: Infinity,
  });
}

export function useSetOnboardingFlag() {
  const queryClient = useQueryClient();
  return useCallback(
    async (flag: OnboardingFlag) => {
      const current =
        queryClient.getQueryData<FlagMap>(QUERY_KEY) ?? (await readMap());
      if (current[flag]) return;
      const next: FlagMap = { ...current, [flag]: true };
      queryClient.setQueryData(QUERY_KEY, next);
      await writeMap(next);
    },
    [queryClient],
  );
}
