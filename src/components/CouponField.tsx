import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { ChipButton } from './ChipButton';
import { Input } from './Input';
import { Text } from './Text';
import { applyDiscount, couponLabel, normaliseCode, type CouponPreview } from '@/lib/coupons';
import { errorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/setup-flow';
import { supabase } from '@/lib/supabase';

// The member's side of an offer. Deliberately closed until asked for:
// a code box on every plan card invites everyone to go hunting for a
// code they do not have, and makes the people without one feel they are
// paying too much.
//
// The applied figure comes from preview_plan_coupon, the same function
// stripe-checkout re-runs before it takes any money, so what is shown
// here and what is charged cannot come from two different rules.
export function CouponField({
  gymId,
  planId,
  priceCents,
  currency,
  onApplied,
}: {
  gymId: string;
  planId: string;
  priceCents: number | null;
  currency: string;
  onApplied: (code: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<CouponPreview | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  const check = useMutation({
    mutationFn: async (): Promise<CouponPreview | null> => {
      const { data, error } = await supabase.rpc('preview_plan_coupon', {
        p_gym_id: gymId,
        p_plan_id: planId,
        p_code: normaliseCode(code),
      });
      if (error) throw error;
      return ((data ?? []) as CouponPreview[])[0] ?? null;
    },
    onSuccess: (row) => {
      if (!row || row.reason) {
        setApplied(null);
        setReason(row?.reason ?? 'That code isn\'t recognised');
        onApplied(null);
        return;
      }
      setApplied(row);
      setReason(null);
      onApplied(normaliseCode(code));
    },
    onError: (e) => {
      setApplied(null);
      setReason(errorMessage(e, 'Could not check that code'));
      onApplied(null);
    },
  });

  if (!open) {
    return (
      <ChipButton
        className="self-start"
        label="Have a code?"
        icon="pricetag-outline"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <View className="gap-2">
      <Input
        label="Offer code"
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setApplied(null);
          setReason(null);
          onApplied(null);
        }}
        placeholder="JAN50"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <View className="flex-row items-center gap-2 flex-wrap">
        <ChipButton
          tone={applied ? 'neutral' : 'filled'}
          label={check.isPending ? 'Checking…' : applied ? 'Applied' : 'Apply'}
          icon={applied ? 'checkmark' : 'pricetag-outline'}
          disabled={check.isPending || code.trim() === ''}
          onPress={() => check.mutate()}
        />
        {applied ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
            {couponLabel(applied, currency)}
            {priceCents != null
              ? ` · ${formatPrice(applyDiscount(priceCents, applied), currency)} first month`
              : ''}
          </Text>
        ) : null}
      </View>
      {reason ? (
        <Text className="text-amber-700 dark:text-amber-400 text-xs">{reason}</Text>
      ) : null}
    </View>
  );
}
