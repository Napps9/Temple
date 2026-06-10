import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { ChipButton } from '@/components/ChipButton';
import { joinUrl } from '@/lib/brand';
import { useGymBrand } from '@/lib/useGymBrand';

// Staff-facing sibling of GymShareCard. Surfaces the gym's public
// signup link in the Members tab so staff can hand it to walk-ins and
// prospects without hunting through settings. When public signup is
// off there's no link to share, so we explain why and link to where
// it's flipped on instead.
export function MemberSignupLinkCard() {
  const brand = useGymBrand();
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

  // Web Share API on mobile Safari / Android opens the OS share sheet
  // (Messages, WhatsApp, email...). Falls back to copy on desktop.
  function share() {
    if (!url) return;
    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      typeof (navigator as Navigator & { share?: (d: ShareData) => Promise<void> })
        .share === 'function'
    ) {
      (navigator as Navigator & { share: (d: ShareData) => Promise<void> })
        .share({
          title: `Join ${brand.gymName}`,
          text: `Sign up for ${brand.gymName}`,
          url,
        })
        .catch(() => {});
    } else {
      copy();
    }
  }

  if (!url) return null;

  return (
    <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-gray-900 dark:text-gray-50 font-semibold">
          Signup link
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
          ? `Share this link to bring someone new into ${brand.gymName}. They land on a branded join page and pick a plan.`
          : 'Public signup is turned off — anyone with this link will see "signup is closed." Turn it on in Settings → Branding.'}
      </Text>
      <View className="flex-row items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
        <Text
          className="flex-1 text-gray-700 dark:text-gray-200 text-sm font-mono"
          numberOfLines={1}>
          {url}
        </Text>
        <ChipButton
          label={copied ? 'Copied' : 'Copy'}
          icon={copied ? 'checkmark' : 'copy-outline'}
          onPress={copy}
        />
        <ChipButton
          tone="filled"
          label="Share"
          icon="share-outline"
          onPress={share}
        />
      </View>
    </View>
  );
}
