import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Check } from '@/components/Check';
import { Sheet, SheetAction } from '@/components/Sheet';
import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';

type PickerMember = { profile_id: string; full_name: string | null };

// Hand-picking recipients. The server has understood
// {"kind":"manual","profile_ids":[…]} since 0044 and the client type has
// carried it just as long — the only thing missing was somewhere to say
// which members, which is this.
export function MemberPickerSheet({
  visible,
  selected,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  selected: string[];
  onClose: () => void;
  onConfirm: (profileIds: string[]) => void;
}) {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));

  // Re-seed whenever the incoming selection changes or the sheet reopens.
  // useState only runs its initialiser once, and this sheet is rendered
  // unconditionally rather than behind `{picking && …}`, so it never
  // remounts — without this, loading a saved segment and tapping Change
  // would commit whatever was ticked earlier in the session instead, and
  // closing with X would leave abandoned ticks to be committed next time.
  const key = selected.join(',');
  useEffect(() => {
    if (visible) setPicked(new Set(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);

  const members = useQuery({
    queryKey: ['comms-picker-members', membership?.gymId],
    enabled: !!membership?.gymId && visible,
    queryFn: async (): Promise<PickerMember[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .eq('role', 'member')
        .is('left_at', null);
      if (error) throw error;
      return ((data ?? []) as unknown as {
        profile_id: string;
        profiles: { full_name: string | null } | null;
      }[])
        .map((r) => ({
          profile_id: r.profile_id,
          full_name: r.profiles?.full_name ?? null,
        }))
        .sort((a, b) =>
          (a.full_name ?? '').localeCompare(b.full_name ?? ''),
        );
    },
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = members.data ?? [];
    if (!q) return all;
    return all.filter((m) => (m.full_name ?? '').toLowerCase().includes(q));
  }, [members.data, search]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Sheet
      visible={visible}
      title="Pick members"
      onClose={onClose}
      actions={
        <SheetAction grow>
          <Button
            onPress={() => {
              onConfirm([...picked]);
              onClose();
            }}>
            {picked.size === 1 ? 'Use 1 member' : `Use ${picked.size} members`}
          </Button>
        </SheetAction>
      }>
      <View className="gap-2 pb-1">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name"
          placeholderTextColor={colors.ink3}
          className="bg-surface dark:bg-surface-dk rounded-ctl px-3 py-3 text-ink dark:text-ink-dk text-[15px] border border-line-strong dark:border-line-strong-dk"
        />

        {members.isLoading ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            Loading members…
          </Text>
        ) : shown.length === 0 ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-[13px]">
            {search.trim() ? 'Nobody by that name.' : 'No members yet.'}
          </Text>
        ) : (
          <View className="rounded-card border border-line dark:border-line-dk overflow-hidden">
            {shown.map((m, i) => {
              const on = picked.has(m.profile_id);
              return (
                <Pressable
                  key={m.profile_id}
                  onPress={() => toggle(m.profile_id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  className={`flex-row items-center gap-3 px-3.5 py-3 active:bg-raised dark:active:bg-raised-dk ${
                    i === 0 ? '' : 'border-t border-line dark:border-line-dk'
                  }`}>
                  <Check on={on} />
                  <Text className="flex-1 text-ink dark:text-ink-dk text-[14.5px]">
                    {m.full_name ?? 'Member'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </Sheet>
  );
}
