import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { InviteQRModal } from '@/components/InviteQRModal';
import { joinUrl } from '@/lib/brand';
import { useGymBrand } from '@/lib/useGymBrand';

// Walk-in QR for the front desk. Encodes the gym's public signup URL
// so a prospect can scan, land on the branded join page, and sign up
// as a member without any code being typed. The QR is rendered inline
// at thumbnail size so an owner can see-it-at-a-glance; tapping
// expands it to a full-size modal that's print/screenshot friendly.
//
// Public signup must be enabled or the URL would render "signup is
// closed". When off, we replace the QR with a notice pointing at the
// Branding screen where the flag is flipped.
export function WalkInQRCard({ bare = false }: { bare?: boolean } = {}) {
  const brand = useGymBrand();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.temple';
  const url = brand.slug ? joinUrl(origin, brand.slug) : null;

  function copy() {
    if (!url) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  if (!url) return null;

  return (
    <View
      className={
        bare
          ? 'gap-3'
          : 'bg-white dark:bg-gray-900 rounded-xl p-4 gap-3 border border-gray-200 dark:border-gray-800'
      }>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
          Walk-in sign-up QR
        </Text>
        {brand.publicSignupEnabled ? null : (
          <View className="rounded-full border border-amber-300 dark:border-amber-700 px-2 py-0.5">
            <Text className="text-amber-700 dark:text-amber-300 text-[10px] font-semibold uppercase tracking-wider">
              Off
            </Text>
          </View>
        )}
      </View>
      <Text className="text-gray-500 dark:text-gray-400 text-xs">
        {brand.publicSignupEnabled
          ? `Stick this on the front desk. A walk-in scans it, lands on the ${brand.gymName} signup page, and joins as a member.`
          : 'Public signup is off, so this QR would land on a "signup closed" page. Turn it on in Branding to use the walk-in QR.'}
      </Text>

      {brand.publicSignupEnabled ? (
        <View className="flex-row items-center gap-4 pt-1">
          <Pressable
            onPress={() => setOpen(true)}
            className="bg-white p-2 rounded-lg border border-gray-200 active:opacity-70">
            <QRCode value={url} size={96} />
          </Pressable>
          <View className="flex-1 gap-2">
            <ChipButton
              label="Show large"
              icon="qr-code-outline"
              onPress={() => setOpen(true)}
            />
            <ChipButton
              tone="neutral"
              label={copied ? 'Copied' : 'Copy link'}
              icon={copied ? 'checkmark' : 'copy-outline'}
              onPress={copy}
            />
          </View>
        </View>
      ) : (
        <View className="pt-1">
          <Button
            variant="secondary"
            onPress={() => router.push('/management/branding' as never)}>
            Open Branding settings
          </Button>
        </View>
      )}

      <InviteQRModal
        visible={open}
        onClose={() => setOpen(false)}
        title={`Join ${brand.gymName}`}
        subtitle="Scan to sign up as a member"
        url={url}
        primaryColor={brand.primaryColor}
      />
    </View>
  );
}
