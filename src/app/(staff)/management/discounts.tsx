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

type Kind = 'percent' | 'amount';

type Discount = {
  discount_id: string;
  code: string;
  kind: Kind;
  value: number;
  valid_from: string | null;
  valid_to: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  stripe_promo_id: string | null;
  archived_at: string | null;
};

function formatValue(d: Discount): string {
  return d.kind === 'percent'
    ? `${(d.value / 100).toFixed(d.value % 100 === 0 ? 0 : 1)}% off`
    : `£${(d.value / 100).toFixed(2)} off`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ManageDiscounts() {
  const { data: gym } = useGymMembership();
  const queryClient = useQueryClient();

  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<Kind>('percent');
  const [valueInput, setValueInput] = useState('');
  const [validTo, setValidTo] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stripeNote, setStripeNote] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['discounts', gym?.gymId],
    enabled: !!gym?.gymId,
    queryFn: async (): Promise<Discount[]> => {
      const { data, error } = await supabase
        .from('discounts')
        .select(
          'discount_id, code, kind, value, valid_from, valid_to, max_redemptions, redemption_count, stripe_promo_id, archived_at',
        )
        .eq('gym_id', gym!.gymId)
        .order('archived_at', { nullsFirst: true })
        .order('code');
      if (error) throw error;
      return (data ?? []) as unknown as Discount[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!gym) throw new Error('No gym');
      if (!code.trim()) throw new Error('Code required');
      const v = parseFloat(valueInput);
      if (!Number.isFinite(v) || v <= 0) throw new Error('Enter a value');
      const value = kind === 'percent' ? Math.round(v * 100) : Math.round(v * 100);
      if (kind === 'percent' && value > 10000) {
        throw new Error('Percent must be ≤ 100');
      }
      const maxN = maxRedemptions ? parseInt(maxRedemptions, 10) : null;
      const { data, error } = await supabase.functions.invoke<{
        discountId: string;
        stripeStatus: { ok: boolean; reason?: string };
      }>('save-discount', {
        body: {
          discountId: editing?.discount_id ?? null,
          gymId: gym.gymId,
          code: code.trim(),
          kind,
          value,
          validFrom: null,
          validTo: validTo || null,
          maxRedemptions: maxN,
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
      queryClient.invalidateQueries({ queryKey: ['discounts', gym?.gymId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('discounts')
        .update({ archived_at: new Date().toISOString() })
        .eq('discount_id', id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['discounts', gym?.gymId] }),
  });

  function startEdit(d: Discount) {
    setEditing(d);
    setComposing(true);
    setCode(d.code);
    setKind(d.kind);
    setValueInput((d.value / 100).toString());
    setValidTo(d.valid_to ?? '');
    setMaxRedemptions(d.max_redemptions?.toString() ?? '');
    setError(null);
  }

  function cancelCompose() {
    setComposing(false);
    setEditing(null);
    setCode('');
    setKind('percent');
    setValueInput('');
    setValidTo('');
    setMaxRedemptions('');
    setError(null);
  }

  const live = (listQuery.data ?? []).filter((d) => !d.archived_at);
  const archived = (listQuery.data ?? []).filter((d) => d.archived_at);

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-6 py-6 md:max-w-2xl md:mx-auto md:w-full">
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Discounts
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              Promo codes members enter at signup. Mirrored to Stripe.
            </Text>
          </View>
          {!composing ? (
            <Button onPress={() => setComposing(true)}>New code</Button>
          ) : null}
        </View>

        {composing ? (
          <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold">
              {editing ? 'Edit discount' : 'New discount'}
            </Text>
            <Input
              label="Code"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              placeholder="e.g. SUMMER25"
            />
            <View className="flex-row gap-2">
              {(['percent', 'amount'] as Kind[]).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  className={`flex-1 rounded-lg border p-3 ${
                    kind === k
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text
                    className={`text-sm font-medium ${
                      kind === k ? 'text-primary' : 'text-gray-900 dark:text-gray-50'
                    }`}>
                    {k === 'percent' ? 'Percent off' : 'Amount off (£)'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Input
              label={kind === 'percent' ? 'Percent (1–100)' : 'Amount (GBP)'}
              value={valueInput}
              onChangeText={setValueInput}
              keyboardType="decimal-pad"
              placeholder={kind === 'percent' ? '25' : '10.00'}
            />
            <Input
              label="Expires (ISO date, optional)"
              value={validTo}
              onChangeText={setValidTo}
              placeholder="2025-12-31"
              autoCapitalize="none"
            />
            <Input
              label="Max redemptions (optional)"
              value={maxRedemptions}
              onChangeText={setMaxRedemptions}
              keyboardType="number-pad"
              placeholder="e.g. 50"
            />
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
                <Button variant="secondary" onPress={cancelCompose}>Cancel</Button>
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
          {live.length === 0 && !composing ? (
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              No discounts yet.
            </Text>
          ) : null}
          {live.map((d) => (
            <View
              key={d.discount_id}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-2">
              <View className="flex-row items-center gap-2">
                <Text className="text-gray-900 dark:text-gray-50 font-semibold flex-1">
                  {d.code}
                </Text>
                {d.stripe_promo_id ? (
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
                <Pressable onPress={() => startEdit(d)} hitSlop={8}>
                  <Ionicons name="create-outline" size={18} color="#6B7280" />
                </Pressable>
                <Pressable
                  onPress={() => archiveMutation.mutate(d.discount_id)}
                  hitSlop={8}>
                  <Ionicons name="archive-outline" size={18} color="#6B7280" />
                </Pressable>
              </View>
              <View className="flex-row items-center gap-3">
                <Text className="text-gray-900 dark:text-gray-50 text-sm">
                  {formatValue(d)}
                </Text>
                {d.valid_to ? (
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    · expires {fmtDate(d.valid_to)}
                  </Text>
                ) : null}
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
                  · {d.redemption_count}
                  {d.max_redemptions ? `/${d.max_redemptions}` : ''} used
                </Text>
              </View>
            </View>
          ))}
        </View>

        {archived.length > 0 ? (
          <View className="gap-2 pt-4">
            <Text className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
              Archived
            </Text>
            {archived.map((d) => (
              <View
                key={d.discount_id}
                className="bg-white dark:bg-gray-900 rounded-xl p-3 opacity-60">
                <Text className="text-gray-900 dark:text-gray-50">{d.code}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
