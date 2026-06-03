import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Kind = 'unlimited' | 'credit_period' | 'credit_pack';
type BillingInterval = { interval: 'day' | 'week' | 'month' | 'year'; intervalCount: number };

type Plan = {
  plan_id: string;
  name: string;
  kind: Kind;
  credit_count: number | null;
  period_length: string | null;
  monthly_price_cents: number | null;
  notice_period: string | null;
  stripe_price_id: string | null;
  archived_at: string | null;
};

const KIND_OPTIONS: { value: Kind; label: string; sub: string }[] = [
  { value: 'unlimited', label: 'Unlimited', sub: 'No cap on classes' },
  { value: 'credit_period', label: 'Credit period', sub: 'N classes per cycle' },
  { value: 'credit_pack', label: 'Class pack', sub: 'One-off pack of credits' },
];

const PERIOD_OPTIONS = [
  { value: '7 days', label: 'Weekly' },
  { value: '14 days', label: 'Fortnightly' },
  { value: '1 month', label: 'Monthly' },
];

const BILLING_OPTIONS: { value: BillingInterval; label: string }[] = [
  { value: { interval: 'week', intervalCount: 1 }, label: 'Weekly' },
  { value: { interval: 'month', intervalCount: 1 }, label: 'Monthly' },
  { value: { interval: 'month', intervalCount: 3 }, label: 'Quarterly' },
  { value: { interval: 'year', intervalCount: 1 }, label: 'Yearly' },
];

const NOTICE_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '14 days', label: '14 days' },
  { value: '30 days', label: '30 days' },
  { value: '60 days', label: '60 days' },
];

function pickInitial<T>(opts: T[]): T {
  return opts[0];
}

function formatPrice(cents: number | null): string {
  if (cents == null) return '—';
  return `£${(cents / 100).toFixed(2)}`;
}

function formatKind(k: Kind, credits: number | null, period: string | null): string {
  switch (k) {
    case 'unlimited':
      return 'Unlimited';
    case 'credit_period':
      return `${credits ?? '?'} × per ${period ?? '?'}`;
    case 'credit_pack':
      return `${credits ?? '?'}-class pack`;
  }
}

function intervalToBilling(interval: BillingInterval): BillingInterval {
  return interval;
}

export default function ManagePlans() {
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();

  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('unlimited');
  const [credits, setCredits] = useState('');
  const [period, setPeriod] = useState(PERIOD_OPTIONS[2].value);
  const [priceGbp, setPriceGbp] = useState('');
  const [billing, setBilling] = useState<BillingInterval>(BILLING_OPTIONS[1].value);
  const [notice, setNotice] = useState(NOTICE_OPTIONS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [stripeNote, setStripeNote] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: ['plans', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from('membership_plans')
        .select(
          'plan_id, name, kind, credit_count, period_length, monthly_price_cents, notice_period, stripe_price_id, archived_at',
        )
        .eq('gym_id', gym!.gymId)
        .order('archived_at', { nullsFirst: true })
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as Plan[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!gym) throw new Error('No gym');
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('Name required');
      const priceCents = priceGbp ? Math.round(parseFloat(priceGbp) * 100) : null;
      if (priceGbp && (priceCents == null || Number.isNaN(priceCents) || priceCents < 0)) {
        throw new Error('Enter a valid price');
      }
      const creditCount = kind === 'unlimited' ? null : parseInt(credits, 10);
      if (kind !== 'unlimited' && (!creditCount || creditCount <= 0)) {
        throw new Error('Enter the number of credits');
      }

      const { data, error } = await supabase.functions.invoke<{
        planId: string;
        stripeStatus: { ok: boolean; reason?: string };
      }>('save-plan', {
        body: {
          planId: editing?.plan_id ?? null,
          gymId: gym.gymId,
          name: trimmedName,
          kind,
          creditCount,
          periodLength: kind === 'credit_period' ? period : null,
          monthlyPriceCents: priceCents,
          noticePeriod: notice,
          billing: kind === 'credit_pack' ? null : intervalToBilling(billing),
        },
      });
      if (error) throw error;
      if (!data?.stripeStatus.ok && data?.stripeStatus.reason) {
        setStripeNote(data.stripeStatus.reason);
      } else {
        setStripeNote(null);
      }
    },
    onSuccess: () => {
      cancelCompose();
      queryClient.invalidateQueries({ queryKey: ['plans', gym?.gymId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const archiveMutation = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase
        .from('membership_plans')
        .update({ archived_at: new Date().toISOString() })
        .eq('plan_id', planId);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['plans', gym?.gymId] }),
  });

  function startEdit(p: Plan) {
    setEditing(p);
    setComposing(true);
    setName(p.name);
    setKind(p.kind);
    setCredits(p.credit_count?.toString() ?? '');
    setPeriod(p.period_length ?? PERIOD_OPTIONS[2].value);
    setPriceGbp(p.monthly_price_cents != null ? (p.monthly_price_cents / 100).toString() : '');
    setNotice(p.notice_period ?? NOTICE_OPTIONS[0].value);
    setError(null);
    setStripeNote(null);
  }

  function cancelCompose() {
    setComposing(false);
    setEditing(null);
    setName('');
    setKind('unlimited');
    setCredits('');
    setPeriod(PERIOD_OPTIONS[2].value);
    setPriceGbp('');
    setBilling(BILLING_OPTIONS[1].value);
    setNotice(NOTICE_OPTIONS[0].value);
    setError(null);
  }

  const liveOnes = plansQuery.data?.filter((p) => !p.archived_at) ?? [];
  const archivedOnes = plansQuery.data?.filter((p) => p.archived_at) ?? [];

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 md:max-w-2xl md:mx-auto md:w-full px-4">
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Membership plans
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              What members can sign up to. Mirrored to Stripe on save.
            </Text>
          </View>
          {!composing ? (
            <Button onPress={() => setComposing(true)}>New plan</Button>
          ) : null}
        </View>

        {composing ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-4">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              {editing ? 'Edit plan' : 'New plan'}
            </Text>

            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder="e.g. Unlimited monthly"
            />

            <RadioGroup
              label="Kind"
              options={KIND_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                sub: o.sub,
              }))}
              value={kind}
              onChange={(v) => setKind(v as Kind)}
            />

            {kind !== 'unlimited' ? (
              <Input
                label="Credits"
                value={credits}
                onChangeText={setCredits}
                keyboardType="number-pad"
                placeholder={
                  kind === 'credit_period' ? 'e.g. 12 per cycle' : 'e.g. 10-class pack'
                }
              />
            ) : null}

            {kind === 'credit_period' ? (
              <RadioGroup
                label="Credit cadence"
                options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={period}
                onChange={(v) => setPeriod(v)}
              />
            ) : null}

            <Input
              label="Price (GBP)"
              value={priceGbp}
              onChangeText={setPriceGbp}
              keyboardType="decimal-pad"
              placeholder="e.g. 89.00"
            />

            {kind !== 'credit_pack' ? (
              <RadioGroup
                label="Billing cadence"
                options={BILLING_OPTIONS.map((o) => ({
                  value: JSON.stringify(o.value),
                  label: o.label,
                }))}
                value={JSON.stringify(billing)}
                onChange={(v) => setBilling(JSON.parse(v) as BillingInterval)}
              />
            ) : null}

            {kind !== 'credit_pack' ? (
              <RadioGroup
                label="Notice period"
                options={NOTICE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={notice}
                onChange={(v) => setNotice(v)}
              />
            ) : null}

            {error ? (
              <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
            ) : null}
            {stripeNote ? (
              <View className="flex-row items-start gap-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                <Ionicons name="warning-outline" size={16} color="#B45309" />
                <Text className="text-amber-800 dark:text-amber-200 text-sm flex-1">
                  {stripeNote}
                </Text>
              </View>
            ) : null}

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" onPress={cancelCompose}>
                  Cancel
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  onPress={() => saveMutation.mutate()}
                  loading={saveMutation.isPending}>
                  {editing ? 'Save' : 'Create'}
                </Button>
              </View>
            </View>
          </View>
        ) : null}

        <View className="gap-2">
          <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
            Live
          </Text>
          {liveOnes.length === 0 && !composing ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No plans yet — create one to start taking signups.
            </Text>
          ) : null}
          {liveOnes.map((p) => (
            <View
              key={p.plan_id}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
              <View className="flex-row items-center gap-2">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                  {p.name}
                </Text>
                {p.stripe_price_id ? (
                  <View className="bg-emerald-100 dark:bg-emerald-900/20 rounded-full px-2 py-0.5">
                    <Text className="text-emerald-700 dark:text-emerald-200 text-xs">
                      Stripe ✓
                    </Text>
                  </View>
                ) : (
                  <View className="bg-amber-100 dark:bg-amber-900/20 rounded-full px-2 py-0.5">
                    <Text className="text-amber-700 dark:text-amber-200 text-xs">
                      Stripe pending
                    </Text>
                  </View>
                )}
                <Pressable onPress={() => startEdit(p)} hitSlop={8}>
                  <Ionicons name="create-outline" size={18} color="#6B7280" />
                </Pressable>
                <Pressable
                  onPress={() => archiveMutation.mutate(p.plan_id)}
                  hitSlop={8}>
                  <Ionicons name="archive-outline" size={18} color="#6B7280" />
                </Pressable>
              </View>
              <View className="flex-row items-center gap-3">
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  {formatKind(p.kind, p.credit_count, p.period_length)}
                </Text>
                <Text className="text-gray-900 dark:text-gray-50 text-sm">
                  {formatPrice(p.monthly_price_cents)}
                </Text>
                {p.notice_period && p.notice_period !== '0' ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    · notice: {p.notice_period}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        {archivedOnes.length > 0 ? (
          <View className="gap-2 pt-4">
            <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
              Archived
            </Text>
            {archivedOnes.map((p) => (
              <View
                key={p.plan_id}
                className="bg-white dark:bg-gray-900 rounded-xl p-3 opacity-60">
                <Text className="text-gray-900 dark:text-gray-50">{p.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">{label}</Text>
      <View className="flex-row gap-2 flex-wrap">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              className={`flex-1 min-w-[110px] rounded-lg border p-3 ${
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 dark:border-gray-700 bg-transparent'
              }`}>
              <Text
                className={`text-sm font-medium ${
                  selected
                    ? 'text-primary'
                    : 'text-gray-900 dark:text-gray-50'
                }`}>
                {opt.label}
              </Text>
              {opt.sub ? (
                <Text className="text-gray-500 dark:text-gray-400 text-xs">{opt.sub}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
