import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

// Per-group "I've seen what's new here" timestamp, persisted in
// AsyncStorage. The Track-home group tiles show a "N new" badge while
// recent logs are newer than this timestamp; opening the group calls
// markViewed() and the badge clears.
//
// We model it as a React Query so the badge re-renders the moment the
// group page mounts — Track-home and the group page share the
// ['group-viewed-at'] key and setQueryData propagation handles it.

type ViewedMap = Record<string, string>;

const STORAGE_KEY = 'track_group_viewed_at';
const QUERY_KEY = ['group-viewed-at'] as const;

async function readMap(): Promise<ViewedMap> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as ViewedMap;
  } catch {
    // Stored garbage; treat as empty.
  }
  return {};
}

async function writeMap(map: ViewedMap): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function useGroupViewedMap() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: readMap,
    staleTime: Infinity,
  });
}

export function useMarkGroupViewed() {
  const queryClient = useQueryClient();
  return useCallback(
    async (groupKey: string) => {
      const nowIso = new Date().toISOString();
      const current =
        queryClient.getQueryData<ViewedMap>(QUERY_KEY) ?? (await readMap());
      const next: ViewedMap = { ...current, [groupKey]: nowIso };
      queryClient.setQueryData(QUERY_KEY, next);
      await writeMap(next);
    },
    [queryClient],
  );
}
