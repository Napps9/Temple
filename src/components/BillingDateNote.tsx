// What the member is told about a gym's common billing date, before they
// pay (0274).
//
// The shape only — "the rest of this month, then the 1st". The figure
// itself appears on Stripe's own checkout page, itemised, on the screen
// where the card is entered. Computing it here as well is how a number in
// an app comes to disagree with the invoice somebody reads out on the
// phone, and 0264 already settled that argument: the code is ours, the
// arithmetic is Stripe's.

import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { Text } from './Text';

import { supabase } from '@/lib/supabase';

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

export function BillingDateNote({ gymId }: { gymId: string | undefined }) {
  const anchor = useQuery({
    queryKey: ['billing-anchor', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase.rpc('gym_billing_anchor', {
        p_gym_id: gymId!,
        p_price_cents: 0,
      });
      if (error) throw error;
      const row = (data ?? [])[0] as { anchor_at: string } | undefined;
      // No row means the gym bills on the day each member joined, which
      // needs no explaining because it is what everybody expects.
      return row ? new Date(row.anchor_at).getDate() : null;
    },
  });

  if (!anchor.data) return null;

  return (
    <View className="bg-raised dark:bg-raised-dk rounded-ctl px-3 py-2.5">
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs leading-5">
        Everyone here is billed on{' '}
        <Text className="text-ink dark:text-ink-dk font-semibold">
          the {ordinal(anchor.data)}
        </Text>
        . You&rsquo;ll pay for the rest of this month when you join — the exact
        amount is shown before you confirm — then on the {ordinal(anchor.data)}{' '}
        each month after that.
      </Text>
    </View>
  );
}
