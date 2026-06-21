import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useGymMembership } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import {
  useGymStoreConfig,
  useStartStoreCheckout,
  useStoreProducts,
  type StoreProduct,
} from '@/lib/store';
import { useGymBrand } from '@/lib/useGymBrand';

export default function StoreScreen() {
  const { data: membership } = useGymMembership();
  const brand = useGymBrand();
  const config = useGymStoreConfig(membership?.gymId);
  const products = useStoreProducts(membership?.gymId);
  const checkout = useStartStoreCheckout(membership?.gymId);
  const params = useLocalSearchParams<{ checkout?: string }>();

  const currency = config.data?.currency ?? 'GBP';
  const shippingFee = config.data?.store_shipping_fee_cents ?? 0;
  const list = products.data ?? [];
  const hasPhysical = list.some((p) => p.kind === 'physical');

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Account" fallbackHref="/account" />

        <View className="flex-row items-center gap-3">
          {brand.logoUrl ? (
            <Image
              source={{ uri: brand.logoUrl }}
              className="w-10 h-10 rounded-lg"
              resizeMode="contain"
            />
          ) : null}
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
              Store
            </Text>
            <Text className="text-gray-500 dark:text-gray-400">
              {brand.gymName}
            </Text>
          </View>
          <Link href="/purchases" asChild>
            <Pressable
              hitSlop={8}
              className="flex-row items-center gap-1 active:opacity-70">
              <Ionicons name="bag-handle-outline" size={18} color={brand.primaryColor} />
              <Text className="text-primary text-sm font-medium">Purchases</Text>
            </Pressable>
          </Link>
        </View>

        {params.checkout === 'success' ? (
          <View className="bg-green-50 dark:bg-green-950/40 rounded-xl p-3">
            <Text className="text-green-800 dark:text-green-300 text-sm">
              Payment received — thanks! Your receipt is on its way by email.
              See it under{' '}
              <Link href="/purchases" className="underline">
                Purchases
              </Link>
              .
            </Text>
          </View>
        ) : params.checkout === 'cancelled' ? (
          <View className="bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3">
            <Text className="text-amber-800 dark:text-amber-300 text-sm">
              Checkout cancelled — nothing was charged.
            </Text>
          </View>
        ) : null}

        {checkout.error ? (
          <View className="bg-red-50 dark:bg-red-950/40 rounded-xl p-3">
            <Text className="text-red-700 dark:text-red-300 text-sm">
              {errorMessage(checkout.error, 'Could not start checkout')}
            </Text>
          </View>
        ) : null}

        {config.data && !config.data.store_enabled ? (
          <Text className="text-gray-500 dark:text-gray-400">
            The store isn't open at {brand.gymName} right now. Check back soon.
          </Text>
        ) : products.isLoading ? (
          <Text className="text-gray-500 dark:text-gray-400">Loading…</Text>
        ) : list.length === 0 ? (
          <Text className="text-gray-500 dark:text-gray-400">
            Nothing in the store yet.
          </Text>
        ) : (
          <>
            {hasPhysical && shippingFee > 0 ? (
              <Text className="text-gray-400 dark:text-gray-500 text-xs">
                {formatMoney(shippingFee, currency)} shipping is added to orders
                with a physical item.
              </Text>
            ) : null}
            <View className="gap-3">
              {list.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  currency={currency}
                  pending={checkout.isPending}
                  onBuy={(quantity) =>
                    checkout.mutate([{ product_id: p.id, quantity }])
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function maxQuantityFor(p: StoreProduct): number {
  if (p.sold_out) return 0;
  if (p.track_inventory) return Math.min(p.stock_quantity ?? 1, 99);
  // An unlimited download is a one-per-member buy; other untracked goods
  // can be bought in multiples.
  return p.kind === 'digital' ? 1 : 99;
}

function ProductCard({
  product,
  currency,
  pending,
  onBuy,
}: {
  product: StoreProduct;
  currency: string;
  pending: boolean;
  onBuy: (quantity: number) => void;
}) {
  const max = maxQuantityFor(product);
  const [qty, setQty] = useState(1);
  const clamped = Math.min(qty, Math.max(1, max));

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-card">
      {product.image_url ? (
        <Image
          source={{ uri: product.image_url }}
          className="w-full h-44"
          resizeMode="cover"
        />
      ) : null}
      <View className="p-4 gap-2">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
              {product.name}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
              {product.kind === 'digital' ? 'Digital download' : 'Ships to you'}
              {product.track_inventory && !product.sold_out
                ? ` · ${product.stock_quantity} left`
                : ''}
            </Text>
          </View>
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {formatMoney(product.price_cents, currency)}
          </Text>
        </View>

        {product.description ? (
          <Text className="text-gray-600 dark:text-gray-300 text-sm">
            {product.description}
          </Text>
        ) : null}

        {product.sold_out ? (
          <View className="self-start px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mt-1">
            <Text className="text-gray-500 dark:text-gray-400 text-sm font-medium">
              Sold out
            </Text>
          </View>
        ) : (
          <View className="flex-row items-center gap-3 mt-1">
            {max > 1 ? (
              <View className="flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700">
                <Pressable
                  onPress={() => setQty((q) => Math.max(1, q - 1))}
                  hitSlop={6}
                  className="px-3 py-2 active:opacity-60">
                  <Ionicons name="remove" size={16} color="#6B7280" />
                </Pressable>
                <Text className="text-gray-900 dark:text-gray-50 w-8 text-center">
                  {clamped}
                </Text>
                <Pressable
                  onPress={() => setQty((q) => Math.min(max, q + 1))}
                  hitSlop={6}
                  className="px-3 py-2 active:opacity-60">
                  <Ionicons name="add" size={16} color="#6B7280" />
                </Pressable>
              </View>
            ) : null}
            <View className="flex-1">
              <Button
                onPress={() => onBuy(clamped)}
                loading={pending}
                icon="card-outline">
                Buy
              </Button>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
