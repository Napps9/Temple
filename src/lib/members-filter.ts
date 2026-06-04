import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

export type MembersFilter = 'all' | 'intro' | 'expiring' | 'expired' | 'active';

export type MembersFilterState = {
  filter: MembersFilter;
  search: string;
};

const DEFAULT_STATE: MembersFilterState = { filter: 'all', search: '' };

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
      parsed.filter === 'active'
        ? parsed.filter
        : 'all';
    const search = typeof parsed.search === 'string' ? parsed.search : '';
    return { filter, search };
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
    search: state.search,
    setFilter: (f: MembersFilter) => update({ filter: f }),
    setSearch: (s: string) => update({ search: s }),
    clear,
  };
}
