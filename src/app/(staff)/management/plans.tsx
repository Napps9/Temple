import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { ActionButton } from '@/components/ActionButton';
import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { DurationField } from '@/components/DurationField';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { PageHead } from '@/components/PageHead';
import { useGymMembership } from '@/lib/auth';
import { useExportMembershipsCsv, exportErrorMessage } from '@/lib/csv-exports';
import { errorMessage } from '@/lib/errors';
import { fetchStripeHealth, stripeHealthQueryKey } from '@/lib/stripe-health';
import { supabase } from '@/lib/supabase';
import { currencySymbol } from '@/lib/setup-flow';
import { planKindLabel, planPriceLabel } from '@/lib/subscriptions';
import { useGymCurrency } from '@/lib/useGymCurrency';
import { useSetupAutoReturn } from '@/lib/useSetupAutoReturn';
import { useCan } from '@/lib/useCan';
import { useThemeColors } from '@/lib/theme';

type PlanKind = 'unlimited' | 'credit_period' | 'credit_pack' | 'programming_only';

type ServerPlan = {
  plan_id: string;
  name: string;
  kind: PlanKind;
  credit_count: number | null;
  monthly_price_cents: number | null;
  notice_period_days: number | null;
  includes_individual_programming: boolean;
  archived_at: string | null;
};

type ClassTypeLite = { id: string; name: string; color: string };

type EditablePlan = {
  serverId: string | null;
  localId: string;
  // Bumped on every "Undo changes" reset so a stale DurationField (which
  // stops following prop updates once the user has typed into it) can be
  // forced to remount and re-seed from the restored value.
  resetNonce: number;
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
  includesProgramming: boolean;
  archivedAt: string | null;
  serverSnapshot: ServerPlan | null;
};

// programming_only sells nothing but individual programming, so the
// flag is implied; other kinds carry the checkbox's value.
function effectiveIncludesProgramming(r: EditablePlan): boolean {
  return r.kind === 'programming_only' ? true : r.includesProgramming;
}

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

// Turn a plan-write DB error into something the owner can act on. A
// unique-violation on the name index (0131) means another active plan
// already carries that name.
function planWriteError(
  error: { code?: string; message?: string },
  name: string,
): Error {
  if (
    error.code === '23505' &&
    (error.message ?? '').includes('membership_plans_gym_name_unique')
  ) {
    return new Error(
      `A plan named “${name}” already exists. Pick a different name, or archive the other one.`,
    );
  }
  return new Error(error.message ?? 'Save failed');
}

function fromServer(
  p: ServerPlan,
  classTypeIds: string[],
  resetNonce = 0,
): EditablePlan {
  return {
    serverId: p.plan_id,
    localId: p.plan_id,
    resetNonce,
    name: p.name,
    kind: p.kind,
    creditCount: p.credit_count?.toString() ?? '',
    monthlyPrice: p.monthly_price_cents != null ? centsToPounds(p.monthly_price_cents) : '',
    noticePeriodDays: p.notice_period_days?.toString() ?? '',
    coverageMode: classTypeIds.length > 0 ? 'specific' : 'all',
    classTypeIds,
    serverClassTypeIds: classTypeIds,
    includesProgramming: p.includes_individual_programming,
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
    npd !== s.notice_period_days ||
    effectiveIncludesProgramming(r) !== s.includes_individual_programming
  );
}

// rowDiffers only covers the plan's own columns — coverage lives in a
// separate join table, so a coverage-only edit (e.g. switching to
// Specific classes) needs its own comparison to count as dirty.
function coverageDiffers(r: EditablePlan): boolean {
  const desired =
    r.kind === 'programming_only'
      ? []
      : r.coverageMode === 'specific'
        ? r.classTypeIds
        : [];
  const desiredSet = new Set(desired);
  const currentSet = new Set(r.serverClassTypeIds);
  if (desiredSet.size !== currentSet.size) return true;
  for (const id of desiredSet) {
    if (!currentSet.has(id)) return true;
  }
  return false;
}

// Unsaved work, across unmounts: the hub swaps this panel out on every
// tab switch and search, and a half-typed plan died with it. Only rows
// open in the editor are kept — a closed card has nothing unsaved — so
// pristine rows still reseed from the server on every mount and archive,
// restore and delete stay exactly as fresh as before. Session-only and
// keyed by gym so a gym switch cannot leak drafts; the GymSetupChecklist
// / list-scroll-position idiom.
const unsavedByGym = new Map<
  string,
  { rows: EditablePlan[]; editingIds: Set<string> }
>();

export function PlansPanel() {
  const colors = useThemeColors();
  const currency = useGymCurrency();
  const { backTo } = useLocalSearchParams<{ backTo?: string }>();
  // Opened mid-setup, the two hops out of here stay inside setup — and
  // return to whichever of the two setup surfaces sent the owner in.
  const carryBackTo =
    backTo === 'setup' || backTo === 'checklist' ? `?backTo=${backTo}` : '';
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditablePlan[]>([]);
  const [showArchived, setShowArchivedState] = useState(lastShowArchived);
  const setShowArchived = (v: boolean) => {
    lastShowArchived = v;
    setShowArchivedState(v);
  };
  const [actionError, setActionError] = useState<string | null>(null);
  // Plans render collapsed (a member-style summary) until the staff member
  // opens one for editing. New plans open straight into the editor.
  const [editingIds, setEditingIds] = useState<Set<string>>(() => new Set());
  // Per-plan save errors and success flashes, keyed by localId, so each
  // card reports its own outcome instead of one message for the page.
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [savedLocalId, setSavedLocalId] = useState<string | null>(null);
  useEffect(() => {
    if (!savedLocalId) return;
    const id = setTimeout(() => setSavedLocalId(null), 2500);
    return () => clearTimeout(id);
  }, [savedLocalId]);

  const canEdit = useCan('can_manage_plans');
  const canArchive = useCan('can_archive_plans') ?? false;
  const canHardDelete = useCan('can_hard_delete') ?? false;
  const canExport = useCan('can_export_members') ?? false;
  const exportMemberships = useExportMembershipsCsv();

  // Plans can only be sold once the gym has connected Stripe — members
  // are charged on the gym's own connected account. Null while loading;
  // we only gate creation once we know the answer is "not connected".
  const stripeAccount = useQuery({
    queryKey: ['gym-stripe-account', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('gym_stripe_accounts')
        .select('stripe_account_id')
        .eq('gym_id', membership!.gymId)
        .maybeSingle();
      if (error) throw error;
      return !!data?.stripe_account_id;
    },
  });

  // Only a positively-verified-healthy connection lets you create plans that
  // can actually charge. A row existing isn't enough — it can be revoked or
  // point at an unreachable account. We stay optimistic while the check
  // loads or errors, so a transient blip never blocks plan management beyond
  // the old row-based gate; we only block when Stripe positively says the
  // connection is broken.
  const stripeHealth = useQuery({
    queryKey: stripeHealthQueryKey(membership?.gymId),
    enabled: !!membership?.gymId && stripeAccount.data === true,
    staleTime: 60_000,
    queryFn: () => fetchStripeHealth(membership!.gymId),
  });

  const stripeGate: 'loading' | 'unconnected' | 'attention' | 'ready' =
    stripeAccount.isLoading
      ? 'loading'
      : stripeAccount.data !== true
        ? 'unconnected'
        : stripeHealth.isLoading
          ? 'loading'
          : !stripeHealth.data || !stripeHealth.data.connected
            ? 'ready'
            : stripeHealth.data.reachable && stripeHealth.data.chargesEnabled
              ? 'ready'
              : 'attention';
  const canCreate = stripeGate === 'ready';

  const plans = useQuery({
    queryKey: ['membership-plans', membership?.gymId],
    enabled: !!membership?.gymId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select(
          'plan_id, name, kind, credit_count, monthly_price_cents, notice_period_days, includes_individual_programming, archived_at',
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

  // Seed once plans + coverage have both landed, and never again: each
  // plan now saves independently, and re-seeding from every refetch this
  // triggers would blow away whatever the user is mid-typing in any other
  // still-unsaved card. Waiting on coverage.isLoading (rather than
  // coverage.data itself) means the first seed already carries the
  // allowlist instead of defaulting to 'all' and never catching up.
  //
  // Seeded state (not a ref) so the write-through effect below can tell
  // the pre-seed render apart and not wipe the cache it is about to eat.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded) return;
    if (!membership?.gymId) return;
    if (!plans.data) return;
    if (coverage.isLoading) return;
    const cov = coverage.data ?? new Map<string, string[]>();
    const fresh = plans.data.map((p) => fromServer(p, cov.get(p.plan_id) ?? []));
    const cached = unsavedByGym.get(membership.gymId);
    if (!cached) {
      setRows(fresh);
      setSeeded(true);
      return;
    }
    // Overlay the cached drafts: an edit of an existing plan replaces its
    // fresh row (a draft of a plan deleted elsewhere is dropped with it);
    // never-saved new cards go back on top, where addRow put them.
    const drafts = new Map(
      cached.rows.filter((r) => r.serverId !== null).map((r) => [r.serverId!, r]),
    );
    const merged = fresh.map((r) => drafts.get(r.serverId!) ?? r);
    const newRows = cached.rows.filter((r) => r.serverId === null);
    const rowsNext = [...newRows, ...merged];
    const present = new Set(rowsNext.map((r) => r.localId));
    setRows(rowsNext);
    setEditingIds(new Set([...cached.editingIds].filter((id) => present.has(id))));
    setSeeded(true);
  }, [seeded, membership?.gymId, plans.data, coverage.data, coverage.isLoading]);

  useEffect(() => {
    if (!seeded || !membership?.gymId) return;
    const kept = rows.filter((r) => editingIds.has(r.localId));
    if (kept.length === 0) unsavedByGym.delete(membership.gymId);
    else unsavedByGym.set(membership.gymId, { rows: kept, editingIds: new Set(editingIds) });
  }, [seeded, membership?.gymId, rows, editingIds]);

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

  // Saves exactly the one plan card that called it — each card owns its
  // own dirty state, Save button and error message now, rather than one
  // shared submit for every row on the page.
  const save = useMutation({
    mutationFn: async (r: EditablePlan) => {
      if (!membership) throw new Error('No gym');
      const name = r.name.trim();
      if (!name) throw new Error('This plan needs a name');
      const creditCount =
        r.creditCount.trim() === '' ? null : parseInt(r.creditCount, 10);
      const monthlyPriceCents = poundsToCents(r.monthlyPrice);
      const noticePeriodDays =
        r.noticePeriodDays.trim() === '' ? null : parseInt(r.noticePeriodDays, 10);
      const creditKind = r.kind === 'credit_period' || r.kind === 'credit_pack';
      if (creditKind && (creditCount === null || isNaN(creditCount))) {
        throw new Error(`Credit count required for ${r.kind}`);
      }
      if (!creditKind && creditCount !== null) {
        throw new Error('This plan kind cannot have a credit count');
      }
      if (r.monthlyPrice.trim() !== '' && monthlyPriceCents === null) {
        throw new Error('Invalid price');
      }
      if (noticePeriodDays !== null && (isNaN(noticePeriodDays) || noticePeriodDays < 0)) {
        throw new Error('Invalid notice period');
      }

      // A programming-only plan books nothing, so it carries no
      // class-type allowlist regardless of what the editor held
      // before the kind switch.
      const desiredCoverage =
        r.kind === 'programming_only'
          ? []
          : r.coverageMode === 'specific'
            ? r.classTypeIds
            : [];
      if (
        r.kind !== 'programming_only' &&
        r.coverageMode === 'specific' &&
        desiredCoverage.length === 0
      ) {
        throw new Error('Pick at least one class type, or choose All classes');
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
          includes_individual_programming: boolean;
          period_length?: string;
        } = {
          gym_id: membership.gymId,
          name,
          kind: r.kind,
          credit_count: creditCount,
          monthly_price_cents: monthlyPriceCents,
          notice_period_days: noticePeriodDays,
          includes_individual_programming: effectiveIncludesProgramming(r),
        };
        if (r.kind === 'credit_period') {
          payload.period_length = '30 days';
        }
        const { data: inserted, error } = await supabase
          .from('membership_plans')
          .insert(payload)
          .select('plan_id')
          .single();
        if (error) throw planWriteError(error, name);
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
            includes_individual_programming: effectiveIncludesProgramming(r),
            period_length: r.kind === 'credit_period' ? '30 days' : null,
          })
          .eq('plan_id', r.serverId);
        if (error) throw planWriteError(error, name);
      }

      // Reconcile the class-type allowlist (same owner gate as the plan
      // write). Empty desired set = covers all classes.
      if (planId) {
        const pid = planId;
        const desiredSet = new Set(desiredCoverage);
        const currentSet = new Set(r.serverClassTypeIds);
        const toRemove = r.serverClassTypeIds.filter((id) => !desiredSet.has(id));
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
            .insert(toAdd.map((class_type_id) => ({ plan_id: pid, class_type_id })));
          if (error) throw error;
        }
      }

      const snapshot: ServerPlan = {
        plan_id: planId!,
        name,
        kind: r.kind,
        credit_count: creditCount,
        monthly_price_cents: monthlyPriceCents,
        notice_period_days: noticePeriodDays,
        includes_individual_programming: effectiveIncludesProgramming(r),
        archived_at: r.archivedAt,
      };
      return { localId: r.localId, snapshot, desiredCoverage };
    },
    onSuccess: ({ localId, snapshot, desiredCoverage }) => {
      setSaveErrors((curr) => {
        if (!(localId in curr)) return curr;
        const next = { ...curr };
        delete next[localId];
        return next;
      });
      setSavedLocalId(localId);
      endEdit(localId);
      // Patch just this row locally instead of re-seeding from a refetch —
      // a refetch-driven reseed would also overwrite any other card's
      // still-unsaved edits.
      setRows((curr) =>
        curr.map((row) =>
          row.localId === localId
            ? {
                ...row,
                serverId: snapshot.plan_id,
                serverSnapshot: snapshot,
                serverClassTypeIds: desiredCoverage,
              }
            : row,
        ),
      );
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
      queryClient.invalidateQueries({ queryKey: ['gym-setup-progress'] });
    },
    onError: (e, r) => {
      setSaveErrors((curr) => ({ ...curr, [r.localId]: errorMessage(e, 'Save failed') }));
    },
  });

  if (canEdit === false) {
    return <Redirect href="/management" />;
  }

  function beginEdit(localId: string) {
    setEditingIds((curr) => new Set(curr).add(localId));
  }

  function endEdit(localId: string) {
    setEditingIds((curr) => {
      if (!curr.has(localId)) return curr;
      const next = new Set(curr);
      next.delete(localId);
      return next;
    });
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

  // New plans land right under the "Add plan" CTA, not at the bottom of
  // whatever list of existing plans the gym already has, and open straight
  // into the editor since a blank card has nothing to summarise.
  function addRow() {
    const localId = `new-${Math.random().toString(36).slice(2, 8)}`;
    setRows((curr) => [
      {
        serverId: null,
        localId,
        resetNonce: 0,
        name: '',
        kind: 'unlimited',
        creditCount: '',
        monthlyPrice: '',
        noticePeriodDays: '',
        coverageMode: 'all',
        classTypeIds: [],
        serverClassTypeIds: [],
        includesProgramming: false,
        archivedAt: null,
        serverSnapshot: null,
      },
      ...curr,
    ]);
    beginEdit(localId);
  }

  // A brand-new, never-saved card is discarded outright; an existing plan
  // reverts its editable fields back to its last-saved snapshot.
  function undoRow(target: EditablePlan) {
    setSaveErrors((curr) => {
      if (!(target.localId in curr)) return curr;
      const next = { ...curr };
      delete next[target.localId];
      return next;
    });
    endEdit(target.localId);
    if (target.serverId === null) {
      setRows((curr) => curr.filter((r) => r.localId !== target.localId));
      return;
    }
    if (!target.serverSnapshot) return;
    const clean = fromServer(
      target.serverSnapshot,
      target.serverClassTypeIds,
      target.resetNonce + 1,
    );
    setRows((curr) =>
      curr.map((r) => (r.localId === target.localId ? clean : r)),
    );
  }

  function hasDeps(id: string | null): boolean {
    if (!id) return false;
    return dependents.data?.get(id) ?? true;
  }

  const activeRows = rows.filter((r) => !r.archivedAt);
  const archivedRows = rows.filter((r) => !!r.archivedAt);

  return (
    <View className="gap-4">
        {stripeGate === 'unconnected' || stripeGate === 'attention' ? (
          <View className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-card p-4 gap-3">
            <View className="flex-row items-center gap-2">
              <Ionicons name="card-outline" size={18} color="#D97706" />
              <Text className="flex-1 text-amber-800 dark:text-amber-200 font-semibold">
                {stripeGate === 'attention'
                  ? 'Your Stripe connection needs attention'
                  : 'Connect Stripe to sell memberships'}
              </Text>
            </View>
            <Text className="text-amber-700 dark:text-amber-300 text-sm">
              {stripeGate === 'attention'
                ? "Members are charged on your own Stripe account, but yours can't take payments right now. Fix it in Billing before creating plans — you can still edit existing plans below."
                : 'Members are charged on your own Stripe account, so you need to connect it before creating plans. You can still edit existing plans below.'}
            </Text>
            <Button
              variant="secondary"
              icon="link-outline"
              onPress={() =>
                router.push(`/management/billing${carryBackTo}` as never)
              }>
              {stripeGate === 'attention' ? 'Fix in Billing' : 'Connect Stripe'}
            </Button>
          </View>
        ) : null}

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

        {canCreate ? (
          <ChipButton
            className="self-start"
            label="Import plans & members from Stripe"
            icon="cloud-download-outline"
            tone="primary"
            onPress={() =>
              router.push(`/management/members/import-stripe${carryBackTo}` as never)
            }
          />
        ) : null}

        {activeRows.length === 0 &&
        stripeGate !== 'unconnected' &&
        stripeGate !== 'attention' ? (
          <EmptyState
            icon="pricetags-outline"
            title="No plans yet"
            description="Create your first plan to start selling memberships and taking bookings."
            actionLabel="Create your first plan"
            onAction={addRow}
          />
        ) : null}

        {activeRows.length > 0 && canCreate ? (
          <Button variant="secondary" icon="add" onPress={addRow}>
            Add plan
          </Button>
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
            const dirty =
              r.serverId === null || rowDiffers(r) || coverageDiffers(r);
            const rowSaving = save.isPending && save.variables?.localId === r.localId;
            const rowError = saveErrors[r.localId];
            const rowSaved = savedLocalId === r.localId;

            // Collapsed by default: a read-only summary that mirrors the
            // member-facing plan card, until the staff member taps Edit.
            if (!editingIds.has(r.localId) && r.serverSnapshot) {
              const snap = r.serverSnapshot;
              return (
                <Pressable
                  key={r.localId}
                  onPress={() => beginEdit(r.localId)}
                  className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3 active:opacity-70">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-ink dark:text-ink-dk font-semibold text-base">
                        {snap.name}
                      </Text>
                      <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                        {planKindLabel(snap)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-ink dark:text-ink-dk font-semibold text-base">
                        {planPriceLabel(snap, currency)}
                      </Text>
                      {snap.notice_period_days ? (
                        <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                          {snap.notice_period_days}-day notice
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {/* Ink, not the accent: every plan card carries this
                      chip, and a column of accent Edits reads as a loud
                      list rather than an invitation. */}
                  <View className="flex-row items-center gap-1.5 self-start">
                    <Ionicons name="create-outline" size={15} color={colors.ink2} />
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                      Edit
                    </Text>
                  </View>
                </Pressable>
              );
            }
            return (
              <View
                key={r.localId}
                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
                <Input
                  label="Name"
                  value={r.name}
                  onChangeText={(v) => update(idx, { name: v })}
                  placeholder="Unlimited monthly"
                />
                <View className="gap-1">
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">Type</Text>
                  <View className="flex-row gap-2 flex-wrap">
                    {(
                      [
                        { key: 'membership', label: 'Membership' },
                        { key: 'session_pack', label: 'Session pack' },
                        { key: 'programming', label: 'Individual programming' },
                      ] as const
                    ).map((t) => {
                      const active =
                        t.key === 'session_pack'
                          ? r.kind === 'credit_pack'
                          : t.key === 'programming'
                            ? r.kind === 'programming_only'
                            : r.kind === 'unlimited' || r.kind === 'credit_period';
                      return (
                        <Pressable
                          key={t.key}
                          onPress={() => {
                            if (active) return;
                            update(idx, {
                              kind:
                                t.key === 'session_pack'
                                  ? 'credit_pack'
                                  : t.key === 'programming'
                                    ? 'programming_only'
                                    : 'unlimited',
                            });
                          }}
                          className={`px-3 py-1.5 rounded-md border ${
                            active
                              ? 'border-transparent bg-raised dark:bg-raised-dk'
                              : 'border-line dark:border-line-dk'
                          }`}>
                          <Text
                            className={
                              active
                                ? 'text-ink dark:text-ink-dk text-[11px] font-semibold uppercase tracking-[1px]'
                                : 'text-ink-2 dark:text-ink-2-dk text-xs uppercase tracking-widest'
                            }>
                            {t.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {r.kind === 'credit_pack' ? (
                    <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                      A fixed bundle of sessions. They don&apos;t expire.
                    </Text>
                  ) : null}
                  {r.kind === 'programming_only' ? (
                    <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                      A personal-training style membership: the member gets the
                      individual programming a coach writes for them. It does
                      not book classes.
                    </Text>
                  ) : null}
                </View>
                {r.kind !== 'credit_pack' && r.kind !== 'programming_only' ? (
                  <View className="gap-1">
                    <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                      Membership type
                    </Text>
                    <View className="flex-row gap-2 flex-wrap">
                      {(
                        [
                          { key: 'unlimited' as const, label: 'Unlimited' },
                          {
                            key: 'credit_period' as const,
                            label: 'Limited per period',
                          },
                        ]
                      ).map((t) => (
                        <Pressable
                          key={t.key}
                          onPress={() => update(idx, { kind: t.key })}
                          className={`px-3 py-1.5 rounded-md border ${
                            r.kind === t.key
                              ? 'border-transparent bg-raised dark:bg-raised-dk'
                              : 'border-line dark:border-line-dk'
                          }`}>
                          <Text
                            className={
                              r.kind === t.key
                                ? 'text-ink dark:text-ink-dk text-[11px] font-semibold uppercase tracking-[1px]'
                                : 'text-ink-2 dark:text-ink-2-dk text-xs uppercase tracking-widest'
                            }>
                            {t.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
                {r.kind === 'credit_period' || r.kind === 'credit_pack' ? (
                  <View className="gap-1">
                    <Input
                      label={
                        r.kind === 'credit_pack'
                          ? 'Number of sessions'
                          : 'Classes per period'
                      }
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
                    label={`Monthly price (${currencySymbol(currency)})`}
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
                    key={`${r.localId}:${r.resetNonce}`}
                    label="Notice period"
                    blurb="How much notice a member gives to cancel — drives their cancel-by date. Leave blank for none."
                    value={r.noticePeriodDays}
                    onChange={(v) => update(idx, { noticePeriodDays: v })}
                    base="days"
                    units={['days', 'weeks', 'months']}
                    placeholder="30"
                  />
                ) : null}

                {r.kind === 'programming_only' ? (
                  <View className="flex-row items-center gap-3">
                    <Ionicons name="checkbox" size={20} color={colors.primary} />
                    <View className="flex-1">
                      <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                        Includes individualized programming
                      </Text>
                      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                        Always on for this plan type — it&apos;s what the plan
                        sells.
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() =>
                      update(idx, { includesProgramming: !r.includesProgramming })
                    }
                    className="flex-row items-center gap-3 active:opacity-70">
                    <Ionicons
                      name={r.includesProgramming ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={r.includesProgramming ? colors.primary : colors.ink3}
                    />
                    <View className="flex-1">
                      <Text className="text-ink dark:text-ink-dk text-sm font-medium">
                        Includes individualized programming
                      </Text>
                      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                        Members on this plan can view any personal programme a
                        coach writes for them, without buying it separately.
                      </Text>
                    </View>
                  </Pressable>
                )}

                {r.kind === 'programming_only' ? null : (
                <View className="gap-2">
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                    Classes this plan covers
                  </Text>
                  <View className="flex-row gap-2">
                    {(['all', 'specific'] as const).map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => update(idx, { coverageMode: m })}
                        className={`px-3 py-1.5 rounded-md border ${
                          r.coverageMode === m
                            ? 'border-transparent bg-raised dark:bg-raised-dk'
                            : 'border-line dark:border-line-dk'
                        }`}>
                        <Text
                          className={
                            r.coverageMode === m
                              ? 'text-ink dark:text-ink-dk text-[11px] font-semibold uppercase tracking-[1px]'
                              : 'text-ink-2 dark:text-ink-2-dk text-xs uppercase tracking-widest'
                          }>
                          {m === 'all' ? 'All classes' : 'Specific classes'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {r.coverageMode === 'all' ? (
                    <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
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
                                  ? 'border-transparent bg-raised dark:bg-raised-dk'
                                  : 'border-line dark:border-line-dk'
                              }`}>
                              <View
                                style={{ backgroundColor: ct.color }}
                                className="w-2 h-2 rounded-full"
                              />
                              <Text
                                className={`text-xs ${
                                  on
                                    ? 'text-ink dark:text-ink-dk font-medium'
                                    : 'text-ink-2 dark:text-ink-2-dk'
                                }`}>
                                {ct.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                        When a member holds more than one eligible plan, they
                        choose which to use at booking.
                      </Text>
                    </View>
                  )}
                </View>
                )}

                {rowError ? (
                  <Text className="text-red-500 dark:text-red-400 text-sm">
                    {rowError}
                  </Text>
                ) : null}

                {dirty ? (
                  <View className="gap-2">
                    <Button
                      onPress={() => save.mutate(r)}
                      loading={rowSaving}
                      success={rowSaved}>
                      Save changes
                    </Button>
                    <ChipButton
                      className="self-start"
                      tone="neutral"
                      icon="arrow-undo-outline"
                      label={r.serverId === null ? 'Discard new plan' : 'Undo changes'}
                      onPress={() => undoRow(r)}
                      disabled={rowSaving}
                    />
                  </View>
                ) : null}

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

        {actionError ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{actionError}</Text>
        ) : null}

        {archivedRows.length > 0 ? (
          <View className="gap-2">
            <Pressable
              onPress={() => setShowArchived(!showArchived)}
              className="flex-row items-center gap-2 self-start py-1">
              <Ionicons
                name={showArchived ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color={colors.ink2}
              />
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                Archived ({archivedRows.length})
              </Text>
            </Pressable>
            {showArchived
              ? archivedRows.map((r) => {
                  const deletable = canHardDelete && !hasDeps(r.serverId);
                  return (
                    <View
                      key={r.localId}
                      className="bg-raised dark:bg-raised-dk rounded-ctl p-3 gap-2">
                      <Text className="text-ink-2 dark:text-ink-2-dk">{r.name}</Text>
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

// The chosen view state, across unmounts — session-only, the
// GymSetupChecklist / list-scroll-position idiom.
let lastShowArchived = false;

export default function PlansScreen() {
  useSetupAutoReturn('plan');
  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management" coveredByNav />
        <PageHead
          title="Plans"
          subtitle="Define your membership plans. Existing subscribers keep the price and credits they signed up with — editing a plan only changes what new subscribers get."
        />
        <PlansPanel />
      </ScrollView>
    </Screen>
  );
}
