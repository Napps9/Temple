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
import { errorMessage } from '@/lib/errors';
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
import { useThemeColors } from '@/lib/theme';
import type { Json } from '@/types/database';

type PlanReview = {
  price_id: string;
  label: string;
  amount_cents: number;
  count: number;
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
      if (error) throw error;
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
    queryFn: async () =>
      runInference({
        gymId: membership!.gymId,
        gymCurrency: 'GBP',
        rows: (preview.data?.members ?? []).map((m) => ({
          plan_name: m.label,
          plan_end: unixToDateIso(m.current_period_end) ?? undefined,
          tags: [],
        })),
      }),
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
        return {
          price_id: pr.price_id,
          label: pr.label,
          amount_cents: pr.amount_cents,
          count: pr.count,
          name: sug?.suggested_name || pr.label,
          kind: sug?.suggested_kind ?? 'unlimited',
          creditCount:
            sug && sug.suggested_credit_count != null
              ? String(sug.suggested_credit_count)
              : '',
          // The real Stripe amount wins over any AI price guess.
          monthlyPrice: centsToPounds(pr.amount_cents),
          include: true,
        };
      }),
    );
    setSelected(new Set((preview.data.members ?? []).map((m) => m.email)));
  }, [preview.data, inference.data, plans.length]);

  const includedPriceIds = useMemo(
    () => new Set(plans.filter((p) => p.include).map((p) => p.price_id)),
    [plans],
  );

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

      // Create one Temple plan per included Stripe price, caching the
      // Stripe price id so future Temple checkouts reuse it.
      const planIdByPriceId = new Map<string, string>();
      for (const p of included) {
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
        planIdByPriceId.set(p.price_id, (inserted as { plan_id: string }).plan_id);
      }

      const rows = buildStripeImportRows({
        members: preview.data?.members ?? [],
        selectedEmails: selected,
        planIdByPriceId,
      });
      if (rows.length === 0) throw new Error('No members selected to import');

      const { data, error: e } = await supabase.rpc('import_pending_members', {
        p_gym_id: membership.gymId,
        p_rows: rows as unknown as Json,
      });
      if (e) throw e;
      const res = (data ?? [])[0] as
        | { inserted: number; updated: number; skipped: number }
        | undefined;
      return { staged: rows.length, result: res };
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
            Bring your existing Stripe subscribers across. Their live
            subscription is adopted by Temple — same billing, no re-charge —
            and they can manage it in the app once they sign up.
          </Text>
        </View>

        {commit.data ? (
          <View className="bg-white dark:bg-gray-900 border border-emerald-300 dark:border-emerald-800 rounded-xl p-5 gap-3">
            <View className="flex-row items-center gap-2">
              <Ionicons name="checkmark-circle" size={20} color="#10B981" />
              <Text className="text-gray-900 dark:text-gray-50 font-semibold text-lg">
                {commit.data.staged} member
                {commit.data.staged === 1 ? '' : 's'} staged
              </Text>
            </View>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              They'll join your roster when they sign up with the email on
              their Stripe account (share your join link or email them an
              invite). Their subscription then appears in the app, billed as
              normal and manageable in-app — for them and for you.
            </Text>
            <Button
              variant="secondary"
              onPress={() => router.replace('/management/members' as never)}>
              Back to Members
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
        ) : members.length === 0 ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-5 gap-2 shadow-card">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              No active subscriptions found
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              We didn't find any active, trialing or past-due subscriptions on
              your connected Stripe account.
              {(preview.data?.skipped_no_email ?? 0) > 0
                ? ` (${preview.data!.skipped_no_email} skipped with no email.)`
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
                One Temple plan is created per Stripe price. Edit the suggested
                names, or untick a price to skip its members.
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
                      {p.count} member{p.count === 1 ? '' : 's'}
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
                          label="Credits per period"
                          value={p.creditCount}
                          onChangeText={(v) =>
                            updatePlan(p.price_id, { creditCount: v })
                          }
                          keyboardType="number-pad"
                          placeholder="10"
                        />
                      ) : null}
                      <Input
                        label="Monthly price (£)"
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

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            <Button
              onPress={() => commit.mutate()}
              loading={commit.isPending}
              disabled={importable.length === 0}>
              Import {importable.length} member
              {importable.length === 1 ? '' : 's'}
            </Button>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
