// Whether the gym may text this member. Opt-in and off by default (0270):
// a text is more intrusive than an email, and paying for messages nobody
// asked for is the expensive way to learn that.
//
// The switch has to explain itself when it cannot be used, because two of
// the three reasons are not the member's fault and one of them they can
// fix. A member cannot read gym_agent_settings, so all three facts come
// from my_sms_readiness.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from 'react-native';

import { SettingCard } from './SettingCard';

import { useGymMembership } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type Readiness = {
  opted_in: boolean;
  has_phone: boolean;
  gym_can_text: boolean;
};

export function SmsOptInCard() {
  const { data: membership } = useGymMembership();
  const queryClient = useQueryClient();
  const gymId = membership?.gymId;

  const readiness = useQuery({
    queryKey: ['sms-readiness', gymId],
    enabled: !!gymId,
    queryFn: async (): Promise<Readiness | null> => {
      const { data, error } = await supabase.rpc('my_sms_readiness', {
        p_gym_id: gymId!,
      });
      if (error) throw error;
      return ((data ?? [])[0] as Readiness | undefined) ?? null;
    },
  });

  const flip = useMutation({
    mutationFn: async (next: boolean) => {
      if (!gymId) throw new Error('Missing context');
      const { error } = await supabase.rpc('set_my_sms_opt_in', {
        p_gym_id: gymId,
        p_value: next,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-readiness'] });
    },
  });

  // Nothing to offer until we know a text could actually arrive. A switch
  // that can never do anything is worse than no switch.
  if (!readiness.data?.gym_can_text) return null;

  const { opted_in, has_phone } = readiness.data;

  return (
    <SettingCard
      title="Text me"
      description={
        has_phone
          ? 'Get a message when something is worth knowing — a personal best, a payment that needs you. Never before 9am or after 8pm.'
          : 'Add your phone number above and save, then you can turn this on.'
      }
      control={
        <Switch
          accessibilityLabel="Text me"
          value={opted_in}
          onValueChange={(next) => flip.mutate(next)}
          disabled={!has_phone || flip.isPending}
        />
      }
    />
  );
}
