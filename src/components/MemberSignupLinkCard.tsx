import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from './Text';
import QRCode from 'react-native-qrcode-svg';

import { ChipButton } from '@/components/ChipButton';
import { InviteQRModal } from '@/components/InviteQRModal';
import { joinUrl } from '@/lib/brand';
import { useGymBrand } from '@/lib/useGymBrand';

// Staff-facing sibling of GymShareCard. Surfaces the gym's public
// signup link in the Members tab so staff can hand it to walk-ins and
// prospects without hunting through settings. Now includes a
// scannable QR alongside the URL — same shape as the Walk-in QR card
// on the Team tab — so a prospect at the desk can scan straight from
// the staffer's screen instead of having to type a URL or wait for a
// share-sheet. When public signup is off there's no link to share, so
// we explain why and link to where it's flipped on instead.
export function MemberSignupLinkCard() {
  const brand = useGymBrand();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

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
    <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-ink dark:text-ink-dk font-semibold">
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
      <Text className="text-ink-2 dark:text-ink-2-dk text-xs">
        {brand.publicSignupEnabled
          ? `Share this link or have a walk-in scan the QR. They land on a branded join page and pick a plan.`
          : 'Public signup is turned off — anyone with this link will see "signup is closed." Turn it on in Settings → Branding.'}
      </Text>

      {brand.publicSignupEnabled ? (
        <View className="flex-row items-center gap-3">
          {/* QR thumbnail kept black-on-white for scan reliability,
              wrapped in a tappable so the whole patch opens the full
              modal. */}
          <Pressable
            onPress={() => setQrOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Show large QR"
            className="bg-white p-2 rounded-lg border border-line active:opacity-70">
            <QRCode value={url} size={88} />
          </Pressable>
          <View className="flex-1 gap-2">
            <View className="bg-raised dark:bg-raised-dk rounded-lg px-3 py-2">
              <Text
                className="text-ink-2 dark:text-ink-2-dk text-sm font-mono"
                numberOfLines={1}>
                {url}
              </Text>
            </View>
            <View className="flex-row gap-2 flex-wrap">
              <ChipButton
                label={copied ? 'Copied' : 'Copy'}
                icon={copied ? 'checkmark' : 'copy-outline'}
                onPress={copy}
              />
              <ChipButton
                label="Show large"
                icon="qr-code-outline"
                onPress={() => setQrOpen(true)}
              />
              <ChipButton
                tone="filled"
                label="Share"
                icon="share-outline"
                onPress={share}
              />
            </View>
          </View>
        </View>
      ) : (
        <View className="flex-row items-center gap-2 bg-raised dark:bg-raised-dk rounded-lg p-3">
          <Text
            className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm font-mono"
            numberOfLines={1}>
            {url}
          </Text>
          <ChipButton
            label={copied ? 'Copied' : 'Copy'}
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={copy}
          />
        </View>
      )}

      <InviteQRModal
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`Join ${brand.gymName}`}
        subtitle="Scan to sign up as a member"
        url={url}
      />
    </View>
  );
}
