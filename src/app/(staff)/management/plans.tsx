import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DurationField } from '@/components/DurationField';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
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

type ClassTypeLite = { id: string; name: string; color: string };

type EditablePlan = {
  serverId: string | null;
  localId: string;
  name: string;
  kind: PlanKind;
  creditCount: string;
  monthlyPrice: string;
  noticePeriodDays: string;
  // Empty classTypeIds + coverageMode 'all' = the plan covers every class
  // type (the plan_class_types allowlist is empty). 'specific' restricts
  // booking to the selected class types.
  coverageMode: 'all' | 'specific';
  classTypeIds: string[];
  serverClassTypeIds: string[];
  archivedAt: string | null;
  serverSnapshot: ServerPlan | null;
};

// Prices are stored in minor units (pence) but entered in pounds — nobody
// thinks in pence. Convert at the edges: pence -> pounds for display,
// pounds -> pence on save. centsToPounds drops a whole-pound ".00".
function centsToPounds(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}
function poundsToCents(pounds: string): number | null {
  const t = pounds.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function fromServer(p: ServerPlan, classTypeIds: string[]): EditablePlan {
  return {
    serverId: p.plan_id,
    localId: p.plan_id,
    name: p.name,
    kind: p.kind,
    creditCount: p.credit_count?.toString() ?? '',
    monthlyPrice: p.monthly_price_cents != null ? centsToPounds(p.monthly_price_cents) : '',
    noticePeriodDays: p.notice_period_days?.toString() ?? '',
    coverageMode: classTypeIds.length > 0 ? 'specific' : 'all',
    classTypeIds,
    serverClassTypeIds: classTypeIds,
    archivedAt: p.archived_at,
    serverSnapshot: p,
  };
}

function rowDiffers(r: EditablePlan): boolean {
  if (!r.serverSnapshot) return true;
  const s = r.serverSnapshot;
  const cc = r.creditCount.trim() === '' ? null : parseInt(r.creditCount, 10);
  const mpc = poundsToCents(r.monthlyPrice);
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

  const classTypes = useQuery({
    queryKey: ['plan-coverage-class-types', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<ClassTypeLite[]> => {
      const { data, error } = await supabase
        .from('class_types')
        .select('id, name, color')
        .eq('gym_id', membership!.gymId)
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as ClassTypeLite[];
    },
  });

  const coverage = useQuery({
    queryKey: ['plan-coverage', planIds.join(',')],
    enabled: planIds.length > 0,
    queryFn: async (): Promise<Map<string, string[]>> => {
      const { data, error } = await supabase
        .from('plan_class_types')
        .select('plan_id, class_type_id')
        .in('plan_id', planIds);
      if (error) throw error;
      const map = new Map<string, string[]>();
      for (const row of (data ?? []) as {
        plan_id: string;
        class_type_id: string;
      }[]) {
        const arr = map.get(row.plan_id) ?? [];
        arr.push(row.class_type_id);
        map.set(row.plan_id, arr);
      }
      return map;
    },
  });

  // Seed once plans land; re-seed when coverage resolves so existing rows
  // pick up their allowlist. Coverage defaults to 'all' until it loads, so
  // the editor renders without waiting on the second query.
  useEffect(() => {
    if (!plans.data) return;
    const cov = coverage.data ?? new Map<string, string[]>();
    setRows(plans.data.map((p) => fromServer(p, cov.get(p.plan_id) ?? [])));
  }, [plans.data, coverage.data]);

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
        const monthlyPriceCents = poundsToCents(r.monthlyPrice);
        const noticePeriodDays =
          r.noticePeriodDays.trim() === '' ? null : parseInt(r.noticePeriodDays, 10);
        if (r.kind !== 'unlimited' && (creditCount === null || isNaN(creditCount))) {
          throw new Error(`${name}: credit count required for ${r.kind}`);
        }
        if (r.kind === 'unlimited' && creditCount !== null) {
          throw new Error(`${name}: unlimited plans cannot have a credit count`);
        }
        if (r.monthlyPrice.trim() !== '' && monthlyPriceCents === null) {
          throw new Error(`${name}: invalid price`);
        }
        if (noticePeriodDays !== null && (isNaN(noticePeriodDays) || noticePeriodDays < 0)) {
          throw new Error(`${name}: invalid notice period`);
        }

        const desiredCoverage =
          r.coverageMode === 'specific' ? r.classTypeIds : [];
        if (r.coverageMode === 'specific' && desiredCoverage.length === 0) {
          throw new Error(
            `${name}: pick at least one class type, or choose All classes`,
          );
        }

        let planId = r.serverId;
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
          const { data: inserted, error } = await supabase
            .from('membership_plans')
            .insert(payload)
            .select('plan_id')
            .single();
          if (error) throw error;
          planId = (inserted as { plan_id: string }).plan_id;
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

        // Reconcile the class-type allowlist (same owner gate as the plan
        // write). Empty desired set = covers all classes.
        if (planId) {
          const pid = planId;
          const desiredSet = new Set(desiredCoverage);
          const currentSet = new Set(r.serverClassTypeIds);
          const toRemove = r.serverClassTypeIds.filter(
            (id) => !desiredSet.has(id),
          );
          const toAdd = desiredCoverage.filter((id) => !currentSet.has(id));
          if (toRemove.length > 0) {
            const { error } = await supabase
              .from('plan_class_types')
              .delete()
              .eq('plan_id', pid)
              .in('class_type_id', toRemove);
            if (error) throw error;
          }
          if (toAdd.length > 0) {
            const { error } = await supabase
              .from('plan_class_types')
              .insert(
                toAdd.map((class_type_id) => ({ plan_id: pid, class_type_id })),
              );
            if (error) throw error;
          }
        }
      }
    },
    onSuccess: () => {
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
      queryClient.invalidateQueries({ queryKey: ['plan-coverage'] });
    },
    onError: (e) => setSaveError(errorMessage(e, 'Save failed')),
  });

  if (canEdit === false) {
    return <Redirect href="/management" />;
  }

  function update(idx: number, patch: Partial<EditablePlan>) {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function toggleClassType(idx: number, id: string) {
    setRows((curr) =>
      curr.map((r, i) => {
        if (i !== idx) return r;
        const on = r.classTypeIds.includes(id);
        return {
          ...r,
          classTypeIds: on
            ? r.classTypeIds.filter((x) => x !== id)
            : [...r.classTypeIds, id],
        };
      }),
    );
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
        monthlyPrice: '',
        noticePeriodDays: '',
        coverageMode: 'all',
        classTypeIds: [],
        serverClassTypeIds: [],
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

        {activeRows.length === 0 ? (
          <EmptyState
            icon="pricetags-outline"
            title="No plans yet"
            description="Create your first plan to start selling memberships and taking bookings."
            actionLabel="Create your first plan"
            onAction={addRow}
          />
        ) : null}

        <View className="gap-3">
          {activeRows.map((r) => {
            const idx = rows.indexOf(r);
            const deletable = canHardDelete && !hasDeps(r.serverId);
            const editingExistingPrice =
              r.serverSnapshot &&
              r.monthlyPrice.trim() !==
                (r.serverSnapshot.monthly_price_cents != null
                  ? centsToPounds(r.serverSnapshot.monthly_price_cents)
                  : '');
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
                    label="Monthly price (£)"
                    value={r.monthlyPrice}
                    onChangeText={(v) => update(idx, { monthlyPrice: v })}
                    keyboardType="decimal-pad"
                    placeholder="50"
                  />
                  {editingExistingPrice ? (
                    <Text className="text-amber-600 dark:text-amber-400 text-xs">
                      This changes the price new subscribers pay. Existing
                      subscriptions keep the price they signed up at.
                    </Text>
                  ) : null}
                </View>
                {r.kind !== 'credit_pack' ? (
                  <DurationField
                    label="Notice period"
                    blurb="How much notice a member gives to cancel — drives their cancel-by date. Leave blank for none."
                    value={r.noticePeriodDays}
                    onChange={(v) => update(idx, { noticePeriodDays: v })}
                    base="days"
                    units={['days', 'weeks', 'months']}
                    placeholder="30"
                  />
                ) : null}

                <View className="gap-2">
                  <Text className="text-gray-700 dark:text-gray-200 text-sm">
                    Classes this plan covers
                  </Text>
                  <View className="flex-row gap-2">
                    {(['all', 'specific'] as const).map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => update(idx, { coverageMode: m })}
                        className={`px-3 py-1.5 rounded-md border ${
                          r.coverageMode === m
                            ? 'border-primary bg-primary/10'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}>
                        <Text
                          className={
                            r.coverageMode === m
                              ? 'text-primary text-xs uppercase tracking-widest'
                              : 'text-gray-500 dark:text-gray-400 text-xs uppercase tracking-widest'
                          }>
                          {m === 'all' ? 'All classes' : 'Specific classes'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {r.coverageMode === 'all' ? (
                    <Text className="text-gray-400 dark:text-gray-500 text-xs">
                      Members on this plan can book any class type.
                    </Text>
                  ) : (classTypes.data?.length ?? 0) === 0 ? (
                    <Text className="text-amber-600 dark:text-amber-400 text-xs">
                      No class types yet — add some under Class types first.
                    </Text>
                  ) : (
                    <View className="gap-1.5">
                      <View className="flex-row gap-2 flex-wrap">
                        {classTypes.data!.map((ct) => {
                          const on = r.classTypeIds.includes(ct.id);
                          return (
                            <Pressable
                              key={ct.id}
                              onPress={() => toggleClassType(idx, ct.id)}
                              className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border ${
                                on
                                  ? 'border-primary bg-primary/10'
                                  : 'border-gray-200 dark:border-gray-700'
                              }`}>
                              <View
                                style={{ backgroundColor: ct.color }}
                                className="w-2 h-2 rounded-full"
                              />
                              <Text
                                className={`text-xs ${
                                  on
                                    ? 'text-gray-900 dark:text-gray-50 font-medium'
                                    : 'text-gray-600 dark:text-gray-300'
                                }`}>
                                {ct.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text className="text-gray-400 dark:text-gray-500 text-xs">
                        When a member holds more than one eligible plan, they
                        choose which to use at booking.
                      </Text>
                    </View>
                  )}
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

        {activeRows.length > 0 ? (
          <Button variant="secondary" icon="add" onPress={addRow}>
            Add plan
          </Button>
        ) : null}

        {saveError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{saveError}</Text>
        ) : null}
        {actionError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{actionError}</Text>
        ) : null}

        {activeRows.length > 0 ? (
          <Button onPress={() => save.mutate()} loading={save.isPending}>
            Save changes
          </Button>
        ) : null}

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
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Manage" fallbackHref="/management" />
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
