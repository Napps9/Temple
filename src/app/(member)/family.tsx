import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { PageHead } from '@/components/PageHead';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { CONSENT_POLICY_VERSION, computeAge } from '@/lib/consent';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useDependents, type Dependent } from '@/lib/useDependents';
import { useGymAllowMinors } from '@/lib/useGymAllowMinors';

// Parent/family: add children as dependents and see when each is ready to
// book (their gym screening complete). A dependent has no login of their
// own — the guardian acts for them.
export default function FamilyScreen() {
  const { data: membership } = useGymMembership();
  const allowMinors = useGymAllowMinors();
  const queryClient = useQueryClient();
  const dependents = useDependents();

  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);

  const validDob = /^\d{4}-\d{2}-\d{2}$/.test(dob);
  const age = validDob ? computeAge(dob) : null;
  const canAdd = name.trim().length > 0 && validDob && age != null && age < 18;

  const add = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      const { error: e } = await supabase.rpc('create_dependent', {
        p_gym_id: membership.gymId,
        p_full_name: name.trim(),
        p_dob: dob,
        p_policy_version: CONSENT_POLICY_VERSION,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setName('');
      setDob('');
      queryClient.invalidateQueries({ queryKey: ['dependents'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not add your child')),
  });

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/account" />

        <PageHead
          title="Family"
          subtitle="Add children you look after. They don't get their own login — you book their classes, sign their waiver and complete their health screening from this account."
        />

        {!allowMinors ? (
          <View className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-card p-4">
            <Text className="text-amber-700 dark:text-amber-300 text-sm">
              This gym doesn't currently accept members under 18. Ask your gym
              if they can enable family memberships.
            </Text>
          </View>
        ) : (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
            <Text className="text-ink dark:text-ink-dk font-semibold">
              Add a child
            </Text>
            <Input
              label="Child's full name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <DatePicker
              label="Date of birth"
              value={dob}
              onChange={setDob}
              max={new Date().toISOString().slice(0, 10)}
            />
            {validDob && age != null && age >= 18 ? (
              <Text className="text-amber-600 dark:text-amber-400 text-xs">
                A dependent must be under 18. An adult should make their own
                account.
              </Text>
            ) : null}
            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <Button
              onPress={() => add.mutate()}
              loading={add.isPending}
              disabled={!canAdd}>
              Add child
            </Button>
          </View>
        )}

        <View className="gap-3">
          {dependents.isLoading ? (
            <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
          ) : (dependents.data ?? []).length === 0 ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-sm">
              No children added yet.
            </Text>
          ) : (
            (dependents.data ?? []).map((d) => (
              <DependentCard key={d.id} dependent={d} gymId={membership?.gymId} />
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

// Per-child readiness: shows what screening the child still needs before they
// can be booked, with a link to complete it on their behalf.
function DependentCard({
  dependent,
  gymId,
}: {
  dependent: Dependent;
  gymId?: string;
}) {
  const queryClient = useQueryClient();
  const [showRemove, setShowRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('remove_dependent', {
        p_dependent_id: dependent.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setShowRemove(false);
      setRemoveError(null);
      queryClient.invalidateQueries({ queryKey: ['dependents'] });
    },
    onError: (e) => setRemoveError(errorMessage(e, 'Could not remove')),
  });

  const screening = useQuery({
    queryKey: ['dependent-screening', dependent.id, gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const [waiver, parq] = await Promise.all([
        supabase.rpc('current_waiver_state', {
          p_gym_id: gymId!,
          p_profile_id: dependent.id,
        }),
        supabase.rpc('current_parq_state', {
          p_gym_id: gymId!,
          p_profile_id: dependent.id,
        }),
      ]);
      if (waiver.error) throw waiver.error;
      if (parq.error) throw parq.error;
      return {
        needsWaiver: !!waiver.data?.[0]?.needs_waiver,
        needsParq: !!parq.data?.[0]?.needs_parq,
      };
    },
  });

  const age = dependent.dob ? computeAge(dependent.dob) : null;
  const needsWaiver = screening.data?.needsWaiver;
  const needsParq = screening.data?.needsParq;
  const ready = screening.data && !needsWaiver && !needsParq;

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-ink dark:text-ink-dk font-semibold">
          {dependent.fullName ?? 'Child'}
        </Text>
        <View className="flex-row items-center gap-3">
          {age != null ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              age {age}
            </Text>
          ) : null}
          <ChipButton
            tone="red"
            icon="trash-outline"
            label="Remove"
            onPress={() => setShowRemove(true)}
          />
        </View>
      </View>

      {screening.isLoading ? (
        <Text className="text-ink-3 dark:text-ink-3-dk text-xs">Checking…</Text>
      ) : ready ? (
        <Text className="text-emerald-600 dark:text-emerald-400 text-xs">
          Ready to book — book them from any class.
        </Text>
      ) : (
        <View className="gap-2">
          {needsWaiver ? (
            <Pressable
              onPress={() =>
                router.push(`/waiver?subject=${dependent.id}` as never)
              }
              className="flex-row items-center gap-2">
              <Text className="text-primary text-sm underline">
                Sign their waiver
              </Text>
            </Pressable>
          ) : null}
          {needsParq ? (
            <Pressable
              onPress={() =>
                router.push(`/parq?subject=${dependent.id}` as never)
              }
              className="flex-row items-center gap-2">
              <Text className="text-primary text-sm underline">
                Complete their PAR-Q
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <ConfirmDialog
        visible={showRemove}
        title="Remove this child?"
        body={`This removes ${
          dependent.fullName ?? 'this child'
        } from the gym and erases their health data (PAR-Q, injuries). This can't be undone.`}
        confirmLabel="Remove"
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setShowRemove(false);
          setRemoveError(null);
        }}
        pending={remove.isPending}
        error={removeError}
      />
    </View>
  );
}
