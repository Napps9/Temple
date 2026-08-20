import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/Button';
import { ChipButton } from '@/components/ChipButton';
import { Sheet, SheetAction } from '@/components/Sheet';

// Reusable modal that displays a big, scannable QR for any URL — the
// walk-in signup link and per-invite-code links share the same shell
// so the visual is consistent. QR stays black-on-white for maximum
// scan reliability whatever the scheme, which is why the code sits on
// its own white plate rather than on the sheet's surface.

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  url: string;
};

export function InviteQRModal({ visible, onClose, title, subtitle, url }: Props) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <Sheet
      visible={visible}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      actions={
        <>
          <SheetAction>
            <ChipButton
              label={copied ? 'Copied' : 'Copy link'}
              icon={copied ? 'checkmark' : 'copy-outline'}
              onPress={copy}
            />
          </SheetAction>
          <SheetAction grow>
            <Button variant="secondary" onPress={onClose}>
              Done
            </Button>
          </SheetAction>
        </>
      }>
      <View className="gap-3 items-center pb-1">
        <View className="bg-white p-3 rounded-card border border-line">
          <QRCode value={url} size={228} />
        </View>
        <View className="bg-raised dark:bg-raised-dk rounded-ctl px-3 py-2 w-full">
          <Text
            className="text-ink-2 dark:text-ink-2-dk text-[12px] font-mono"
            numberOfLines={2}>
            {url}
          </Text>
        </View>
      </View>
    </Sheet>
  );
}
