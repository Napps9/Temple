import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ImageGalleryModal } from '@/components/ImageGalleryModal';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import { formatMoney } from '@/lib/coach-earnings';
import { errorMessage } from '@/lib/errors';
import {
  intervalSuffix,
  productImages,
  useGymStoreConfig,
  useMyStoreSubscriptions,
  useStartStoreCheckout,
  useStoreProducts,
  type StoreProduct,
} from '@/lib/store';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

export default function StoreScreen() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const config = useGymStoreConfig(membership?.gymId);
  const products = useStoreProducts(membership?.gymId);
  const subs = useMyStoreSubscriptions(membership?.gymId, session?.user.id);
  const checkout = useStartStoreCheckout(membership?.gymId);
  const params = useLocalSearchParams<{ checkout?: string }>();

  const currency = config.data?.currency ?? 'GBP';
  const shippingFee = config.data?.store_shipping_fee_cents ?? 0;
  const list = products.data ?? [];
  const hasPhysical = list.some((p) => p.kind === 'physical');
  // A past_due subscription is still live (Stripe is retrying the card), so
  // it counts as subscribed — otherwise the member could start a duplicate.
  const subscribedIds = new Set(
    (subs.data ?? [])
      .filter((s) => s.status !== 'cancelled' && s.product_id)
      .map((s) => s.product_id as string),
  );

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/account" />

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
                  alreadySubscribed={subscribedIds.has(p.id)}
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

// Product photos: a single cover, or a swipeable carousel with dots when
// there's more than one. Tapping any image opens the full-screen gallery.
function ProductImages({
  images,
  onOpen,
}: {
  images: string[];
  onOpen: (index: number) => void;
}) {
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);

  if (images.length === 0) return null;
  if (images.length === 1) {
    return (
      <Pressable
        onPress={() => onOpen(0)}
        accessibilityRole="imagebutton"
        accessibilityLabel="View photo">
        <Image
          source={{ uri: images[0] }}
          className="w-full h-44"
          resizeMode="cover"
        />
      </Pressable>
    );
  }

  return (
    <View
      className="relative"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          if (w <= 0) return;
          const p = Math.round(e.nativeEvent.contentOffset.x / w);
          if (p !== page) setPage(p);
        }}>
        {images.map((uri, i) => (
          <Pressable
            key={`${uri}-${i}`}
            onPress={() => onOpen(i)}
            style={{ width: w }}
            accessibilityRole="imagebutton"
            accessibilityLabel={`View photo ${i + 1} of ${images.length}`}>
            <Image
              source={{ uri }}
              style={{ width: w, height: 176 }}
              resizeMode="cover"
            />
          </Pressable>
        ))}
      </ScrollView>
      <View
        pointerEvents="none"
        className="absolute bottom-2 left-0 right-0 flex-row justify-center gap-1.5">
        {images.map((_, i) => (
          <View
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${
              i === page ? 'bg-white' : 'bg-white/50'
            }`}
          />
        ))}
      </View>
    </View>
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
  alreadySubscribed,
  onBuy,
}: {
  product: StoreProduct;
  currency: string;
  pending: boolean;
  alreadySubscribed: boolean;
  onBuy: (quantity: number) => void;
}) {
  const colors = useThemeColors();
  const max = maxQuantityFor(product);
  const [qty, setQty] = useState(1);
  const images = productImages(product);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryStart, setGalleryStart] = useState(0);
  const clamped = Math.min(qty, Math.max(1, max));
  const priceLabel = product.recurring
    ? `${formatMoney(product.price_cents, currency)}${intervalSuffix(
        product.recurring_interval ?? 'month',
      )}`
    : formatMoney(product.price_cents, currency);
  const subtitle = product.recurring
    ? product.kind === 'physical'
      ? 'Monthly box'
      : 'Subscription'
    : product.kind === 'digital'
      ? 'Digital download'
      : 'Ships to you';

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-card">
      <ProductImages
        images={images}
        onOpen={(i) => {
          setGalleryStart(i);
          setGalleryOpen(true);
        }}
      />
      <ImageGalleryModal
        visible={galleryOpen}
        images={images}
        initialIndex={galleryStart}
        onClose={() => setGalleryOpen(false)}
      />
      <View className="p-4 gap-2">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-gray-900 dark:text-gray-50 font-semibold text-base">
              {product.name}
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
              {subtitle}
              {!product.recurring && product.track_inventory && !product.sold_out
                ? ` · ${product.stock_quantity} left`
                : ''}
            </Text>
          </View>
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            {priceLabel}
          </Text>
        </View>

        {product.description ? (
          <Text className="text-gray-600 dark:text-gray-300 text-sm">
            {product.description}
          </Text>
        ) : null}

        {product.recurring ? (
          alreadySubscribed ? (
            <View className="self-start px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-950/50 mt-1">
              <Text className="text-green-700 dark:text-green-300 text-sm font-medium">
                Subscribed
              </Text>
            </View>
          ) : (
            <View className="mt-1">
              <Button
                onPress={() => onBuy(1)}
                loading={pending}
                icon="repeat-outline">
                Subscribe
              </Button>
            </View>
          )
        ) : product.sold_out ? (
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
                  <Ionicons name="remove" size={16} color={colors.iconSecondary} />
                </Pressable>
                <Text className="text-gray-900 dark:text-gray-50 w-8 text-center">
                  {clamped}
                </Text>
                <Pressable
                  onPress={() => setQty((q) => Math.min(max, q + 1))}
                  hitSlop={6}
                  className="px-3 py-2 active:opacity-60">
                  <Ionicons name="add" size={16} color={colors.iconSecondary} />
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
