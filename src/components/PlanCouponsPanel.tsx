import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { ChipButton } from './ChipButton';
import { Input } from './Input';
import { Text } from './Text';
import { FieldLabel } from './SectionLabel';
import { useGymMembership } from '@/lib/auth';
import { couponLabel, couponWindowLabel, normaliseCode } from '@/lib/coupons';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/useCan';

type CouponRow = {
  id: string;
  code: string;
  name: string | null;
  discount_kind: 'percent' | 'amount';
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string | null;
  duration: 'once' | 'repeating';
  duration_in_months: number | null;
  valid_until: string | null;
  max_redemptions: number | null;
  stripe_coupon_id: string | null;
};

const MONTH_CHOICES = [
  { label: 'First month only', months: null },
  { label: 'Three months', months: 3 },
  { label: 'Six months', months: 6 },
];

// Offers, where the prices are. An owner writing one is doing the same
// job as pricing a plan, so it carries the same capability and sits on
// the same screen rather than inventing a Marketing section.
export function PlanCouponsPanel() {
  const membership = useGymMembership();
  const gymId = membership.data?.gymId;
  const canManage = useCan('can_manage_plans') === true;
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState('');
  const [months, setMonths] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const coupons = useQuery({
    queryKey: ['plan-coupons', gymId],
    enabled: !!gymId && canManage,
    queryFn: async (): Promise<CouponRow[]> => {
      const { data, error: e } = await supabase
        .from('plan_coupons')
        .select(
          'id, code, name, discount_kind, percent_off, amount_off_cents, currency, duration, duration_in_months, valid_until, max_redemptions, stripe_coupon_id',
        )
        .eq('gym_id', gymId!)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (e) throw e;
      return (data ?? []) as CouponRow[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const pct = Number(percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        throw new Error('Enter a percentage between 1 and 100');
      }
      const { error: e } = await supabase.rpc('upsert_plan_coupon', {
        p_gym_id: gymId!,
        p_code: normaliseCode(code),
        p_discount_kind: 'percent',
        p_percent_off: pct,
        p_duration: months == null ? 'once' : 'repeating',
        p_duration_in_months: months,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setCode('');
      setPercent('');
      setMonths(null);
      setError(null);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['plan-coupons'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save that code')),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc('archive_plan_coupon', {
        p_coupon_id: id,
      });
      if (e) throw e;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['plan-coupons'] }),
    onError: (e) => setError(errorMessage(e, 'Could not archive that code')),
  });

  if (!gymId || !canManage) return null;

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
          Offer codes
        </Text>
        <ChipButton
          label={open ? 'Cancel' : 'New code'}
          icon={open ? 'close' : 'add'}
          onPress={() => setOpen((v) => !v)}
        />
      </View>
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        A member types the code when they subscribe. The discount runs for
        the period you set and then stops on its own — you don't have to
        remember to end it.
      </Text>

      {open ? (
        <View className="gap-3 border-t border-line dark:border-line-dk pt-3">
          <Input
            label="Code"
            value={code}
            onChangeText={setCode}
            placeholder="JAN50"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Input
            label="Percent off"
            value={percent}
            onChangeText={setPercent}
            placeholder="50"
            keyboardType="number-pad"
          />
          <View className="gap-1.5">
            <FieldLabel>How long it lasts</FieldLabel>
            <View className="flex-row flex-wrap gap-1.5">
              {MONTH_CHOICES.map((c) => (
                <ChipButton
                  key={c.label}
                  label={c.label}
                  icon={months === c.months ? 'checkmark' : 'time-outline'}
                  tone={months === c.months ? 'filled' : 'neutral'}
                  onPress={() => setMonths(c.months)}
                />
              ))}
            </View>
          </View>
          <ChipButton
            tone="filled"
            className="self-start"
            label={save.isPending ? 'Saving…' : 'Save code'}
            icon="pricetag-outline"
            disabled={save.isPending}
            onPress={() => save.mutate()}
          />
        </View>
      ) : null}

      {error ? (
        <Text className="text-red-500 dark:text-red-400 text-xs">{error}</Text>
      ) : null}

      {(coupons.data ?? []).map((c) => (
        <View
          key={c.id}
          className="flex-row items-center gap-2 border-t border-line dark:border-line-dk pt-3">
          <View className="flex-1">
            <Text className="text-ink dark:text-ink-dk text-sm font-semibold">
              {c.code}
            </Text>
            <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
              {couponLabel(
                { ...c, coupon_id: c.id, discounted_first_cents: null, reason: null },
                c.currency ?? 'GBP',
              )}
              {' · '}
              {couponWindowLabel(c.valid_until)}
            </Text>
          </View>
          <ChipButton
            label="Archive"
            icon="archive-outline"
            onPress={() => archive.mutate(c.id)}
          />
        </View>
      ))}
    </View>
  );
}
