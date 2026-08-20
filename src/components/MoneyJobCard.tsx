import { useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';

// The money job's switch-on card: taking it on is reading its rules and
// saying "sounds right" — never a settings form (loop-1 spec). Shared by
// the Timeline (shown while a payment is failing) and the Roster.
export function MoneyJobCard({
  gymId,
  onTakenOn,
  onDismiss,
}: {
  gymId: string | undefined;
  onTakenOn: () => void;
  onDismiss?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const takeOn = async () => {
    if (!gymId || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await supabase.rpc('set_money_job', {
        p_gym_id: gymId,
        p_enabled: true,
      });
      if (error) throw error;
      onTakenOn();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <Text className="text-ink dark:text-ink-dk text-[15px] font-semibold leading-[22px]">
        Failed payments — want me to chase them?
      </Text>
      <View className="gap-1.5">
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
          When a card fails, Stripe retries and the member already gets one
          notice from Temple.
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
          Three days in, I&apos;d send a warm nudge with their pay link — and I
          ask you before each one until you say otherwise.
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
          If Stripe gives up, I ask before offering the smaller plan.
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-sm leading-5">
          I never cancel anyone, never invent discounts, and stop after two
          messages.
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Button onPress={takeOn} loading={busy}>
            Sounds right — take it on
          </Button>
        </View>
        {onDismiss ? (
          <View className="flex-1">
            <Button variant="secondary" onPress={onDismiss} disabled={busy}>
              Not now
            </Button>
          </View>
        ) : null}
      </View>
      {failed ? (
        <Text className="text-red-600 dark:text-red-400 text-sm">
          That didn&apos;t go through — try again.
        </Text>
      ) : null}
    </View>
  );
}
