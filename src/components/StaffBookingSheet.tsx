import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Sheet } from './Sheet';
import { ListRow, RuledList } from './ListRow';
import { FieldLabel } from './SectionLabel';
import { Text, TextInput } from './Text';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptic';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import type { GymRole } from '@/types/database';

type Entitlement = {
  kind: 'comp_grant' | 'plan_subscription';
  id: string;
  is_default: boolean;
  label: string;
};

type Candidate = {
  profile_id: string;
  full_name: string | null;
  role: GymRole;
};

export function StaffBookingSheet({
  visible,
  mode,
  sessionId,
  gymId,
  bookedProfileIds,
  swapTarget,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  mode: 'add' | 'swap';
  sessionId: string;
  gymId: string;
  bookedProfileIds: Set<string>;
  swapTarget: {
    bookingId: string;
    profileId: string;
    profileName: string | null;
    currentKind: 'comp_grant' | 'plan_subscription' | null;
    currentId: string | null;
  } | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<Candidate | null>(null);
  const [chosen, setChosen] = useState<Entitlement | null>(null);
  const [noCharge, setNoCharge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetProfileId =
    mode === 'swap' ? swapTarget?.profileId ?? null : selectedMember?.profile_id ?? null;

  const candidates = useQuery({
    queryKey: ['staff-book-candidates', gymId, sessionId],
    enabled: visible && mode === 'add',
    queryFn: async (): Promise<Candidate[]> => {
      const { data, error: e } = await supabase
        .from('gym_memberships')
        .select('profile_id, role, profiles!profile_id(full_name)')
        .eq('gym_id', gymId)
        .is('left_at', null);
      if (e) throw e;
      return (data ?? [])
        .map((r) => {
          const row = r as unknown as {
            profile_id: string;
            role: GymRole;
            profiles: { full_name: string | null } | null;
          };
          return {
            profile_id: row.profile_id,
            full_name: row.profiles?.full_name ?? null,
            role: row.role,
          };
        })
        .filter((c) => !bookedProfileIds.has(c.profile_id));
    },
  });

  const entitlements = useQuery({
    queryKey: ['staff-book-entitlements', sessionId, targetProfileId],
    enabled: visible && !!targetProfileId,
    queryFn: async (): Promise<Entitlement[]> => {
      const { data, error: e } = await supabase.rpc('list_booking_entitlements', {
        p_class_session_id: sessionId,
        p_target_profile_id: targetProfileId!,
      });
      if (e) throw e;
      return (data ?? []) as Entitlement[];
    },
  });

  const filteredMembers = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const all = candidates.data ?? [];
    const sorted = all
      .slice()
      .sort((a, b) =>
        (a.full_name ?? '').localeCompare(b.full_name ?? ''),
      );
    if (!trimmed) return sorted;
    return sorted.filter((c) =>
      (c.full_name ?? '').toLowerCase().includes(trimmed),
    );
  }, [candidates.data, query]);

  const book = useMutation({
    mutationFn: async () => {
      if (!targetProfileId) throw new Error('Pick a member first');
      const { error: e } = await supabase.rpc('staff_book_member', {
        p_session_id: sessionId,
        p_member_profile_id: targetProfileId,
        p_entitlement_kind: chosen?.kind ?? null,
        p_entitlement_id: chosen?.id ?? null,
        p_no_charge: noCharge,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.success();
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['class-bookings', sessionId] });
      onSuccess();
      reset();
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not book this member'));
    },
  });

  const swap = useMutation({
    mutationFn: async () => {
      if (!swapTarget) throw new Error('No booking to swap');
      if (!noCharge && !chosen) throw new Error('Pick a plan');
      const { error: e } = await supabase.rpc('swap_booking_subscription', {
        p_booking_id: swapTarget.bookingId,
        p_entitlement_kind: noCharge ? null : chosen!.kind,
        p_entitlement_id: noCharge ? null : chosen!.id,
        p_no_charge: noCharge,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      haptic.success();
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['class-bookings', sessionId] });
      onSuccess();
      reset();
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e, 'Could not swap this booking'));
    },
  });

  function reset() {
    setSelectedMember(null);
    setChosen(null);
    setNoCharge(false);
    setQuery('');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  const showSearch = mode === 'add' && !selectedMember;
  const showPicker = !!targetProfileId;
  const memberName =
    mode === 'swap'
      ? swapTarget?.profileName ?? 'Member'
      : selectedMember?.full_name ?? 'Member';

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={
        mode === 'add' && !selectedMember
          ? 'Add a member'
          : mode === 'add'
            ? `Book ${memberName}`
            : `Switch ${memberName}'s plan`
      }
      onBack={
        mode === 'add' && selectedMember
          ? () => {
              setSelectedMember(null);
              setChosen(null);
              setNoCharge(false);
            }
          : undefined
      }>

          {showSearch ? (
            <>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search members"
                placeholderTextColor={colors.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-ctl px-3 py-2.5 text-ink dark:text-ink-dk"
              />
              <ScrollView className="max-h-72">
                {candidates.isLoading ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    Loading…
                  </Text>
                ) : filteredMembers.length === 0 ? (
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    No matching members not already booked.
                  </Text>
                ) : (
                  <RuledList>
                    {filteredMembers.map((c, i) => (
                      <ListRow
                        ruled
                        first={i === 0}
                        key={c.profile_id}
                        onPress={() => setSelectedMember(c)}
                        lead={<Avatar name={c.full_name} size={32} />}
                        title={c.full_name ?? 'Member'}
                        subtitle={c.role}
                      />
                    ))}
                  </RuledList>
                )}
              </ScrollView>
            </>
          ) : showPicker ? (
            <>
              {entitlements.isLoading ? (
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  Loading memberships…
                </Text>
              ) : (
                <View className="gap-2">
                  {(entitlements.data?.length ?? 0) === 0 ? (
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                      This member has no eligible plans or comps for this
                      class —{' '}
                      {mode === 'add'
                        ? 'book them without charging instead.'
                        : 'comp this session instead.'}
                    </Text>
                  ) : null}
                  {entitlements.data?.map((e) => {
                    const swapCurrent =
                      mode === 'swap' &&
                      swapTarget?.currentKind === e.kind &&
                      swapTarget?.currentId === e.id;
                    const sel =
                      !noCharge &&
                      ((chosen && chosen.kind === e.kind && chosen.id === e.id) ||
                        (!chosen && mode === 'swap' && swapCurrent) ||
                        (!chosen && mode === 'add' && e.is_default));
                    return (
                      <Pressable
                        key={`${e.kind}:${e.id}`}
                        onPress={() => {
                          setChosen(e);
                          setNoCharge(false);
                        }}
                        className={`flex-row items-center gap-2 rounded-lg px-3 py-2 border ${
                          sel
                            ? 'border-transparent bg-raised dark:bg-raised-dk'
                            : 'border-line dark:border-line-dk'
                        }`}>
                        <Ionicons
                          name={sel ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={sel ? colors.primary : colors.ink3}
                        />
                        <Text className="text-ink dark:text-ink-dk text-sm flex-1">
                          {e.label}
                        </Text>
                        {mode === 'swap' && swapCurrent ? (
                          <FieldLabel>
                            Current
                          </FieldLabel>
                        ) : e.is_default ? (
                          <FieldLabel>
                            Default
                          </FieldLabel>
                        ) : null}
                      </Pressable>
                    );
                  })}
                  <Pressable
                    onPress={() => {
                      setNoCharge(true);
                      setChosen(null);
                    }}
                    className={`flex-row items-center gap-2 rounded-lg px-3 py-2 border ${
                      noCharge
                        ? 'border-transparent bg-raised dark:bg-raised-dk'
                        : 'border-line dark:border-line-dk'
                    }`}>
                    <Ionicons
                      name={noCharge ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={noCharge ? colors.primary : colors.ink3}
                    />
                    <Text className="text-ink dark:text-ink-dk text-sm flex-1">
                      No charge
                    </Text>
                    <FieldLabel>
                      Free
                    </FieldLabel>
                  </Pressable>
                </View>
              )}
              {error ? (
                <Text className="text-red-500 dark:text-red-400 text-sm">
                  {error}
                </Text>
              ) : null}
              <Button
                onPress={() => {
                  if (mode === 'add') book.mutate();
                  else swap.mutate();
                }}
                loading={book.isPending || swap.isPending}
                disabled={
                  entitlements.isLoading ||
                  (!noCharge && (entitlements.data?.length ?? 0) === 0)
                }>
                {mode === 'add' ? 'Book' : 'Swap'}
              </Button>
            </>
          ) : null}
    </Sheet>
  );
}
