import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { BackLink } from '@/components/BackLink';
import { SendingDomainCard } from '@/components/email/SendingDomainCard';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setFromName(settings.data.from_name ?? '');
      setReplyTo(settings.data.reply_to ?? '');
      setBusinessName(settings.data.footer_business_name ?? '');
      setAddress(settings.data.footer_address ?? '');
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!membership?.gymId || !session?.user.id) throw new Error('No gym');
      const trimmedReply = replyTo.trim();
      if (trimmedReply && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedReply)) {
        throw new Error('Reply-to must be a valid email address');
      }
      const { error: upErr } = await supabase.from('gym_comms_settings').upsert(
        {
          gym_id: membership.gymId,
          from_name: fromName.trim() || null,
          reply_to: trimmedReply || null,
          footer_business_name: businessName.trim() || null,
          footer_address: address.trim() || null,
          updated_by: session.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'gym_id' },
      );
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      setError(null);
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['comms-settings'] });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save settings')),
  });

  return (
    <Screen edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-2xl md:mx-auto md:w-full">
        <BackLink label="Email campaigns" />
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Sender & footer
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            How your emails are addressed, and the postal address every
            marketing email is legally required to carry.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">Sender</Text>
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
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Replies from members go to this address. Leave blank to use your
            provider default.
          </Text>
        </View>

        <SendingDomainCard />

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
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
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Shown in the footer alongside the unsubscribe link.
          </Text>
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

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}
        <Button onPress={() => save.mutate()} loading={save.isPending} success={saved}>
          Save settings
        </Button>
      </ScrollView>
    </Screen>
  );
}
