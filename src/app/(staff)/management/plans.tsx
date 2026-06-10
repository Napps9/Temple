import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { useExportMembershipsCsv, exportErrorMessage } from '@/lib/csv-exports';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type PlanKind = 'unlimited' | 'credit_period' | 'credit_pack';

type ServerPlan = {
  plan_id: string;
  name: string;
  kind: PlanKind;
  credit_count: number | null;
  monthly_price_cents: number | null;
  notice_period_days: number | null;
  archived_at: string | null;
};

type EditablePlan = {
  serverId: string | null;
  localId: string;
  name: string;
  kind: PlanKind;
  creditCount: string;
  monthlyPriceCents: string;
  noticePeriodDays: string;
  archivedAt: string | null;
  serverSnapshot: ServerPlan | null;
};

function fromServer(p: ServerPlan): EditablePlan {
  return {
    serverId: p.plan_id,
    localId: p.plan_id,
    name: p.name,
    kind: p.kind,
    creditCount: p.credit_count?.toString() ?? '',
    monthlyPriceCents: p.monthly_price_cents?.toString() ?? '',
    noticePeriodDays: p.notice_period_days?.toString() ?? '',
    archivedAt: p.archived_at,
    serverSnapshot: p,
  };
}

function rowDiffers(r: EditablePlan): boolean {
  if (!r.serverSnapshot) return true;
  const s = r.serverSnapshot;
  const cc = r.creditCount.trim() === '' ? null : parseInt(r.creditCount, 10);
  const mpc =
    r.monthlyPriceCents.trim() === '' ? null : parseInt(r.monthlyPriceCents, 10);
  const npd =
    r.noticePeriodDays.trim() === '' ? null : parseInt(r.noticePeriodDays, 10);
  return (
    r.name.trim() !== s.name ||
    r.kind !== s.kind ||
    cc !== s.credit_count ||
    mpc !== s.monthly_price_cents ||
    npd !== s.notice_period_days
  );
}

export function PlansPanel() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditablePlan[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canEdit = useCan('can_manage_plans');
  const canArchive = useCan('can_archive_plans') ?? false;
  const canHardDelete = useCan('can_hard_delete') ?? false;
  const canExport = useCan('can_export_members') ?? false;
  const exportMemberships = useExportMembershipsCsv();

  const plans = useQuery({
    queryKey: ['membership-plans', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select(
          'plan_id, name, kind, credit_count, monthly_price_cents, notice_period_days, archived_at',
        )
        .order('name');
      if (error) throw error;
      return data as ServerPlan[];
    },
  });

  const planIds = useMemo(() => plans.data?.map((p) => p.plan_id) ?? [], [plans.data]);

  const dependents = useQuery({
    queryKey: ['plan-dependents', planIds.join(',')],
    enabled: planIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        planIds.map((id) => supabase.rpc('plan_has_dependents', { p_id: id })),
      );
      const map = new Map<string, boolean>();
      planIds.forEach((id, i) => map.set(id, !!results[i].data));
      return map;
    },
  });

  useEffect(() => {
    if (!plans.data) return;
    setRows(plans.data.map(fromServer));
  }, [plans.data]);

  const archive = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc('archive_plan', { p_plan_id: planId });
      if (error) throw error;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
    },
    onError: (e) => setActionError(errorMessage(e, 'Could not archive plan')),
  });

  const restore = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc('restore_plan', { p_plan_id: planId });
      if (error) throw error;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
    },
    onError: (e) => setActionError(errorMessage(e, 'Could not restore plan')),
  });

  const hardDelete = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc('delete_plan', { p_plan_id: planId });
      if (error) throw error;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
    },
    onError: (e) => setActionError(errorMessage(e, 'Could not delete plan')),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      for (const r of rows) {
        if (r.archivedAt) continue;
        const name = r.name.trim();
        if (!name) throw new Error('Each plan needs a name');
        const creditCount =
          r.creditCount.trim() === '' ? null : parseInt(r.creditCount, 10);
        const monthlyPriceCents =
          r.monthlyPriceCents.trim() === '' ? null : parseInt(r.monthlyPriceCents, 10);
        const noticePeriodDays =
          r.noticePeriodDays.trim() === '' ? null : parseInt(r.noticePeriodDays, 10);
        if (r.kind !== 'unlimited' && (creditCount === null || isNaN(creditCount))) {
          throw new Error(`${name}: credit count required for ${r.kind}`);
        }
        if (r.kind === 'unlimited' && creditCount !== null) {
          throw new Error(`${name}: unlimited plans cannot have a credit count`);
        }
        if (monthlyPriceCents !== null && isNaN(monthlyPriceCents)) {
          throw new Error(`${name}: invalid price`);
        }
        if (noticePeriodDays !== null && (isNaN(noticePeriodDays) || noticePeriodDays < 0)) {
          throw new Error(`${name}: invalid notice period`);
        }

        if (r.serverId === null) {
          const payload: {
            gym_id: string;
            name: string;
            kind: PlanKind;
            credit_count: number | null;
            monthly_price_cents: number | null;
            notice_period_days: number | null;
            period_length?: string;
          } = {
            gym_id: membership.gymId,
            name,
            kind: r.kind,
            credit_count: creditCount,
            monthly_price_cents: monthlyPriceCents,
            notice_period_days: noticePeriodDays,
          };
          if (r.kind === 'credit_period') {
            payload.period_length = '30 days';
          }
          const { error } = await supabase.from('membership_plans').insert(payload);
          if (error) throw error;
        } else if (rowDiffers(r)) {
          const { error } = await supabase
            .from('membership_plans')
            .update({
              name,
              kind: r.kind,
              credit_count: creditCount,
              monthly_price_cents: monthlyPriceCents,
              notice_period_days: noticePeriodDays,
            })
            .eq('plan_id', r.serverId);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
    },
    onError: (e) => setSaveError(errorMessage(e, 'Save failed')),
  });

  if (canEdit === false) {
    return <Redirect href="/management" />;
  }

  function update(idx: number, patch: Partial<EditablePlan>) {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows([
      ...rows,
      {
        serverId: null,
        localId: `new-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        kind: 'unlimited',
        creditCount: '',
        monthlyPriceCents: '',
        noticePeriodDays: '',
        archivedAt: null,
        serverSnapshot: null,
      },
    ]);
  }

  function hasDeps(id: string | null): boolean {
    if (!id) return false;
    return dependents.data?.get(id) ?? true;
  }

  const activeRows = rows.filter((r) => !r.archivedAt);
  const archivedRows = rows.filter((r) => !!r.archivedAt);

  return (
    <View className="gap-4">
        {canExport ? (
          <View className="gap-2">
            <ChipButton
              className="self-start"
              label={exportMemberships.isPending ? 'Exporting…' : 'Export memberships CSV'}
              icon="download-outline"
              tone="neutral"
              onPress={() => exportMemberships.mutate()}
              disabled={exportMemberships.isPending}
            />
            {exportMemberships.error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">
                {exportErrorMessage(exportMemberships.error, 'memberships')}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="gap-3">
          {activeRows.length === 0 ? (
            <Text className="text-gray-500 dark:text-gray-400">
              No plans yet — add one below.
            </Text>
          ) : null}
          {activeRows.map((r) => {
            const idx = rows.indexOf(r);
            const deletable = canHardDelete && !hasDeps(r.serverId);
            const editingExistingPrice =
              r.serverSnapshot &&
              r.monthlyPriceCents.trim() !==
                (r.serverSnapshot.monthly_price_cents?.toString() ?? '');
            const editingExistingCredits =
              r.serverSnapshot &&
              r.creditCount.trim() !==
                (r.serverSnapshot.credit_count?.toString() ?? '');
            return (
              <View
                key={r.localId}
                className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
                <Input
                  label="Name"
                  value={r.name}
                  onChangeText={(v) => update(idx, { name: v })}
                  placeholder="Unlimited monthly"
                />
                <View className="gap-1">
                  <Text className="text-gray-700 dark:text-gray-200 text-sm">Kind</Text>
                  <View className="flex-row gap-2 flex-wrap">
                    {(['unlimited', 'credit_period', 'credit_pack'] as PlanKind[]).map(
                      (k) => (
                        <Pressable
                          key={k}
                          onPress={() => update(idx, { kind: k })}
                          className={`px-3 py-1.5 rounded-md border ${
                            r.kind === k
                              ? 'border-primary bg-primary/10'
                              : 'border-gray-200 dark:border-gray-700'
                          }`}>
                          <Text
                            className={
                              r.kind === k
                                ? 'text-primary text-xs uppercase tracking-widest'
                                : 'text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest'
                            }>
                            {k.replace('_', ' ')}
                          </Text>
                        </Pressable>
                      ),
                    )}
                  </View>
                </View>
                {r.kind !== 'unlimited' ? (
                  <View className="gap-1">
                    <Input
                      label="Credits per period"
                      value={r.creditCount}
                      onChangeText={(v) => update(idx, { creditCount: v })}
                      keyboardType="number-pad"
                      placeholder="10"
                    />
                    {editingExistingCredits ? (
                      <Text className="text-amber-600 dark:text-amber-400 text-xs">
                        This changes how many credits new subscribers receive.
                        Existing subs are not retroactively re-entitled.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                <View className="gap-1">
                  <Input
                    label="Monthly price (pence)"
                    value={r.monthlyPriceCents}
                    onChangeText={(v) => update(idx, { monthlyPriceCents: v })}
                    keyboardType="number-pad"
                    placeholder="5000"
                  />
                  {editingExistingPrice ? (
                    <Text className="text-amber-600 dark:text-amber-400 text-xs">
                      This changes the price new subscribers pay. Existing
                      subscriptions keep the price they signed up at.
                    </Text>
                  ) : null}
                </View>
                <View className="gap-1">
                  <Input
                    label="Notice period (days)"
                    value={r.noticePeriodDays}
                    onChangeText={(v) => update(idx, { noticePeriodDays: v })}
                    keyboardType="number-pad"
                    placeholder="30"
                  />
                  <Text className="text-gray-400 dark:text-gray-500 text-xs">
                    Shown on member profiles so staff can answer
                    cancellation questions. Leave blank for no notice.
                  </Text>
                </View>

                {r.serverId && canArchive ? (
                  <View className="flex-row gap-2 justify-end flex-wrap">
                    <ActionButton
                      kind="archive"
                      label="Archive"
                      onPress={() => archive.mutate(r.serverId!)}
                    />
                    {canHardDelete ? (
                      <ActionButton
                        kind="delete"
                        label="Delete permanently"
                        disabled={!deletable || hardDelete.isPending}
                        disabledLabel="Cannot delete — has subscriptions"
                        onPress={() => hardDelete.mutate(r.serverId!)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <ChipButton
          className="self-start"
          label="Add plan"
          icon="add"
          onPress={addRow}
        />

        {saveError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{saveError}</Text>
        ) : null}
        {actionError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{actionError}</Text>
        ) : null}

        <Button onPress={() => save.mutate()} loading={save.isPending}>
          Save changes
        </Button>

        {archivedRows.length > 0 ? (
          <View className="gap-2">
            <Pressable
              onPress={() => setShowArchived(!showArchived)}
              className="flex-row items-center gap-2 self-start py-1">
              <Ionicons
                name={showArchived ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color="#6B7280"
              />
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                Archived ({archivedRows.length})
              </Text>
            </Pressable>
            {showArchived
              ? archivedRows.map((r) => {
                  const deletable = canHardDelete && !hasDeps(r.serverId);
                  return (
                    <View
                      key={r.localId}
                      className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 gap-2">
                      <Text className="text-gray-700 dark:text-gray-200">{r.name}</Text>
                      {canArchive ? (
                        <View className="flex-row gap-2 justify-end flex-wrap">
                          <ActionButton
                            kind="restore"
                            label="Restore"
                            onPress={() => restore.mutate(r.serverId!)}
                          />
                          {canHardDelete ? (
                            <ActionButton
                              kind="delete"
                              label="Delete permanently"
                              disabled={!deletable || hardDelete.isPending}
                              disabledLabel="Cannot delete — has subscriptions"
                              onPress={() => hardDelete.mutate(r.serverId!)}
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              : null}
          </View>
        ) : null}
    </View>
  );
}

export default function PlansScreen() {
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Plans
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Define your membership plans. Existing subscribers keep the price
            and credits they signed up with — editing a plan only changes what
            new subscribers get.
          </Text>
        </View>
        <PlansPanel />
      </ScrollView>
    </Screen>
  );
}
