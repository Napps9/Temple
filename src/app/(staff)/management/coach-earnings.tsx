import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import {
  DateRangeCta,
  isoDate,
  presetRange,
  type Preset,
} from '@/components/DateRangeCta';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { PageHead } from '@/components/PageHead';
import { useGymMembership, useSession } from '@/lib/auth';
import {
  centsToRateInput,
  formatMoney,
  parseRateToCents,
  totalEarnings,
  type EarningsRow,
} from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';

type CoachRow = {
  profile_id: string;
  full_name: string | null;
};

type ClassTypeRow = {
  id: string;
  name: string;
  color: string;
};

type RateRow = {
  profile_id: string;
  class_type_id: string;
  per_class_cents: number;
};

type GymSettings = {
  coach_credit_policy: 'all_scheduled' | 'only_checked_in';
  currency: string;
};

const POLICIES: { key: 'all_scheduled' | 'only_checked_in'; label: string; blurb: string }[] = [
  {
    key: 'all_scheduled',
    label: 'All past sessions',
    blurb: 'Every class with this coach scheduled, once it has started.',
  },
  {
    key: 'only_checked_in',
    label: 'Only checked-in classes',
    blurb: 'Only classes where the coach marked at least one attendance.',
  },
];

export default function CoachEarningsPage() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const canSetCoachPay = useCan('can_set_coach_pay');
  const queryClient = useQueryClient();

  const [preset, setPreset] = useState<Preset>('month');
  const [customStart, setCustomStart] = useState(() => isoDate(new Date()));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const range = useMemo(() => {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetRange(preset, new Date());
  }, [preset, customStart, customEnd]);

  const gymQuery = useQuery({
    queryKey: ['gym-settings', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<GymSettings> => {
      const { data, error } = await supabase
        .from('gyms')
        .select('coach_credit_policy, currency')
        .eq('id', membership!.gymId)
        .single();
      if (error) throw error;
      return data as GymSettings;
    },
  });

  const coachesQuery = useQuery({
    queryKey: ['coach-roster', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<CoachRow[]> => {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('profile_id, profiles!profile_id(full_name)')
        .eq('gym_id', membership!.gymId)
        .eq('role', 'coach')
        .is('left_at', null);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as unknown as {
          profile_id: string;
          profiles: { full_name: string | null } | null;
        };
        return {
          profile_id: row.profile_id,
          full_name: row.profiles?.full_name ?? null,
        };
      });
    },
  });

  const classTypesQuery = useQuery({
    queryKey: ['class-types-active', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<ClassTypeRow[]> => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name, color')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as ClassTypeRow[];
    },
  });

  const ratesQuery = useQuery({
    queryKey: ['coach-pay-rates', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<RateRow[]> => {
      const { data, error } = await supabase
        .from('coach_pay_rates')
        .select('profile_id, class_type_id, per_class_cents')
        .eq('gym_id', membership!.gymId);
      if (error) throw error;
      return (data ?? []) as RateRow[];
    },
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['coach-pay-rates'] });
    queryClient.invalidateQueries({ queryKey: ['coach-earnings'] });
    queryClient.invalidateQueries({ queryKey: ['gym-settings'] });
  }

  const setPolicy = useMutation({
    mutationFn: async (policy: 'all_scheduled' | 'only_checked_in') => {
      if (!membership) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_coach_credit_policy', {
        p_gym_id: membership.gymId,
        p_policy: policy,
      });
      if (error) throw error;
    },
    onSuccess: () => refresh(),
  });

  if (!session) return null;
  if (canSetCoachPay === false) {
    return (
      <Screen>
        <Text className="text-ink-2 dark:text-ink-2-dk mt-8">
          Only the owner can set coach pay rates.
        </Text>
      </Screen>
    );
  }

  const gym = gymQuery.data;
  const coaches = coachesQuery.data ?? [];
  const classTypes = classTypesQuery.data ?? [];
  const rates = ratesQuery.data ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-3xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" coveredByNav />
        <PageHead
          title="Coach earnings"
          subtitle="Set per-class-type rates and review what each coach has earned."
        />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Credit policy
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            What counts as a class taught for earnings.
          </Text>
          <View className="gap-2">
            {POLICIES.map((p) => {
              const selected = gym?.coach_credit_policy === p.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setPolicy.mutate(p.key)}
                  className={`rounded-lg border p-3 flex-row gap-3 items-start active:opacity-70 ${
                    selected
                      ? 'border-transparent bg-raised dark:bg-raised-dk'
                      : 'border-line dark:border-line-dk'
                  }`}>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={selected ? colors.primary : colors.ink3}
                  />
                  <View className="flex-1">
                    <Text
                      className={
                        selected
                          ? 'text-ink dark:text-ink-dk font-semibold'
                          : 'text-ink dark:text-ink-dk font-medium'
                      }>
                      {p.label}
                    </Text>
                    <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                      {p.blurb}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {setPolicy.isError ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">
              {errorMessage(setPolicy.error, 'Could not update policy')}
            </Text>
          ) : null}
        </View>

        <View className="gap-2">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Earnings period
          </Text>
          <DateRangeCta
            preset={preset}
            range={range}
            customStart={customStart}
            customEnd={customEnd}
            onChange={(next) => {
              if (next.preset === 'custom') {
                setPreset('custom');
                setCustomStart(next.start);
                setCustomEnd(next.end);
              } else {
                setPreset(next.preset);
              }
            }}
          />
        </View>

        {coaches.length === 0 ? (
          <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4">
            <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
              No coaches yet. Invite one from the Team page.
            </Text>
          </View>
        ) : (
          coaches.map((c) => (
            <CoachCard
              key={c.profile_id}
              coach={c}
              gymId={membership!.gymId}
              classTypes={classTypes}
              rates={rates.filter((r) => r.profile_id === c.profile_id)}
              currency={gym?.currency ?? 'GBP'}
              periodStart={range.start}
              periodEnd={range.end}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

// The chosen view state, across unmounts — session-only, the
// GymSetupChecklist / list-scroll-position idiom.
const expandedCoaches = new Set<string>();

function CoachCard({
  coach,
  gymId,
  classTypes,
  rates,
  currency,
  periodStart,
  periodEnd,
}: {
  coach: CoachRow;
  gymId: string;
  classTypes: ClassTypeRow[];
  rates: RateRow[];
  currency: string;
  periodStart: string;
  periodEnd: string;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [expanded, setExpandedState] = useState(expandedCoaches.has(coach.profile_id));
  const setExpanded = (next: boolean | ((v: boolean) => boolean)) => {
    setExpandedState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      if (resolved) expandedCoaches.add(coach.profile_id);
      else expandedCoaches.delete(coach.profile_id);
      return resolved;
    });
  };

  const earnings = useQuery({
    queryKey: [
      'coach-earnings',
      gymId,
      coach.profile_id,
      periodStart,
      periodEnd,
    ],
    enabled: !!gymId && !!coach.profile_id,
    queryFn: async (): Promise<EarningsRow[]> => {
      const { data, error } = await supabase.rpc('compute_coach_earnings', {
        p_gym_id: gymId,
        p_coach_id: coach.profile_id,
        p_period_start: new Date(`${periodStart}T00:00:00`).toISOString(),
        p_period_end: new Date(`${periodEnd}T00:00:00`).toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as EarningsRow[];
    },
  });

  const totals = totalEarnings(earnings.data ?? []);
  const rateByCt = new Map(rates.map((r) => [r.class_type_id, r.per_class_cents]));

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        className="flex-row items-center gap-3 active:opacity-70">
        <View className="flex-1">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            {coach.full_name?.trim() || 'Coach'}
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {totals.classes} {totals.classes === 1 ? 'class' : 'classes'} ·{' '}
            {formatMoney(totals.cents, currency)}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.ink3}
        />
      </Pressable>

      {expanded ? (
        <View className="gap-3 pt-1">
          {classTypes.length === 0 ? (
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs italic">
              Add a class type before setting rates.
            </Text>
          ) : (
            <View className="gap-2">
              {classTypes.map((ct) => (
                <ClassTypeRateEditor
                  key={ct.id}
                  classType={ct}
                  gymId={gymId}
                  coachId={coach.profile_id}
                  existingCents={rateByCt.get(ct.id) ?? null}
                  currency={currency}
                  earningsRow={
                    earnings.data?.find((e) => e.class_type_id === ct.id) ??
                    null
                  }
                  onSaved={() => {
                    queryClient.invalidateQueries({
                      queryKey: ['coach-pay-rates'],
                    });
                    queryClient.invalidateQueries({
                      queryKey: ['coach-earnings'],
                    });
                  }}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ClassTypeRateEditor({
  classType,
  gymId,
  coachId,
  existingCents,
  currency,
  earningsRow,
  onSaved,
}: {
  classType: ClassTypeRow;
  gymId: string;
  coachId: string;
  existingCents: number | null;
  currency: string;
  earningsRow: EarningsRow | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(
    existingCents != null ? centsToRateInput(existingCents) : '',
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const cents = parseRateToCents(draft);
      if (cents == null) throw new Error('Enter a non-negative number');
      if (existingCents == null) {
        const { error } = await supabase.from('coach_pay_rates').insert({
          gym_id: gymId,
          profile_id: coachId,
          class_type_id: classType.id,
          per_class_cents: cents,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('coach_pay_rates')
          .update({ per_class_cents: cents, updated_at: new Date().toISOString() })
          .eq('gym_id', gymId)
          .eq('profile_id', coachId)
          .eq('class_type_id', classType.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setError(null);
      setEditing(false);
      onSaved();
    },
    onError: (e) => setError(errorMessage(e, 'Could not save rate')),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('coach_pay_rates')
        .delete()
        .eq('gym_id', gymId)
        .eq('profile_id', coachId)
        .eq('class_type_id', classType.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft('');
      setEditing(false);
      onSaved();
    },
    onError: (e) => setError(errorMessage(e, 'Could not remove rate')),
  });

  const classCount = earningsRow?.class_count ?? 0;
  const earned = earningsRow?.earnings_cents ?? 0;

  return (
    <View className="bg-raised dark:bg-raised-dk rounded-lg p-3 gap-2">
      <View className="flex-row items-center gap-2">
        <View
          style={{ backgroundColor: classType.color }}
          className="w-2 h-2 rounded-full"
        />
        <Text className="flex-1 text-ink dark:text-ink-dk font-medium text-sm" numberOfLines={1}>
          {classType.name}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {classCount} · {formatMoney(earned, currency)}
        </Text>
      </View>
      {editing ? (
        <View className="gap-2">
          <Input
            label={`Rate per class (${currency})`}
            value={draft}
            onChangeText={setDraft}
            placeholder="25.00"
            keyboardType="decimal-pad"
            inputMode="decimal"
          />
          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
          ) : null}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                variant="secondary"
                onPress={() => {
                  setEditing(false);
                  setDraft(
                    existingCents != null
                      ? centsToRateInput(existingCents)
                      : '',
                  );
                  setError(null);
                }}>
                Cancel
              </Button>
            </View>
            {existingCents != null ? (
              <View className="flex-1">
                <Button
                  variant="destructive"
                  onPress={() => remove.mutate()}
                  loading={remove.isPending}>
                  Remove
                </Button>
              </View>
            ) : null}
            <View className="flex-1">
              <Button onPress={() => save.mutate()} loading={save.isPending}>
                Save
              </Button>
            </View>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setEditing(true)}
          className="flex-row items-center gap-2 active:opacity-70">
          <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-xs">
            {existingCents == null
              ? 'No rate set'
              : `${formatMoney(existingCents, currency)} per class`}
          </Text>
          <ChipButton
            label={existingCents == null ? 'Set' : 'Edit'}
            icon={existingCents == null ? 'add' : 'create-outline'}
          />
        </Pressable>
      )}
    </View>
  );
}
