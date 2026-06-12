import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';

// Reusable modal that displays a big, scannable QR for any URL — the
// walk-in signup link and per-invite-code links share the same shell
// so the visual is consistent. QR stays black-on-white for maximum
// scan reliability; the gym's primary colour is used in the surround
// (header bar) so the card still feels branded.

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  url: string;
  primaryColor: string;
};

export function InviteQRModal({
  visible,
  onClose,
  title,
  subtitle,
  url,
  primaryColor,
}: Props) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

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
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md overflow-hidden">
          <View
            style={{ backgroundColor: primaryColor }}
            className="px-5 py-4">
            <Text className="text-white font-semibold text-lg">{title}</Text>
            {subtitle ? (
              <Text className="text-white/80 text-xs mt-0.5">{subtitle}</Text>
            ) : null}
          </View>

          <View className="p-5 gap-4 items-center">
            <View className="bg-white p-3 rounded-xl border border-gray-200">
              <QRCode value={url} size={240} />
            </View>

            <View className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 w-full">
              <Text
                className="text-gray-700 dark:text-gray-200 text-xs font-mono"
                numberOfLines={2}>
                {url}
              </Text>
            </View>

            <View className="flex-row gap-2 self-stretch">
              <ChipButton
                label={copied ? 'Copied' : 'Copy link'}
                icon={copied ? 'checkmark' : 'copy-outline'}
                onPress={copy}
              />
              <View className="flex-1" />
              <Button variant="secondary" onPress={onClose}>
                Done
              </Button>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
