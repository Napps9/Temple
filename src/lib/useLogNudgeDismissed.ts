import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

// Day keys (YYYY-MM-DD) the member has manually dismissed from the
// "log your workout" nudge, persisted in AsyncStorage. useLogNudge reads
// this and drops matching items, so a dismissal clears the Track card,
// the inbox banner and the nav badge together — and stays gone across
// reloads. Keys older than the nudge window are pruned on every read/
// write so the store can't grow without bound.

const STORAGE_KEY = 'track_log_nudge_dismissed';
const QUERY_KEY = ['log-nudge-dismissed'] as const;
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

function prune(days: string[]): string[] {
  const cutoff = Date.now() - KEEP_MS;
  return days.filter((d) => {
    const t = new Date(`${d}T00:00:00`).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

async function readDays(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return prune(parsed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Stored garbage; treat as empty.
  }
  return [];
}

async function writeDays(days: string[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prune(days)));
}

export function useDismissedLogNudgeDays() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<Set<string>> => new Set(await readDays()),
    staleTime: Infinity,
  });
}

export function useDismissLogNudge() {
  const queryClient = useQueryClient();
  return useCallback(
    async (days: string[]) => {
      const current =
        queryClient.getQueryData<Set<string>>(QUERY_KEY) ??
        new Set(await readDays());
      const next = new Set(current);
      for (const d of days) next.add(d);
      queryClient.setQueryData(QUERY_KEY, next);
      await writeDays([...next]);
    },
    [queryClient],
  );
}
