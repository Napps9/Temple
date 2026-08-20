import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

import { Button } from './Button';
import { Sheet, SheetAction } from './Sheet';
import { useGymMembership } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import { useStoreProducts, type StoreProduct } from '@/lib/store';
import { intervalSuffix } from '@/lib/store-format';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/lib/theme';
import { useGymCurrency } from '@/lib/useGymCurrency';
import { useSavedFlag } from '@/lib/useSavedFlag';

export type MemberProgrammingAccessValue = {
  mode: 'free' | 'paid';
  store_product_id: string | null;
};

function productPriceLabel(p: StoreProduct, currency: string) {
  return `${formatMoney(p.price_cents, currency)}${
    p.recurring ? intervalSuffix(p.recurring_interval ?? 'month') : ''
  }`;
}

export function MemberProgrammingAccessModal({
  visible,
  profileId,
  memberName,
  current,
  onClose,
}: {
  visible: boolean;
  profileId: string;
  memberName: string;
  current: MemberProgrammingAccessValue | null;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const currency = useGymCurrency();
  const queryClient = useQueryClient();
  const products = useStoreProducts(visible ? membership?.gymId : undefined);
  const [mode, setMode] = useState<'free' | 'paid'>('free');
  const [productId, setProductId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, markSaved] = useSavedFlag();

  useEffect(() => {
    if (!visible) return;
    setMode(current?.mode ?? 'free');
    setProductId(current?.store_product_id ?? null);
    setError(null);
    setPickerOpen(false);
  }, [visible, current]);

  const selectedProduct =
    (products.data ?? []).find((p) => p.id === productId) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym selected');
      const { error } = await supabase.rpc('set_member_programming_access', {
        p_gym_id: membership.gymId,
        p_profile_id: profileId,
        p_mode: mode,
        p_store_product_id: mode === 'paid' ? productId : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({
        queryKey: ['member-programming-access', membership?.gymId, profileId],
      });
      queryClient.invalidateQueries({ queryKey: ['programmed-members'] });
      queryClient.invalidateQueries({ queryKey: ['member-programming-month'] });
      queryClient.invalidateQueries({ queryKey: ['my-programming-access'] });
      setTimeout(() => onClose(), 600);
    },
    onError: (e) => setError(errorMessage(e, 'Could not save access')),
  });

  return (
    <Sheet
      visible={visible}
      title="Programming access"
      subtitle={`How ${memberName} unlocks their individual programming.`}
      onClose={onClose}
      dialogWidth={520}
      actions={
        <>
          <SheetAction>
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
          </SheetAction>
          <SheetAction grow>
            <Button
              onPress={() => save.mutate()}
              loading={save.isPending}
              success={saved}>
              Save
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-4 pb-1">
          <View className="flex-row gap-2">
            {(['free', 'paid'] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  className={`flex-1 rounded-xl border px-4 py-3 items-center ${
                    active
                      ? 'border-transparent bg-raised dark:bg-raised-dk'
                      : 'border-line dark:border-line-dk'
                  }`}>
                  <Text
                    className={
                      active
                        ? 'text-ink dark:text-ink-dk font-semibold'
                        : 'text-ink-2 dark:text-ink-2-dk font-medium'
                    }>
                    {m === 'free' ? 'Free' : 'Paid'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'paid' ? (
            <View className="gap-1.5">
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                Store product that unlocks it
              </Text>
              <Pressable
                onPress={() => setPickerOpen(true)}
                className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-lg px-4 py-3 flex-row items-center gap-2 active:opacity-70">
                <Text
                  className={
                    selectedProduct
                      ? 'flex-1 text-ink dark:text-ink-dk text-base'
                      : 'flex-1 text-ink-3 dark:text-ink-3-dk text-base'
                  }>
                  {selectedProduct
                    ? `${selectedProduct.name} — ${productPriceLabel(selectedProduct, currency)}`
                    : 'No product linked'}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={colors.ink3}
                />
              </Pressable>
              <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                The member buys (or subscribes to) this product in the store to
                unlock. Members whose membership plan includes individualized
                programming always have access.
              </Text>
            </View>
          ) : (
            <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
              The member sees everything you programme for them, no purchase
              needed.
            </Text>
          )}

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              className="text-red-500 dark:text-red-400 text-[13px]">
              {error}
            </Text>
          ) : null}
      </View>

      <Sheet
        visible={pickerOpen}
        title="Pick a product"
        onClose={() => setPickerOpen(false)}
        actions={
          <SheetAction grow>
            <Button variant="secondary" onPress={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </SheetAction>
        }>
            <View className="gap-1 pb-1">
              <Pressable
                onPress={() => {
                  setProductId(null);
                  setPickerOpen(false);
                }}
                className="rounded-lg px-3 py-3 active:bg-raised dark:active:bg-raised-dk">
                <Text className="text-ink dark:text-ink-dk">
                  No product
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                  Only a qualifying membership plan unlocks it.
                </Text>
              </Pressable>
              {(products.data ?? []).map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setProductId(p.id);
                    setPickerOpen(false);
                  }}
                  className="rounded-lg px-3 py-3 active:bg-raised dark:active:bg-raised-dk">
                  <Text className="text-ink dark:text-ink-dk">
                    {p.name}
                  </Text>
                  <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
                    {productPriceLabel(p, currency)}
                    {p.recurring ? ' · subscription' : ' · one-off'}
                  </Text>
                </Pressable>
              ))}
              {products.data && products.data.length === 0 ? (
                <Text className="text-ink-3 dark:text-ink-3-dk text-[13px] px-3 py-2">
                  No store products yet — add one in Manage → Store first.
                </Text>
              ) : null}
            </View>
      </Sheet>
    </Sheet>
  );
}
