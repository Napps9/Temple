import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage, functionErrorMessage } from '@/lib/errors';
import {
  centsToPounds,
  poundsToCents,
  runInference,
  type PlanKind,
} from '@/lib/import/infer';
import {
  buildStripeImportRows,
  type StripeMember,
  type StripePreview,
  unixToDateIso,
} from '@/lib/import/stripe';
import { supabase } from '@/lib/supabase';
import { currencySymbol } from '@/lib/setup-flow';
import { useThemeColors } from '@/lib/theme';
import { useGymCurrency } from '@/lib/useGymCurrency';
import type { Json } from '@/types/database';

type PlanReview = {
  price_id: string;
  label: string;
  amount_cents: number;
  count: number;
  recurring: boolean;
  name: string;
  kind: PlanKind;
  creditCount: string;
  monthlyPrice: string;
  include: boolean;
};

function fmtRenew(unix: number | null): string {
  const iso = unixToDateIso(unix);
  return iso ? `renews ${iso}` : 'no renewal date';
}

export default function ImportStripeScreen() {
  const colors = useThemeColors();
  const symbol = currencySymbol(useGymCurrency());
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const isOwner = membership?.role === 'owner';

  const preview = useQuery({
    queryKey: ['stripe-import-preview', membership?.gymId],
    enabled: !!membership?.gymId && isOwner,
    staleTime: 0,
    queryFn: async (): Promise<StripePreview> => {
      const { data, error } = await supabase.functions.invoke('stripe-import', {
        body: { gym_id: membership!.gymId },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      return data as StripePreview;
    },
  });

  // AI suggestions for the plan names/kinds (same review brain the CSV
  // importer uses). Always resolves — runInference falls back locally.
  const inference = useQuery({
    queryKey: [
      'stripe-import-inference',
      membership?.gymId,
      (preview.data?.prices ?? []).map((p) => p.label).join('|'),
    ],
    enabled: !!preview.data && !!membership?.gymId,
    queryFn: async () => {
      // Feed one row per subscriber, then a synthetic row for any price
      // with no subscriber (recurring-but-empty and every one-time price)
      // so those still get an AI name / kind / credit-count suggestion.
      const memberRows = (preview.data?.members ?? []).map((m) => ({
        plan_name: m.label,
        plan_end: unixToDateIso(m.current_period_end) ?? undefined,
        tags: [] as string[],
      }));
      const covered = new Set(memberRows.map((r) => r.plan_name));
      const extraRows = (preview.data?.prices ?? [])
        .filter((pr) => !covered.has(pr.label))
        .map((pr) => ({ plan_name: pr.label, tags: [] as string[] }));
      return runInference({
        gymId: membership!.gymId,
        gymCurrency: 'GBP',
        rows: [...memberRows, ...extraRows],
      });
    },
  });

  const [plans, setPlans] = useState<PlanReview[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Seed once both the preview and the (always-resolving) inference land.
  useEffect(() => {
    if (!preview.data || !inference.data || plans.length > 0) return;
    const byLabel = new Map(inference.data.plans.map((p) => [p.raw_name, p]));
    setPlans(
      preview.data.prices.map((pr) => {
        const sug = byLabel.get(pr.label);
        const suggestedKind = sug?.suggested_kind ?? 'unlimited';
        // A one-time Stripe price is a single charge → credit pack. A
        // recurring price can't be a one-off pack, so a credit_pack
        // suggestion there becomes the recurring credit_period.
        const kind: PlanKind = !pr.recurring
          ? 'credit_pack'
          : suggestedKind === 'credit_pack'
            ? 'credit_period'
            : suggestedKind;
        return {
          price_id: pr.price_id,
          label: pr.label,
          amount_cents: pr.amount_cents,
          count: pr.count,
          recurring: pr.recurring,
          name: sug?.suggested_name || pr.label,
          kind,
          creditCount:
            sug && sug.suggested_credit_count != null
              ? String(sug.suggested_credit_count)
              : '',
          // The real Stripe amount wins over any AI price guess.
          monthlyPrice: centsToPounds(pr.amount_cents),
          // Recurring prices default on; one-time prices are opt-in so a
          // gym's unrelated one-off charges don't become credit packs.
          include: pr.recurring,
        };
      }),
    );
    setSelected(new Set((preview.data.members ?? []).map((m) => m.email)));
  }, [preview.data, inference.data, plans.length]);

  const includedPriceIds = useMemo(
    () => new Set(plans.filter((p) => p.include).map((p) => p.price_id)),
    [plans],
  );
  const includedCount = includedPriceIds.size;

  function updatePlan(priceId: string, patch: Partial<PlanReview>) {
    setPlans((cur) =>
      cur.map((p) => (p.price_id === priceId ? { ...p, ...patch } : p)),
    );
  }

  function toggleMember(email: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  const importable = useMemo(() => {
    const members = preview.data?.members ?? [];
    return members.filter(
      (m) => includedPriceIds.has(m.price_id) && selected.has(m.email),
    );
  }, [preview.data?.members, includedPriceIds, selected]);

  const commit = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('Missing context');
      const included = plans.filter((p) => p.include);

      // Pre-flight the plan fields so we don't half-create.
      for (const p of included) {
        if (!p.name.trim()) throw new Error('Every imported plan needs a name');
        if (p.kind !== 'unlimited') {
          const c = parseInt(p.creditCount, 10);
          if (!Number.isFinite(c) || c <= 0) {
            throw new Error(`"${p.name}" needs a credit count`);
          }
        }
      }

      // Reuse an existing active plan rather than duplicating it — by
      // Stripe price first, then by name (case-insensitive) so two prices
      // that share a name collapse to one plan. DB partial unique indexes
      // (0130 price, 0131 name) enforce both; these checks just keep the
      // reuse graceful instead of hitting a unique-violation.
      const { data: existing } = await supabase
        .from('membership_plans')
        .select('plan_id, name, stripe_price_id')
        .eq('gym_id', membership.gymId)
        .is('archived_at', null);
      const existingByPrice = new Map<string, string>();
      const planIdByName = new Map<string, string>();
      for (const e of existing ?? []) {
        if (e.stripe_price_id) existingByPrice.set(e.stripe_price_id, e.plan_id);
        planIdByName.set((e.name as string).trim().toLowerCase(), e.plan_id);
      }

      // Create one Temple plan per included Stripe price, caching the
      // Stripe price id so future Temple checkouts reuse it.
      const planIdByPriceId = new Map<string, string>();
      let createdPlans = 0;
      for (const p of included) {
        const byPrice = existingByPrice.get(p.price_id);
        if (byPrice) {
          planIdByPriceId.set(p.price_id, byPrice);
          continue;
        }
        const nameKey = p.name.trim().toLowerCase();
        const byName = planIdByName.get(nameKey);
        if (byName) {
          planIdByPriceId.set(p.price_id, byName);
          continue;
        }
        const { data: inserted, error: planErr } = await supabase
          .from('membership_plans')
          .insert({
            gym_id: membership.gymId,
            name: p.name.trim(),
            kind: p.kind,
            credit_count:
              p.kind === 'unlimited' ? null : parseInt(p.creditCount, 10),
            monthly_price_cents:
              poundsToCents(p.monthlyPrice) ?? p.amount_cents,
            stripe_price_id: p.price_id,
            ...(p.kind === 'credit_period' ? { period_length: '30 days' } : {}),
          })
          .select('plan_id')
          .single();
        if (planErr) throw planErr;
        const newId = (inserted as { plan_id: string }).plan_id;
        planIdByPriceId.set(p.price_id, newId);
        // A later included price with the same name reuses this one.
        planIdByName.set(nameKey, newId);
        createdPlans += 1;
      }

      const rows = buildStripeImportRows({
        members: preview.data?.members ?? [],
        selectedEmails: selected,
        planIdByPriceId,
      });

      // Plans-only import is valid — a gym with no active subscribers can
      // still bring its plan catalogue across. Only stage members when
      // there are some; an empty set is a success, not an error.
      let res: { inserted: number; updated: number; skipped: number } | undefined;
      if (rows.length > 0) {
        const { data, error: e } = await supabase.rpc('import_pending_members', {
          p_gym_id: membership.gymId,
          p_rows: rows as unknown as Json,
        });
        if (e) throw e;
        res = (data ?? [])[0] as
          | { inserted: number; updated: number; skipped: number }
          | undefined;
      }
      return { staged: rows.length, createdPlans, result: res };
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['membership-plans'] });
      queryClient.invalidateQueries({ queryKey: ['pending-members-stats'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not import')),
  });

  if (membership && !isOwner) return <Redirect href="/management" />;

  const members = preview.data?.members ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Plans" fallbackHref="/management/plans" />
        <View className="gap-2">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Import from Stripe
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            Bring your Stripe plans and subscribers across. We create a Temple
            plan for each Stripe price — including ones no one's on yet — and
            members with a live subscription are adopted (same billing, no
            re-charge), manageable in the app once they sign up.
          </Text>
        </View>

        {commit.data ? (
          <View className="bg-white dark:bg-gray-900 border border-emerald-300 dark:border-emerald-800 rounded-xl p-5 gap-3">
            <View className="flex-row items-center gap-2">
              <Ionicons name="checkmark-circle" size={20} color="#10B981" />
              <Text className="text-gray-900 dark:text-gray-50 font-semibold text-lg">
                {commit.data.createdPlans > 0
                  ? `${commit.data.createdPlans} plan${commit.data.createdPlans === 1 ? '' : 's'} imported`
                  : 'Plans already imported'}
                {commit.data.staged > 0
                  ? ` · ${commit.data.staged} member${commit.data.staged === 1 ? '' : 's'} staged`
                  : ''}
              </Text>
            </View>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              {commit.data.staged > 0
                ? "Members join your roster when they sign up with the email on their Stripe account (share your join link or email them an invite). Their subscription then appears in the app, billed as normal and manageable in-app — for them and for you."
                : 'The plans are ready to use. Assign members to them, or import subscribers later.'}
            </Text>
            <Button
              variant="secondary"
              onPress={() => router.replace('/management/plans' as never)}>
              Back to Plans
            </Button>
          </View>
        ) : preview.isLoading || inference.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">
            Reading your Stripe account…
          </Text>
        ) : preview.error ? (
          <View className="gap-3">
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {errorMessage(preview.error, 'Could not read Stripe')}
            </Text>
            <Button
              variant="secondary"
              onPress={() => router.push('/management/billing' as never)}>
              Check Stripe connection
            </Button>
          </View>
        ) : (preview.data?.prices?.length ?? 0) === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-5 gap-2 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              No recurring plans found
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              We didn't find any active recurring prices or subscriptions on
              your connected Stripe account.
              {(preview.data?.skipped_no_email ?? 0) > 0
                ? ` (${preview.data!.skipped_no_email} subscriber(s) skipped with no email.)`
                : ''}
            </Text>
          </View>
        ) : (
          <>
            <View className="gap-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                Plans
              </Text>
              <Text className="text-gray-500 dark:text-gray-400 text-sm">
                One Temple plan is created per Stripe price — including prices no
                one subscribes to yet. One-time prices come in as credit packs
                and are off by default. Edit the suggested names, or tick /
                untick a price.
              </Text>
              {plans.map((p) => (
                <View
                  key={p.price_id}
                  className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 shadow-card">
                  <Pressable
                    onPress={() => updatePlan(p.price_id, { include: !p.include })}
                    className="flex-row items-center gap-2">
                    <Ionicons
                      name={p.include ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={p.include ? colors.primary : colors.iconTertiary}
                    />
                    <Text className="flex-1 text-gray-900 dark:text-gray-50 font-medium">
                      {p.label}
                    </Text>
                    <Text className="text-gray-400 dark:text-gray-500 text-xs">
                      {!p.recurring
                        ? 'One-time price'
                        : p.count === 0
                          ? 'No subscribers yet'
                          : `${p.count} member${p.count === 1 ? '' : 's'}`}
                    </Text>
                  </Pressable>
                  {p.include ? (
                    <>
                      <Input
                        label="Plan name"
                        value={p.name}
                        onChangeText={(v) => updatePlan(p.price_id, { name: v })}
                      />
                      <View className="gap-1">
                        <Text className="text-gray-700 dark:text-gray-200 text-sm">
                          Kind
                        </Text>
                        <View className="flex-row gap-2 flex-wrap">
                          {(['unlimited', 'credit_period', 'credit_pack'] as PlanKind[]).map(
                            (k) => (
                              <Pressable
                                key={k}
                                onPress={() => updatePlan(p.price_id, { kind: k })}
                                className={`px-3 py-1.5 rounded-md border ${
                                  p.kind === k
                                    ? 'border-primary bg-primary/10'
                                    : 'border-gray-200 dark:border-gray-700'
                                }`}>
                                <Text
                                  className={`text-xs uppercase tracking-widest ${
                                    p.kind === k
                                      ? 'text-primary'
                                      : 'text-gray-500 dark:text-gray-400'
                                  }`}>
                                  {k.replace('_', ' ')}
                                </Text>
                              </Pressable>
                            ),
                          )}
                        </View>
                      </View>
                      {p.kind !== 'unlimited' ? (
                        <Input
                          label={
                            p.kind === 'credit_pack'
                              ? 'Credits in the pack'
                              : 'Credits per period'
                          }
                          value={p.creditCount}
                          onChangeText={(v) =>
                            updatePlan(p.price_id, { creditCount: v })
                          }
                          keyboardType="number-pad"
                          placeholder="10"
                        />
                      ) : null}
                      <Input
                        label={
                          p.kind === 'credit_pack'
                            ? `Pack price (${symbol})`
                            : `Monthly price (${symbol})`
                        }
                        value={p.monthlyPrice}
                        onChangeText={(v) =>
                          updatePlan(p.price_id, { monthlyPrice: v })
                        }
                        keyboardType="decimal-pad"
                      />
                    </>
                  ) : null}
                </View>
              ))}
            </View>

            {members.length === 0 ? (
              <View className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card">
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  No active subscribers on Stripe — you're importing the plans
                  only. Assign members to them, or import subscribers later.
                </Text>
              </View>
            ) : (
            <View className="gap-3">
              <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
                Members ({importable.length} selected)
              </Text>
              {(preview.data?.skipped_no_email ?? 0) > 0 ? (
                <Text className="text-amber-600 dark:text-amber-400 text-xs">
                  {preview.data!.skipped_no_email} subscriber
                  {preview.data!.skipped_no_email === 1 ? '' : 's'} skipped — no
                  email on the Stripe customer.
                </Text>
              ) : null}
              <View className="gap-2">
                {members.map((m: StripeMember) => {
                  const on =
                    selected.has(m.email) && includedPriceIds.has(m.price_id);
                  const planSkipped = !includedPriceIds.has(m.price_id);
                  return (
                    <Pressable
                      key={`${m.email}-${m.subscription_id}`}
                      onPress={() => !planSkipped && toggleMember(m.email)}
                      className={`flex-row items-center gap-3 bg-white dark:bg-gray-900 rounded-lg p-3 ${
                        planSkipped ? 'opacity-40' : ''
                      }`}>
                      <Ionicons
                        name={on ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={on ? colors.primary : colors.iconTertiary}
                      />
                      <View className="flex-1">
                        <Text
                          className="text-gray-900 dark:text-gray-50 text-sm"
                          numberOfLines={1}>
                          {m.name ? `${m.name} · ` : ''}
                          {m.email}
                        </Text>
                        <Text className="text-gray-400 dark:text-gray-500 text-xs">
                          {m.label} · {m.status} · {fmtRenew(m.current_period_end)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            )}

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <Button
              onPress={() => commit.mutate()}
              loading={commit.isPending}
              disabled={includedCount === 0}>
              {importable.length > 0
                ? `Import ${includedCount} plan${includedCount === 1 ? '' : 's'} · ${importable.length} member${importable.length === 1 ? '' : 's'}`
                : `Import ${includedCount} plan${includedCount === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
