import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
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
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 justify-end">
        <View className="bg-gray-50 dark:bg-gray-950 rounded-t-3xl max-h-[85%] gap-3 p-4">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-gray-900 dark:text-gray-50 text-lg font-semibold">
              Pick members
            </Text>
            <Pressable onPress={onClose} className="p-1 active:opacity-70">
              <Ionicons name="close" size={22} color={colors.iconTertiary} />
            </Pressable>
          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name"
            placeholderTextColor={colors.iconTertiary}
            className="bg-white dark:bg-gray-900 rounded-xl px-3 py-3 text-gray-900 dark:text-gray-50 border border-gray-200 dark:border-gray-700"
          />

          <ScrollView contentContainerClassName="gap-1 pb-2">
            {members.isLoading ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Loading members…
              </Text>
            ) : shown.length === 0 ? (
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                {search.trim() ? 'Nobody by that name.' : 'No members yet.'}
              </Text>
            ) : (
              shown.map((m) => {
                const on = picked.has(m.profile_id);
                return (
                  <Pressable
                    key={m.profile_id}
                    onPress={() => toggle(m.profile_id)}
                    className={`flex-row items-center gap-3 rounded-xl px-3 py-3 border ${
                      on
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                    } active:opacity-70`}>
                    <Ionicons
                      name={on ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={on ? colors.primary : colors.iconTertiary}
                    />
                    <Text className="flex-1 text-gray-900 dark:text-gray-50 text-sm">
                      {m.full_name ?? 'Member'}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Button
            onPress={() => {
              onConfirm([...picked]);
              onClose();
            }}>
            {picked.size === 1 ? 'Use 1 member' : `Use ${picked.size} members`}
          </Button>
        </View>
      </View>
    </Modal>
  );
}
