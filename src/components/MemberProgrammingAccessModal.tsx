import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 bg-black/60 items-center justify-center px-6">
        <Pressable
          onPress={() => {}}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md md:max-w-2xl gap-5 max-h-[90vh]">
          <View className="gap-1">
            <Text className="text-gray-900 dark:text-gray-50 text-xl font-semibold">
              Programming access
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              How {memberName} unlocks their individual programming.
            </Text>
          </View>

          <View className="flex-row gap-2">
            {(['free', 'paid'] as const).map((m) => {
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  className={`flex-1 rounded-xl border px-4 py-3 items-center ${
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                  <Text
                    className={
                      active
                        ? 'text-primary font-semibold'
                        : 'text-gray-700 dark:text-gray-200 font-medium'
                    }>
                    {m === 'free' ? 'Free' : 'Paid'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'paid' ? (
            <View className="gap-1.5">
              <Text className="text-gray-700 dark:text-gray-200 text-sm font-medium">
                Store product that unlocks it
              </Text>
              <Pressable
                onPress={() => setPickerOpen(true)}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 flex-row items-center gap-2 active:opacity-70">
                <Text
                  className={
                    selectedProduct
                      ? 'flex-1 text-gray-900 dark:text-gray-50 text-base'
                      : 'flex-1 text-gray-400 dark:text-gray-500 text-base'
                  }>
                  {selectedProduct
                    ? `${selectedProduct.name} — ${productPriceLabel(selectedProduct, currency)}`
                    : 'No product linked'}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={colors.iconTertiary}
                />
              </Pressable>
              <Text className="text-gray-500 dark:text-gray-400 text-xs">
                The member buys (or subscribes to) this product in the store to
                unlock. Members whose membership plan includes individualized
                programming always have access.
              </Text>
            </View>
          ) : (
            <Text className="text-gray-500 dark:text-gray-400 text-xs">
              The member sees everything you programme for them, no purchase
              needed.
            </Text>
          )}

          {error ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </Text>
          ) : null}

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" onPress={onClose}>
                Cancel
              </Button>
            </View>
            <View className="flex-1">
              <Button
                onPress={() => save.mutate()}
                loading={save.isPending}
                success={saved}>
                Save
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}>
        <Pressable
          onPress={() => setPickerOpen(false)}
          className="flex-1 bg-black/60 items-center justify-center px-6">
          <Pressable
            onPress={() => {}}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 w-full max-w-md md:max-w-lg gap-3 max-h-[80vh]">
            <Text className="text-gray-900 dark:text-gray-50 text-lg font-semibold">
              Pick a product
            </Text>
            <ScrollView
              className="max-h-[60vh]"
              contentContainerClassName="gap-1">
              <Pressable
                onPress={() => {
                  setProductId(null);
                  setPickerOpen(false);
                }}
                className="rounded-lg px-3 py-3 active:bg-gray-100 dark:active:bg-gray-800">
                <Text className="text-gray-900 dark:text-gray-50">
                  No product
                </Text>
                <Text className="text-gray-500 dark:text-gray-400 text-xs">
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
                  className="rounded-lg px-3 py-3 active:bg-gray-100 dark:active:bg-gray-800">
                  <Text className="text-gray-900 dark:text-gray-50">
                    {p.name}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-xs">
                    {productPriceLabel(p, currency)}
                    {p.recurring ? ' · subscription' : ' · one-off'}
                  </Text>
                </Pressable>
              ))}
              {products.data && products.data.length === 0 ? (
                <Text className="text-gray-500 dark:text-gray-400 text-sm px-3 py-2">
                  No store products yet — add one in Manage → Store first.
                </Text>
              ) : null}
            </ScrollView>
            <Button variant="secondary" onPress={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}
