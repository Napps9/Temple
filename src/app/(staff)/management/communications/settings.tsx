import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { PageHead } from '@/components/PageHead';
import { SendingDomainCard } from '@/components/email/SendingDomainCard';
import { SuppressedAddressesCard } from '@/components/email/SuppressedAddressesCard';
import { TopicsCard } from '@/components/email/TopicsCard';
import { useGymMembership, useSession } from '@/lib/auth';
import { useCommsSettings, useSendingDomain } from '@/lib/comms';
import { errorMessage } from '@/lib/errors';
import { fromAddress } from '@/lib/sending-domain';
import { supabase } from '@/lib/supabase';
import { useGymBrand } from '@/lib/useGymBrand';
import { useSavedFlag } from '@/lib/useSavedFlag';

export default function CommsSettingsScreen() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const brand = useGymBrand();
  const settings = useCommsSettings();
  const sendingDomain = useSendingDomain();
  const queryClient = useQueryClient();
  const [saved, markSaved] = useSavedFlag();

  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [saveError, setSaveError] = useState<{
    card: 'sender' | 'footer';
    message: string;
  } | null>(null);

  // Seed once — the two cards save independently, so the refetch after
  // one card's save must not reseed (and wipe) the other card's edits.
  const seeded = useRef(false);
  useEffect(() => {
    if (!settings.data || seeded.current) return;
    seeded.current = true;
    setFromName(settings.data.from_name ?? '');
    setReplyTo(settings.data.reply_to ?? '');
    setBusinessName(settings.data.footer_business_name ?? '');
    setAddress(settings.data.footer_address ?? '');
  }, [settings.data]);

  // Per-card save. Upsert with only that card's columns: on conflict
  // PostgREST merges just the payload columns, so the other card's
  // stored values are untouched.
  const save = useMutation({
    mutationFn: async (card: 'sender' | 'footer') => {
      if (!membership?.gymId || !session?.user.id) throw new Error('No gym');
      const fields: Record<string, string | null> = {};
      if (card === 'sender') {
        const trimmedReply = replyTo.trim();
        if (trimmedReply && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedReply)) {
          throw new Error('Reply-to must be a valid email address');
        }
        fields.from_name = fromName.trim() || null;
        fields.reply_to = trimmedReply || null;
      } else {
        fields.footer_business_name = businessName.trim() || null;
        fields.footer_address = address.trim() || null;
      }
      const { error: upErr } = await supabase.from('gym_comms_settings').upsert(
        {
          gym_id: membership.gymId,
          ...fields,
          updated_by: session.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'gym_id' },
      );
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      setSaveError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['comms-settings'] });
    },
    onError: (e, card) =>
      setSaveError({ card, message: errorMessage(e, 'Could not save settings') }),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink fallbackHref="/management/communications" />
        <PageHead
          title="Email settings"
          subtitle="How your emails are addressed, the postal address every marketing email is legally required to carry, and what a member can unsubscribe from separately."
        />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Text className="text-ink dark:text-ink-dk font-semibold">Sender</Text>
          <Input
            label="From name"
            value={fromName}
            onChangeText={setFromName}
            autoCapitalize="words"
            placeholder={brand.gymName}
          />
          <Input
            label="Reply-to email (optional)"
            value={replyTo}
            onChangeText={setReplyTo}
            keyboardType="email-address"
            placeholder="hello@yourgym.com"
          />
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Replies from members go to this address. Leave blank to use your
            provider default.
          </Text>
          {saveError?.card === 'sender' ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {saveError.message}
            </Text>
          ) : null}
          <Button
            onPress={() => save.mutate('sender')}
            loading={save.isPending && save.variables === 'sender'}
            success={saved && save.variables === 'sender'}>
            Save
          </Button>
        </View>

        <SendingDomainCard />

        <View className="bg-surface dark:bg-surface-dk border border-line dark:border-line-dk rounded-card p-4 gap-3">
          <Text className="text-ink dark:text-ink-dk font-semibold">
            Footer
          </Text>
          <Input
            label="Business name"
            value={businessName}
            onChangeText={setBusinessName}
            autoCapitalize="words"
            placeholder={brand.gymName}
          />
          <Input
            label="Postal address"
            value={address}
            onChangeText={setAddress}
            placeholder="123 Main St, Springfield"
          />
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Shown in the footer alongside the unsubscribe link.
          </Text>
          {saveError?.card === 'footer' ? (
            <Text className="text-red-500 dark:text-red-400 text-sm">
              {saveError.message}
            </Text>
          ) : null}
          <Button
            onPress={() => save.mutate('footer')}
            loading={save.isPending && save.variables === 'footer'}
            success={saved && save.variables === 'footer'}>
            Save
          </Button>
        </View>

        {sendingDomain.data?.status === 'verified' ? (
          <View className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 gap-1">
            <Text className="text-green-700 dark:text-green-400 font-semibold text-sm">
              Delivery is live
            </Text>
            <Text className="text-green-700/90 dark:text-green-300/90 text-xs">
              Campaigns and invites send from{' '}
              <Text className="font-mono">{fromAddress(sendingDomain.data)}</Text>.
            </Text>
          </View>
        ) : (
          <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 gap-1">
            <Text className="text-amber-700 dark:text-amber-400 font-semibold text-sm">
              Delivery
            </Text>
            <Text className="text-amber-700/90 dark:text-amber-300/90 text-xs">
              Until you verify a sending domain above, sends are recorded as a
              simulation so you can build and review end-to-end. Verify a domain
              to send from your own address for real.
            </Text>
          </View>
        )}

        <SuppressedAddressesCard />

        <TopicsCard />
      </ScrollView>
    </Screen>
  );
}
