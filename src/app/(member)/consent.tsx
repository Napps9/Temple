import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';

import { Button } from '@/components/Button';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { useGymMembership, useSession } from '@/lib/auth';
import {
  CONSENT_CLAUSES,
  CONSENT_POLICY_VERSION,
  isMinor,
} from '@/lib/consent';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useGymAllowMinors } from '@/lib/useGymAllowMinors';

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
  const [guardianName, setGuardianName] = useState('');
  const [guardianContact, setGuardianContact] = useState('');
  const [guardianAck, setGuardianAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowMinors = useGymAllowMinors();

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
  const under18 = validDob && isMinor(dob);
  // Gym hasn't opted in to minors → this member can't proceed here.
  const minorBlocked = under18 && !allowMinors;
  const guardianValid =
    !under18 ||
    (guardianName.trim().length > 0 &&
      guardianContact.trim().length > 0 &&
      guardianAck);
  const canSubmit =
    fullName.trim().length > 0 &&
    validDob &&
    allTicked &&
    guardianValid &&
    !minorBlocked;

  const submit = useMutation({
    mutationFn: async () => {
      if (!membership) throw new Error('No gym');
      // 1. Save identity (name + DOB) onto the profile.
      const { error: pErr } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), date_of_birth: dob })
        .eq('id', session!.user.id);
      if (pErr) throw pErr;

      // 2. Record consent for the active policy version, carrying guardian
      // details for an under-18 member (the server also re-checks age +
      // the gym's allow_minors opt-in).
      const { error: cErr } = await supabase.rpc('record_consent', {
        p_gym_id: membership.gymId,
        p_policy_version: CONSENT_POLICY_VERSION,
        ...(under18
          ? {
              p_guardian_name: guardianName.trim(),
              p_guardian_contact: guardianContact.trim(),
            }
          : {}),
      });
      if (cErr) throw cErr;
    },
    onSuccess: async () => {
      setError(null);
      // Await the refetch before navigating. The index consent gate reads
      // ['member-consent'] on its very next render; a fire-and-forget
      // invalidate leaves it holding the stale not-consented row, so it
      // bounces straight back here, remounts the form, and clears the
      // ticked boxes — the "had to do it twice" reset. Refetch-and-await
      // mirrors refreshMembership, which exists for this exact hazard.
      await queryClient.refetchQueries({ queryKey: ['member-consent'] });
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
          <Text className="text-ink dark:text-ink-dk text-2xl font-semibold">
            Welcome — let's get you set up
          </Text>
          <Text className="text-ink-2 dark:text-ink-2-dk">
            A couple of details and your consent, then you're in.
          </Text>
        </View>

        <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
          <Text className="text-ink dark:text-ink-dk font-semibold">
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
          <Text className="text-ink-3 dark:text-ink-3-dk text-xs">
            Signed in as {session?.user.email}.
          </Text>
        </View>

        {minorBlocked ? (
          <View className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl p-4 gap-1">
            <Text className="text-amber-800 dark:text-amber-200 font-semibold">
              This gym doesn't accept members under 18
            </Text>
            <Text className="text-amber-700 dark:text-amber-300 text-sm">
              Please contact your gym directly — they'll be able to help you
              join.
            </Text>
          </View>
        ) : (
          <>
            {under18 ? (
              <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
                <Text className="text-ink dark:text-ink-dk font-semibold">
                  Parent or guardian consent
                </Text>
                <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
                  You're under 18, so a parent or guardian needs to give
                  consent on your behalf.
                </Text>
                <Input
                  label="Parent/guardian name"
                  value={guardianName}
                  onChangeText={setGuardianName}
                  autoCapitalize="words"
                />
                <Input
                  label="Parent/guardian email or phone"
                  value={guardianContact}
                  onChangeText={setGuardianContact}
                />
                <Pressable
                  onPress={() => setGuardianAck((v) => !v)}
                  className="flex-row items-start gap-3 active:opacity-70">
                  <View
                    className={`w-6 h-6 rounded-md items-center justify-center mt-0.5 ${
                      guardianAck
                        ? 'bg-primary'
                        : 'border border-line-strong dark:border-line-strong-dk'
                    }`}>
                    {guardianAck ? (
                      <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                    ) : null}
                  </View>
                  <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm">
                    I confirm I am the parent or guardian named above and I
                    give my consent.
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View className="bg-surface dark:bg-surface-dk rounded-xl p-4 gap-3 shadow-card">
              <Text className="text-ink dark:text-ink-dk font-semibold">
                Consent
              </Text>
              <Text className="text-ink-2 dark:text-ink-2-dk text-sm">
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
                          : 'border border-line-strong dark:border-line-strong-dk'
                      }`}>
                      {on ? (
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                      ) : null}
                    </View>
                    <Text className="flex-1 text-ink-2 dark:text-ink-2-dk text-sm">
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
              <Text className="text-ink-3 dark:text-ink-3-dk text-xs text-center">
                Fill in your details{under18 ? ', the guardian consent,' : ''}{' '}
                and tick all three boxes to continue.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
