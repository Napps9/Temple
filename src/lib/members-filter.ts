import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

export type MembersFilter =
  | 'all'
  | 'intro'
  | 'expiring'
  | 'expired'
  | 'active'
  | 'managed'
  | 'imported'
  | 'requests';

export type MembersFilterState = {
  filter: MembersFilter;
  // Tag label, ANDed with the cohort filter ("Active members tagged
  // VIP"). Labels are the cross-member identity for tags; null = any.
  tag: string | null;
  search: string;
};

const DEFAULT_STATE: MembersFilterState = { filter: 'all', tag: null, search: '' };

export function membersFilterStorageKey(gymId: string): string {
  return `temple.members-filter.${gymId}`;
}

export function serializeMembersFilter(state: MembersFilterState): string {
  return JSON.stringify(state);
}

export function parseMembersFilter(raw: string | null | undefined): MembersFilterState {
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<MembersFilterState>;
    const filter: MembersFilter =
      parsed.filter === 'intro' ||
      parsed.filter === 'expiring' ||
      parsed.filter === 'expired' ||
      parsed.filter === 'active' ||
      parsed.filter === 'managed' ||
      parsed.filter === 'imported' ||
      parsed.filter === 'requests'
        ? parsed.filter
        : 'all';
    const tag =
      typeof parsed.tag === 'string' && parsed.tag.length > 0 ? parsed.tag : null;
    const search = typeof parsed.search === 'string' ? parsed.search : '';
    return { filter, tag, search };
  } catch {
    return DEFAULT_STATE;
  }
}

export function useMembersFilter(gymId: string | null | undefined) {
  const [state, setStateRaw] = useState<MembersFilterState>(DEFAULT_STATE);
  const hydratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!gymId) return;
    let mounted = true;
    AsyncStorage.getItem(membersFilterStorageKey(gymId)).then((raw) => {
      if (!mounted) return;
      hydratedFor.current = gymId;
      setStateRaw(parseMembersFilter(raw));
    });
    return () => {
      mounted = false;
    };
  }, [gymId]);

  function update(next: Partial<MembersFilterState>) {
    setStateRaw((curr) => {
      const merged = { ...curr, ...next };
      if (gymId && hydratedFor.current === gymId) {
        AsyncStorage.setItem(
          membersFilterStorageKey(gymId),
          serializeMembersFilter(merged),
        ).catch(() => {});
      }
      return merged;
    });
  }

  function clear() {
    setStateRaw(DEFAULT_STATE);
    if (gymId) {
      AsyncStorage.removeItem(membersFilterStorageKey(gymId)).catch(() => {});
    }
  }

  return {
    filter: state.filter,
    tag: state.tag,
    search: state.search,
    setFilter: (f: MembersFilter) => update({ filter: f }),
    setTag: (t: string | null) => update({ tag: t }),
    setSearch: (s: string) => update({ search: s }),
    clear,
  };
}
