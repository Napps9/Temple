import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { PageHead } from '@/components/PageHead';
import { Text } from '@/components/Text';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ImageGalleryModal } from '@/components/ImageGalleryModal';
import { PillNav } from '@/components/PillNav';
import { Screen } from '@/components/Screen';
import { Sheet, SheetAction } from '@/components/Sheet';
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
import {
  addToBag,
  bagCount,
  bagLines,
  clearBag,
  setBagQuantity,
  subscribeBag,
} from '@/lib/store-bag';
import { useThemeColors } from '@/lib/theme';
import { useGymBrand } from '@/lib/useGymBrand';

// The selected aisle survives leaving the tab; the bag itself lives in
// lib/store-bag (session-only, like every other view memory).
let lastStoreAisle = 'all';

function useBagCount(): number {
  return useSyncExternalStore(subscribeBag, bagCount, bagCount);
}

export default function StoreScreen() {
  const colors = useThemeColors();
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const config = useGymStoreConfig(membership?.gymId);
  const products = useStoreProducts(membership?.gymId);
  const subs = useMyStoreSubscriptions(membership?.gymId, session?.user.id);
  const checkout = useStartStoreCheckout(membership?.gymId);
  const params = useLocalSearchParams<{ checkout?: string; product?: string }>();

  const [aisle, setAisleState] = useState(lastStoreAisle);
  const setAisle = (next: string) => {
    lastStoreAisle = next;
    setAisleState(next);
  };
  // ?product= deep-links a product open (and lets the harness photograph
  // the sheet); read once on mount so it doesn't fight later taps.
  const [openId, setOpenId] = useState<string | null>(
    typeof params.product === 'string' ? params.product : null,
  );
  const [bagOpen, setBagOpen] = useState(false);
  const inBag = useBagCount();

  // Stripe bounced us back paid: the bag's contents are bought.
  useEffect(() => {
    if (params.checkout === 'success') clearBag();
  }, [params.checkout]);

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

  const categories = [
    ...new Set(
      list
        .map((p) => p.category?.trim())
        .filter((c): c is string => !!c && c.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const activeAisle =
    aisle === 'all' || categories.includes(aisle) ? aisle : 'all';
  const shown =
    activeAisle === 'all'
      ? list
      : list.filter((p) => p.category?.trim() === activeAisle);

  const openProduct = list.find((p) => p.id === openId) ?? null;

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-4 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/account" />

        <PageHead
          title="Store"
          subtitle={brand.gymName}
          action={
            <View className="flex-row items-center gap-3">
              <Link href="/purchases" asChild>
                <Pressable
                  hitSlop={8}
                  className="flex-row items-center gap-1 active:opacity-70">
                  <Ionicons
                    name="receipt-outline"
                    size={18}
                    color={colors.ink2}
                  />
                  <Text className="text-ink-2 dark:text-ink-2-dk text-sm font-medium">
                    Purchases
                  </Text>
                </Pressable>
              </Link>
              {inBag > 0 ? (
                <Pressable
                  onPress={() => setBagOpen(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Open bag, ${inBag} items`}
                  className="flex-row items-center gap-1 bg-primary active:bg-primary-dark rounded-full px-3 py-1.5">
                  <Ionicons
                    name="bag-handle-outline"
                    size={15}
                    color={colors.onPrimary}
                  />
                  <Text className="text-on-primary text-xs font-semibold">
                    Bag · {inBag}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
        />

        {params.checkout === 'success' ? (
          <View className="bg-green-50 dark:bg-green-950/40 rounded-card p-3">
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
          <View className="bg-amber-50 dark:bg-amber-950/40 rounded-card p-3">
            <Text className="text-amber-800 dark:text-amber-300 text-sm">
              Checkout cancelled — nothing was charged.
            </Text>
          </View>
        ) : null}

        {checkout.error ? (
          <View className="bg-red-50 dark:bg-red-950/40 rounded-card p-3">
            <Text className="text-red-700 dark:text-red-300 text-sm">
              {errorMessage(checkout.error, 'Could not start checkout')}
            </Text>
          </View>
        ) : null}

        {config.data && !config.data.store_enabled ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">
            The store isn't open at {brand.gymName} right now. Check back soon.
          </Text>
        ) : products.isLoading ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">Loading…</Text>
        ) : list.length === 0 ? (
          <Text className="text-ink-2 dark:text-ink-2-dk">
            Nothing in the store yet.
          </Text>
        ) : (
          <>
            {categories.length > 0 ? (
              <PillNav
                items={[
                  { key: 'all', label: 'All' },
                  ...categories.map((c) => ({ key: c, label: c })),
                ]}
                active={activeAisle}
                onSelect={setAisle}
              />
            ) : null}

            {hasPhysical && shippingFee > 0 ? (
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                {formatMoney(shippingFee, currency)} shipping is added to orders
                with a physical item.
              </Text>
            ) : null}

            <View className="flex-row flex-wrap -m-1.5">
              {shown.map((p) => (
                <View key={p.id} className="w-1/2 md:w-1/3 p-1.5">
                  <GridCard
                    product={p}
                    currency={currency}
                    subscribed={subscribedIds.has(p.id)}
                    onPress={() => setOpenId(p.id)}
                  />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <ProductSheet
        product={openProduct}
        currency={currency}
        subscribed={openProduct ? subscribedIds.has(openProduct.id) : false}
        pending={checkout.isPending}
        onClose={() => setOpenId(null)}
        onBuyNow={(qty) => {
          if (!openProduct) return;
          checkout.mutate([{ product_id: openProduct.id, quantity: qty }]);
        }}
        onAddToBag={(qty) => {
          if (!openProduct) return;
          addToBag(openProduct.id, qty);
          setOpenId(null);
        }}
      />

      <BagSheet
        visible={bagOpen}
        products={list}
        currency={currency}
        shippingFee={shippingFee}
        pending={checkout.isPending}
        onClose={() => setBagOpen(false)}
        onCheckout={() => checkout.mutate(bagLines())}
      />
    </Screen>
  );
}

function coverImage(p: StoreProduct): string | null {
  const images = productImages(p);
  return images[0] ?? null;
}

function priceLabelFor(p: StoreProduct, currency: string): string {
  return p.recurring
    ? `${formatMoney(p.price_cents, currency)}${intervalSuffix(
        p.recurring_interval ?? 'month',
      )}`
    : formatMoney(p.price_cents, currency);
}

function GridCard({
  product,
  currency,
  subscribed,
  onPress,
}: {
  product: StoreProduct;
  currency: string;
  subscribed: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const cover = coverImage(product);
  const status = subscribed
    ? 'Subscribed'
    : product.sold_out
      ? 'Sold out'
      : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${priceLabelFor(product, currency)}`}
      className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card overflow-hidden active:opacity-80">
      {cover ? (
        <Image source={{ uri: cover }} className="w-full h-36" resizeMode="cover" />
      ) : (
        <View className="w-full h-36 bg-raised dark:bg-raised-dk items-center justify-center">
          <Ionicons
            name={product.kind === 'digital' ? 'document-outline' : 'shirt-outline'}
            size={28}
            color={colors.ink3}
          />
        </View>
      )}
      <View className="p-3 gap-0.5">
        <Text
          numberOfLines={1}
          className="text-ink dark:text-ink-dk font-semibold text-sm">
          {product.name}
        </Text>
        <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
          {priceLabelFor(product, currency)}
          {status ? ` · ${status}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

function maxQuantityFor(p: StoreProduct): number {
  if (p.sold_out) return 0;
  if (p.track_inventory) return Math.min(p.stock_quantity ?? 1, 99);
  // An unlimited download is a one-per-member buy; other untracked goods
  // can be bought in multiples.
  return p.kind === 'digital' ? 1 : 99;
}

function QuantityStepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center rounded-ctl border border-line dark:border-line-dk self-start">
      <Pressable
        onPress={() => onChange(Math.max(1, value - 1))}
        hitSlop={6}
        accessibilityLabel="Fewer"
        className="px-3 py-2 active:opacity-60">
        <Ionicons name="remove" size={16} color={colors.ink2} />
      </Pressable>
      <Text className="text-ink dark:text-ink-dk w-8 text-center">{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        hitSlop={6}
        accessibilityLabel="More"
        className="px-3 py-2 active:opacity-60">
        <Ionicons name="add" size={16} color={colors.ink2} />
      </Pressable>
    </View>
  );
}

function ProductSheet({
  product,
  currency,
  subscribed,
  pending,
  onClose,
  onBuyNow,
  onAddToBag,
}: {
  product: StoreProduct | null;
  currency: string;
  subscribed: boolean;
  pending: boolean;
  onClose: () => void;
  onBuyNow: (qty: number) => void;
  onAddToBag: (qty: number) => void;
}) {
  const [qty, setQty] = useState(1);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Reset the quantity when a different product opens.
  useEffect(() => setQty(1), [product?.id]);

  if (!product) {
    return (
      <Sheet visible={false} title="" onClose={onClose}>
        <View />
      </Sheet>
    );
  }

  const images = productImages(product);
  const max = maxQuantityFor(product);
  const clamped = Math.min(qty, Math.max(1, max));
  const kindLine = product.recurring
    ? product.kind === 'physical'
      ? 'Monthly box'
      : 'Subscription'
    : product.kind === 'digital'
      ? 'Digital download'
      : 'Ships to you';
  // A subscription in a bag would be a lie (it starts a recurring charge,
  // not a line item), and a download is one-per-member — both stay
  // buy-now-only.
  const baggable = !product.recurring && product.kind === 'physical' && max > 0;

  return (
    <Sheet
      visible
      title={product.name}
      subtitle={`${priceLabelFor(product, currency)} · ${kindLine}`}
      onClose={onClose}
      actions={
        product.recurring ? (
          <SheetAction grow>
            {subscribed ? (
              <Button variant="secondary" disabled onPress={() => {}}>
                Subscribed
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="repeat-outline"
                loading={pending}
                onPress={() => onBuyNow(1)}>
                Subscribe
              </Button>
            )}
          </SheetAction>
        ) : product.sold_out ? (
          <SheetAction grow>
            <Button variant="secondary" disabled onPress={() => {}}>
              Sold out
            </Button>
          </SheetAction>
        ) : (
          <>
            {baggable ? (
              <SheetAction grow>
                <Button
                  variant="secondary"
                  icon="bag-add-outline"
                  onPress={() => onAddToBag(clamped)}>
                  Add to bag
                </Button>
              </SheetAction>
            ) : null}
            <SheetAction grow>
              <Button
                variant="primary"
                icon="card-outline"
                loading={pending}
                onPress={() => onBuyNow(clamped)}>
                Buy now
              </Button>
            </SheetAction>
          </>
        )
      }>
      <View className="gap-3 pb-1">
        {images.length > 0 ? (
          <Pressable
            onPress={() => setGalleryOpen(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel="View photos">
            <Image
              source={{ uri: images[0] }}
              className="w-full h-44 rounded-ctl"
              resizeMode="cover"
            />
            {images.length > 1 ? (
              <View className="absolute bottom-2 right-2 bg-black/60 rounded-full px-2 py-0.5">
                <Text className="text-white text-[10px] font-semibold">
                  {images.length} photos
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        <ImageGalleryModal
          visible={galleryOpen}
          images={images}
          initialIndex={0}
          onClose={() => setGalleryOpen(false)}
        />

        {product.description ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            {product.description}
          </Text>
        ) : null}

        {!product.recurring && product.track_inventory && !product.sold_out ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            {product.stock_quantity} left
          </Text>
        ) : null}

        {baggable && max > 1 ? (
          <QuantityStepper value={clamped} max={max} onChange={setQty} />
        ) : null}
      </View>
    </Sheet>
  );
}

function BagSheet({
  visible,
  products,
  currency,
  shippingFee,
  pending,
  onClose,
  onCheckout,
}: {
  visible: boolean;
  products: StoreProduct[];
  currency: string;
  shippingFee: number;
  pending: boolean;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const inBag = useBagCount();
  const lines = bagLines()
    .map((l) => ({
      line: l,
      product: products.find((p) => p.id === l.product_id) ?? null,
    }))
    .filter(
      (x): x is { line: { product_id: string; quantity: number }; product: StoreProduct } =>
        x.product !== null,
    );
  const subtotal = lines.reduce(
    (sum, x) => sum + x.product.price_cents * x.line.quantity,
    0,
  );
  const hasPhysical = lines.some((x) => x.product.kind === 'physical');

  return (
    <Sheet
      visible={visible}
      title="Your bag"
      subtitle={
        inBag > 0
          ? `${inBag} ${inBag === 1 ? 'item' : 'items'}`
          : 'Nothing in it yet'
      }
      onClose={onClose}
      actions={
        inBag > 0 ? (
          <SheetAction grow>
            <Button
              variant="primary"
              icon="card-outline"
              loading={pending}
              onPress={onCheckout}>
              {`Checkout — ${formatMoney(
                subtotal + (hasPhysical ? shippingFee : 0),
                currency,
              )}`}
            </Button>
          </SheetAction>
        ) : undefined
      }>
      <View className="gap-3 pb-1">
        {lines.length === 0 ? (
          <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
            Tap a product and add it to your bag — checkout takes everything
            in one payment.
          </Text>
        ) : (
          lines.map(({ line, product }) => (
            <View key={product.id} className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text
                  numberOfLines={1}
                  className="text-ink dark:text-ink-dk font-medium">
                  {product.name}
                </Text>
                <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
                  {formatMoney(product.price_cents * line.quantity, currency)}
                </Text>
              </View>
              <QuantityStepper
                value={line.quantity}
                max={maxQuantityFor(product)}
                onChange={(next) => setBagQuantity(product.id, next)}
              />
              <Pressable
                onPress={() => setBagQuantity(product.id, 0)}
                hitSlop={8}
                accessibilityLabel={`Remove ${product.name}`}
                className="active:opacity-60">
                <Ionicons name="trash-outline" size={16} color="#DC2626" />
              </Pressable>
            </View>
          ))
        )}
        {lines.length > 0 && hasPhysical && shippingFee > 0 ? (
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Includes {formatMoney(shippingFee, currency)} shipping for the
            physical items.
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}
