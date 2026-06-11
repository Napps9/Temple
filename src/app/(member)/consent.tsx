import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import {
  CONSENT_CLAUSES,
  CONSENT_POLICY_VERSION,
} from '@/lib/consent';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Onboarding gate: confirm identity (name + date of birth; email comes
// from the auth account), then capture data-processing consent. The
// member cannot reach the app until both are recorded — no consent, no
// entry. PAR-Q screening follows once this passes (the index gate
// chains consent → PAR-Q → app).
export default function ConsentForm() {
  const { data: membership } = useGymMembership();
  const session = useSession();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Pre-fill name + DOB from the existing profile if present.
  const profile = useQuery({
    queryKey: ['my-profile-onboarding', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('profiles')
        .select('full_name, date_of_birth')
        .eq('id', session!.user.id)
        .maybeSingle();
      if (e) throw e;
      return data as { full_name: string | null; date_of_birth: string | null } | null;
    },
  });

  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.full_name ?? '');
      setDob(profile.data.date_of_birth ?? '');
    }
  }, [profile.data]);

  const allTicked = CONSENT_CLAUSES.every((c) => ticked[c.key]);
  const validDob = /^\d{4}-\d{2}-\d{2}$/.test(dob);
  const canSubmit = fullName.trim().length > 0 && validDob && allTicked;

  const submit = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      // 1. Save identity (name + DOB) onto the profile.
      const { error: pErr } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), date_of_birth: dob })
        .eq('id', session!.user.id);
      if (pErr) throw pErr;

      // 2. Record consent for the active policy version.
      const { error: cErr } = await supabase.rpc('record_consent', {
        p_gym_id: membership.gymId,
        p_policy_version: CONSENT_POLICY_VERSION,
      });
      if (cErr) throw cErr;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['member-consent'] });
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      // Back to the index gate, which now sends them to PAR-Q (or the
      // app if screening isn't required).
      router.replace('/');
    },
    onError: (e) => setError(errorMessage(e, 'Could not save your details')),
  });

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerClassName="gap-5 py-6 px-4 md:max-w-xl md:mx-auto md:w-full">
        <View className="gap-1">
          <Text className="text-gray-900 dark:text-gray-50 text-2xl font-semibold">
            Welcome — let's get you set up
          </Text>
          <Text className="text-gray-500 dark:text-gray-400">
            A couple of details and your consent, then you're in.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Your details
          </Text>
          <Input
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            textContentType="name"
          />
          <DatePicker
            label="Date of birth"
            value={dob}
            onChange={setDob}
            max={new Date().toISOString().slice(0, 10)}
          />
          <Text className="text-gray-400 dark:text-gray-500 text-xs">
            Signed in as {session?.user.email}.
          </Text>
        </View>

        <View className="bg-white dark:bg-gray-900 rounded-xl p-4 gap-3">
          <Text className="text-gray-900 dark:text-gray-50 font-semibold">
            Consent
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-sm">
            Your gym needs your agreement before it can store any health
            information. You can withdraw it at any time from your
            account, which erases the data.
          </Text>
          {CONSENT_CLAUSES.map((c) => {
            const on = !!ticked[c.key];
            return (
              <Pressable
                key={c.key}
                onPress={() => setTicked((t) => ({ ...t, [c.key]: !on }))}
                className="flex-row items-start gap-3 active:opacity-70">
                <View
                  className={`w-6 h-6 rounded-md items-center justify-center mt-0.5 ${
                    on
                      ? 'bg-primary'
                      : 'border border-gray-300 dark:border-gray-600'
                  }`}>
                  {on ? (
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                  ) : null}
                </View>
                <Text className="flex-1 text-gray-700 dark:text-gray-200 text-sm">
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <Text className="text-red-500 dark:text-red-400 text-sm">{error}</Text>
        ) : null}

        <Button
          onPress={() => submit.mutate()}
          loading={submit.isPending}
          disabled={!canSubmit}>
          Agree & continue
        </Button>
        {!canSubmit ? (
          <Text className="text-gray-400 dark:text-gray-500 text-xs text-center">
            Add your name + date of birth and tick all three to continue.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
